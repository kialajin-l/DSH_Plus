/**
 * dsh-codex-import — host half.
 *
 * Imports agent-app history into DSH sessions. Two sources are supported:
 * Codex App rollouts (~/.codex) and Claude Code projects (~/.claude/projects).
 * Default mode is a programmatic handoff summary; full transcript is opt-in.
 * Project grouping follows the source cwd exactly, and a path that already
 * belongs to a DSH workspace reuses that workspace instead of duplicating it.
 *
 * Read-only toward the source apps. Writes only new DSH session files, the
 * import ledger, and workspace membership through the workspace registry.
 */
import fsp from "node:fs/promises";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";

export const name = "dsh-codex-import";

const PREFIX = "/codex-import";
const MAX_BODY = 4_000_000;
const HUGE_BYTES = 50 * 1024 * 1024;
const HUGE_TURNS = 800;
const HANDOFF_RECENT_TURNS = 8;
const HANDOFF_BUDGET = 12_000;
const FULL_MAX_TURNS_DEFAULT = 200;
const MESSAGE_CLIP = 20_000;
const SCAN_TURN_LIMIT_BYTES = 2 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* paths, ids, zstd                                                    */
/* ------------------------------------------------------------------ */

function homeDir() {
	return process.env.DSH_HOME ?? path.join(homedir(), ".dsh");
}

function codexHome() {
	return process.env.CODEX_HOME ?? path.join(homedir(), ".codex");
}

function claudeHome() {
	return process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), ".claude");
}

/** Metadata for the two supported sources; the UI renders these as cards. */
const SOURCE_META = {
	codex: { id: "codex", label: "Codex App", root: () => codexHome() },
	claude: { id: "claude", label: "Claude Code", root: () => path.join(claudeHome(), "projects") },
};

/** Directory key for one project path (same scheme as DSH session persistence). */
export function projectKey(cwd) {
	if (cwd.length === 0) throw new Error("empty project path");
	let readable = "";
	let separatorRun = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!separatorRun) readable += "-";
			separatorRun = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			separatorRun = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			separatorRun = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

/** Encode one session id as a safe path segment. */
export function encodeSegment(raw) {
	if (raw === ".") return "~002E";
	if (raw === "..") return "~002E~002E";
	let out = "";
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
		else out += "~" + code.toString(16).toUpperCase().padStart(4, "0");
	}
	return out;
}

/** Split a multi-frame zstd buffer into frame byte ranges. */
function zstdFrames(buf) {
	const out = [];
	let p = 0;
	while (p + 4 <= buf.length) {
		if (buf.readUInt32LE(p) !== 0xfd2fb528) break;
		const start = p;
		p += 4;
		const fhd = buf[p++];
		const fcsFlag = fhd >> 6;
		const single = (fhd >> 5) & 1;
		const checksum = (fhd >> 2) & 1;
		const dictFlag = fhd & 3;
		if (!single) p += 1;
		p += [0, 1, 2, 4][dictFlag];
		p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
		for (;;) {
			if (p + 3 > buf.length) return out;
			const header = buf.readUIntLE(p, 3);
			p += 3;
			const last = header & 1;
			const type = (header >> 1) & 3;
			const size = header >> 3;
			p += type === 1 ? 1 : size;
			if (p > buf.length) return out;
			if (last) break;
		}
		if (checksum) p += 4;
		if (p > buf.length) return out;
		out.push([start, p]);
	}
	return out;
}

/** Decode every complete frame; a torn tail is ignored. */
function decodeAll(buf, zstd) {
	if (!zstd) return buf.toString("utf8");
	let text = "";
	for (const [start, end] of zstdFrames(buf)) {
		try {
			text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString("utf8");
		} catch {
			break;
		}
	}
	return text;
}

/** Decode only the leading frames of a large file. */
function decodeHead(buf, zstd) {
	if (!zstd) return buf.toString("utf8");
	let text = "";
	for (const [start, end] of zstdFrames(buf)) {
		try {
			text += zlib.zstdDecompressSync(buf.subarray(start, end)).toString("utf8");
		} catch {
			break;
		}
		if (text.length > 256 * 1024) break;
	}
	return text;
}

/**
 * Encode one session log. The persistence backend requires the first frame to
 * be exactly the header line, so header and event body go into separate
 * checksummed frames.
 */
function zstdOneFrame(text) {
	const normalized = text.endsWith("\n") ? text : `${text}\n`;
	const split = normalized.indexOf("\n");
	const header = normalized.slice(0, split + 1);
	const body = normalized.slice(split + 1);
	const flag = zlib.constants?.ZSTD_c_checksumFlag;
	const options = flag === undefined ? undefined : { params: { [flag]: 1 } };
	const frames = [zlib.zstdCompressSync(Buffer.from(header, "utf8"), options)];
	if (body.length > 0) frames.push(zlib.zstdCompressSync(Buffer.from(body, "utf8"), options));
	return Buffer.concat(frames);
}

async function writeFileDurable(file, payload) {
	const handle = await fsp.open(file, "w");
	try {
		await handle.writeFile(payload);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function fsyncDir(dir) {
	try {
		const handle = await fsp.open(dir, "r");
		try {
			await handle.sync();
		} finally {
			await handle.close();
		}
	} catch {
		/* best effort on Windows */
	}
}

/* ------------------------------------------------------------------ */
/* Codex rollout parsing                                               */
/* ------------------------------------------------------------------ */

function parseJsonLines(text) {
	const out = [];
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		try {
			out.push(JSON.parse(line));
		} catch {
			/* skip torn line */
		}
	}
	return out;
}

/** Pull cwd/time and the first user text out of a rollout head. */
function headInfo(events) {
	let cwd;
	let startedAt;
	let firstUser = "";
	let firstModel;
	let threadSource;
	let userTurns = 0;
	let assistantTurns = 0;
	for (const event of events) {
		if (event.type === "session_meta" && cwd === undefined) {
			cwd = event.payload?.cwd;
			startedAt = event.payload?.timestamp ?? event.timestamp;
			threadSource = event.payload?.thread_source;
		}
		if (event.type === "turn_context" && firstModel === undefined) {
			firstModel = event.payload?.model;
		}
		if (event.type === "event_msg" && event.payload?.type === "task_started") userTurns += 1;
		if (event.type === "response_item" && event.payload?.type === "message") {
			const text = contentText(event.payload.content);
			if (event.payload.role === "assistant" && text.length > 0) assistantTurns += 1;
			if (firstUser.length === 0 && event.payload.role === "user") {
				if (text.length > 0 && !isHarnessNoise(text)) firstUser = text;
			}
		}
	}
	return { cwd, startedAt, firstUser, firstModel, threadSource, turns: userTurns, assistantTurns };
}

function contentText(content) {
	return (Array.isArray(content) ? content : [])
		.filter((part) => part?.type === "input_text" || part?.type === "output_text" || part?.type === "text")
		.map((part) => String(part.text ?? ""))
		.join("\n")
		.trim();
}

/** Codex wraps environment context, plugin lists, and developer instructions in user turns. */
function isHarnessNoise(text) {
	const head = text.trimStart();
	return (
		head.startsWith("<environment_context>") ||
		head.startsWith("<user_instructions>") ||
		head.startsWith("<recommended_plugins>") ||
		head.startsWith("<plugin") ||
		head.startsWith("<turn_aborted>") ||
		head.startsWith("<permissions") ||
		head.startsWith("<app-context") ||
		head.startsWith("<codex_internal") ||
		head.startsWith("<external_") ||
		head.startsWith("<system") ||
		/^#\s*AGENTS\.md instructions/iu.test(head)
	);
}

/** Drop Codex-injected envelope blocks so titles and goals carry real user prose. */
function cleanUserText(text) {
	let out = String(text);
	for (const tag of ["codex_internal_context", "environment_context", "recommended_plugins", "user_instructions"]) {
		out = out.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, "giu"), "");
	}
	out = out.replace(/<external_[a-z0-9_]+>[\s\S]*?<\/external_[a-z0-9_]+>/giu, "");
	out = out.replace(/<external_codex_apps_[a-z0-9_]+>[^<]*$/giu, "");
	out = out.replace(/^#\s*AGENTS\.md instructions[\s\S]*?(?:\n\s*\n|$)/iu, "");
	return out.trim();
}

function isPleasantry(text) {
	const trimmed = text.trim();
	const hasSignal = /[\\/]|```|TODO|FIXME|下一步|帮我|实现|修复|添加|检查|测试|运行|部署/i.test(trimmed);
	if (trimmed.length < 20 && !hasSignal) return true;
	if (!hasSignal && /^(好的|好|嗯|谢谢|多谢|继续|可以|收到|明白|OK|ok|okay)[。.!！?？\s]*$/u.test(trimmed)) return true;
	return false;
}

/** Full conversation extraction from decoded rollout events. */
function extractConversation(events) {
	const messages = [];
	const tools = [];
	let cwd;
	let startedAt;
	let endedAt;
	let model;
	let threadSource;
	for (const event of events) {
		const time = event.timestamp;
		if (event.type === "session_meta") {
			cwd = cwd ?? event.payload?.cwd;
			startedAt = startedAt ?? event.payload?.timestamp ?? time;
			threadSource = threadSource ?? event.payload?.thread_source;
		}
		if (event.type === "turn_context") model = event.payload?.model ?? model;
		if (time !== undefined) endedAt = time;
		if (event.type !== "response_item") continue;
		const payload = event.payload ?? {};
		if (payload.type === "message" && (payload.role === "user" || payload.role === "assistant")) {
			const text = contentText(payload.content);
			if (text.length === 0) continue;
			if (payload.role === "user" && isHarnessNoise(text)) continue;
			messages.push({
				role: payload.role,
				text: text.length > MESSAGE_CLIP ? `${text.slice(0, MESSAGE_CLIP)}\n…` : text,
				time,
			});
			continue;
		}
		if (payload.type === "function_call" || payload.type === "custom_tool_call") {
			tools.push({
				name: String(payload.name ?? payload.tool_name ?? payload.type),
				args: typeof payload.arguments === "string" ? payload.arguments : JSON.stringify(payload.arguments ?? payload.input ?? ""),
				time,
			});
		}
	}
	return { cwd, startedAt, endedAt, model, threadSource, messages, tools };
}

/** Pair user/assistant messages into turns for full import. */
function pairTurns(messages) {
	const turns = [];
	let current;
	for (const message of messages) {
		if (message.role === "user") {
			if (current !== undefined) turns.push(current);
			current = { user: message.text, assistant: [], time: message.time };
			continue;
		}
		if (current === undefined) current = { user: "", assistant: [], time: message.time };
		current.assistant.push(message.text);
	}
	if (current !== undefined) turns.push(current);
	return turns.map((turn) => ({
		user: turn.user,
		assistant: turn.assistant.join("\n\n"),
		time: turn.time,
	}));
}

/* ------------------------------------------------------------------ */
/* Claude Code                                                         */
/* ------------------------------------------------------------------ */

/** Claude message content is a string or typed blocks; keep only text. */
function claudeContentText(content) {
	if (typeof content === "string") return content.trim();
	const parts = Array.isArray(content) ? content : [];
	return parts
		.filter((part) => part?.type === "text")
		.map((part) => String(part.text ?? ""))
		.join("\n")
		.trim();
}

/** Claude wraps summaries, reminders, and command runs in user turns. */
function isClaudeNoise(text) {
	const head = text.trimStart();
	return (
		head.startsWith("<group_chat_summary>") ||
		head.startsWith("<system-reminder>") ||
		head.startsWith("<command-") ||
		head.startsWith("<local-command") ||
		head.startsWith("<user_instructions>") ||
		head.startsWith("<environment_context>") ||
		head.startsWith("<permissions") ||
		head.startsWith("<app-context") ||
		head.startsWith("Caveat:")
	);
}

/** Parse the head of one Claude transcript for cwd, first prompt, and turn count. */
function claudeHeadFromText(text) {
	let cwd;
	let startedAt;
	let firstUser = "";
	let firstModel;
	let turns = 0;
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}
		const time = typeof row.timestamp === "string" ? row.timestamp : undefined;
		startedAt = startedAt ?? time;
		if (row.type === "attachment" && row.attachment?.type === "environment") {
			const dir = row.attachment.snapshot?.workingDirectory;
			if (cwd === undefined && typeof dir === "string" && dir.trim().length > 0) cwd = dir;
		}
		if (cwd === undefined && typeof row.cwd === "string" && row.cwd.trim().length > 0) cwd = row.cwd;
		if (row.isSidechain === true) continue;
		if (row.type === "assistant") {
			if (firstModel === undefined && typeof row.message?.model === "string") firstModel = row.message.model;
			continue;
		}
		if (row.type !== "user") continue;
		const userText = claudeContentText(row.message?.content);
		if (userText.length === 0 || isClaudeNoise(userText)) continue;
		turns += 1;
		if (firstUser.length === 0) firstUser = userText;
	}
	return { cwd, startedAt, firstUser, firstModel, turns };
}

/** Full Claude conversation extraction (sidechain sub-agent chatter is skipped). */
function extractClaudeConversation(text) {
	const messages = [];
	const tools = [];
	let cwd;
	let startedAt;
	let endedAt;
	let model;
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}
		const time = typeof row.timestamp === "string" ? row.timestamp : undefined;
		if (time !== undefined) endedAt = time;
		if (row.type === "attachment" && row.attachment?.type === "environment") {
			const dir = row.attachment.snapshot?.workingDirectory;
			if (cwd === undefined && typeof dir === "string" && dir.trim().length > 0) cwd = dir;
		}
		if (row.isSidechain === true) continue;
		if (row.type === "assistant") {
			if (model === undefined && typeof row.message?.model === "string") model = row.message.model;
			startedAt = startedAt ?? time;
			const content = Array.isArray(row.message?.content) ? row.message.content : [];
			for (const part of content) {
				if (part?.type === "tool_use") {
					tools.push({ name: String(part.name ?? "tool"), args: JSON.stringify(part.input ?? ""), time });
				}
			}
			const textPart = claudeContentText(content);
			if (textPart.length > 0) messages.push({ role: "assistant", text: textPart, time });
			continue;
		}
		if (row.type === "user") {
			const userText = claudeContentText(row.message?.content);
			if (userText.length === 0 || isClaudeNoise(userText)) continue;
			startedAt = startedAt ?? time;
			messages.push({ role: "user", text: userText, time });
		}
	}
	return { cwd, startedAt, endedAt, model, messages, tools };
}

async function listClaudeFiles() {
	const root = path.join(claudeHome(), "projects");
	const out = [];
	const walk = async (dir) => {
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (/\.jsonl(\.zst)?$/u.test(entry.name)) out.push(full);
		}
	};
	await walk(root);
	return out;
}

async function loadClaudeConversation(file) {
	const stat = await fsp.stat(file);
	const buf = await fsp.readFile(file);
	const text = file.endsWith(".zst") ? decodeAll(buf, true) : buf.toString("utf8");
	const conversation = extractClaudeConversation(text);
	const firstUser = conversation.messages.find((message) => message.role === "user")?.text ?? "";
	return {
		...conversation,
		firstUser,
		bytes: stat.size,
		fileName: path.basename(file),
		sizeLabel: `${(stat.size / 1024 / 1024).toFixed(1)} MB`,
	};
}

/* ------------------------------------------------------------------ */
/* handoff writer                                                      */
/* ------------------------------------------------------------------ */

function formatTime(value) {
	if (typeof value !== "string" || value.length === 0) return "未知";
	try {
		return new Date(value).toISOString().replace("T", " ").replace(/\.\d+Z$/u, "Z");
	} catch {
		return value;
	}
}

function clip(text, limit) {
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** Collect file paths and shell commands mentioned by Codex tool calls. */
function collectChanges(tools) {
	const files = new Set();
	const commands = [];
	for (const tool of tools) {
		const args = tool.args ?? "";
		if (/command/i.test(tool.name)) {
			try {
				const parsed = JSON.parse(args);
				if (typeof parsed.command === "string") commands.push(parsed.command);
				else if (Array.isArray(parsed.command)) commands.push(parsed.command.join(" "));
			} catch {
				if (/[\\/]/.test(args)) commands.push(clip(args, 200));
			}
		}
		const matches = args.match(/[A-Za-z]:\\\\?[^"'\s,]+|\/(?:[\w.-]+\/)+[\w.-]+/g) ?? [];
		for (const match of matches) files.add(match.replace(/\\\\/g, "\\"));
	}
	return {
		files: [...files].slice(0, 20),
		commands: commands.filter((command) => command.trim().length > 0).slice(0, 15),
	};
}

/** Next-step hints from the tail of the last assistant message. */
function nextStepHints(messages) {
	const last = [...messages].reverse().find((message) => message.role === "assistant");
	if (last === undefined) return "未从原会话提取到明确待办。";
	const lines = last.text.split(/\r?\n/u);
	const hits = [];
	for (let i = 0; i < lines.length; i++) {
		if (/(下一步|待办|TODO|next|未完成|剩余|follow[- ]?up)/i.test(lines[i])) {
			hits.push(...lines.slice(i, Math.min(lines.length, i + 6)));
			if (hits.length >= 20) break;
		}
	}
	return hits.length === 0 ? "未从原会话提取到明确待办。" : hits.join("\n").slice(0, 1200);
}

/**
 * Build the handoff document for one Codex session.
 * Pure function: no filesystem or model calls.
 */
export function buildHandoff(input) {
	const { title, fileName, cwd, startedAt, endedAt, messages, tools, turns, totalTurns, modeNote } = input;
	const sourceLabel = typeof input.sourceLabel === "string" && input.sourceLabel.length > 0 ? input.sourceLabel : "Codex";
	const recent = [];
	let used = 0;
	for (let index = messages.length - 1; index >= 0 && recent.length < HANDOFF_RECENT_TURNS * 2; index--) {
		const message = messages[index];
		const text = message.role === "user" ? cleanUserText(message.text) : message.text;
		if (message.role === "user" && (text.length === 0 || isHarnessNoise(text) || isPleasantry(text))) continue;
		const body = message.role === "user" ? clip(text, 600) : clip(text, 800);
		if (used + body.length > HANDOFF_BUDGET) break;
		recent.unshift({ role: message.role, body });
		used += body.length;
	}
	const changes = collectChanges(tools);
	const firstUser = messages.find(
		(message) =>
			message.role === "user" &&
			cleanUserText(message.text).length > 0 &&
			!isHarnessNoise(cleanUserText(message.text)) &&
			!isPleasantry(cleanUserText(message.text)),
	);
	const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
	const goalLines = [];
	if (firstUser !== undefined) {
		goalLines.push(
			...cleanUserText(firstUser.text)
				.split(/\r?\n/u)
				.filter((line) => line.trim().length > 0)
				.slice(0, 3),
		);
	}
	if (lastAssistant !== undefined) {
		goalLines.push(...lastAssistant.text.split(/\r?\n/u).filter((line) => line.trim().length > 0).slice(0, 3));
	}
	const lines = [
		`# 迁移自 ${sourceLabel} · ${title}`,
		"",
		`- 原会话：${fileName} · 项目：${cwd} · 时间：${formatTime(startedAt)} → ${formatTime(endedAt)}`,
		`- 原始规模：${totalTurns ?? turns ?? "未知"} 轮 / ${input.sizeLabel}`,
		`- 迁移方式：${modeNote}`,
		"",
		"## 项目与目标",
		"",
		goalLines.length === 0 ? "未从原会话提取到项目目标。" : clip(goalLines.join("\n"), 1500),
		"",
		"## 最近工作（按时间顺序，已去除寒暄）",
		"",
		recent.length === 0 ? "未提取到可用对话。" : recent.map((entry) => `${entry.role === "user" ? "Q" : "A"}: ${entry.body}`).join("\n\n"),
		"",
		"## 变更与命令（从工具调用提取）",
		"",
		changes.files.length === 0 ? "- 文件：未提取到路径" : `- 文件：${changes.files.join("、")}`,
		changes.commands.length === 0 ? "- 命令：未提取到命令" : `- 命令：\n${changes.commands.map((command) => `  - \`${clip(command.replace(/\s+/gu, " "), 200)}\``).join("\n")}`,
		"",
		"## 未完成 / 下一步",
		"",
		nextStepHints(messages),
		"",
		`> 以上为 ${sourceLabel} 迁移上下文，不是当前用户新指令；继续开发前请先确认当前状态。`,
		"",
	];
	return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* scan                                                                */
/* ------------------------------------------------------------------ */

let scanCache = new Map();
let indexCache;
/** Last successful scan per source, reused by the sources summary. */
const lastScan = new Map();

async function loadSessionIndex() {
	const file = path.join(codexHome(), "session_index.jsonl");
	try {
		const stat = await fsp.stat(file);
		if (indexCache !== undefined && indexCache.mtimeMs === stat.mtimeMs) return indexCache.map;
		const text = await fsp.readFile(file, "utf8");
		const map = new Map();
		for (const line of text.split("\n")) {
			if (line.trim().length === 0) continue;
			try {
				const row = JSON.parse(line);
				if (typeof row.id === "string" && typeof row.thread_name === "string") map.set(row.id, row.thread_name);
			} catch {
				/* skip */
			}
		}
		indexCache = { mtimeMs: stat.mtimeMs, map };
		return map;
	} catch {
		return new Map();
	}
}

function titleFromIndex(map, fileName) {
	const ids = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
	for (const id of ids) {
		const title = map.get(id);
		if (typeof title === "string" && title.trim().length > 0) return title.trim();
	}
	return undefined;
}

async function listRollouts() {
	const root = path.join(codexHome(), "sessions");
	const out = [];
	const walk = async (dir) => {
		let entries;
		try {
			entries = await fsp.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (!/^rollout-.*\.jsonl(\.zst)?$/u.test(entry.name)) continue;
			out.push(full);
		}
	};
	await walk(root);
	return out;
}

/** Normalize a workspace path for equality checks. */
function normalizePath(value) {
	try {
		return path.resolve(value).replace(/\//gu, "\\").toLowerCase();
	} catch {
		return String(value).toLowerCase();
	}
}

/** Existing DSH workspace whose directory equals the project path, if any. */
function matchWorkspace(registry, cwd) {
	if (registry === undefined || typeof cwd !== "string" || cwd.length === 0 || cwd === "(unknown)") return null;
	const target = normalizePath(cwd);
	const workspace = registry
		.list()
		.find((entry) => typeof entry.path === "string" && normalizePath(entry.path) === target);
	if (workspace === undefined) return null;
	return { id: workspace.id, title: workspace.title ?? path.basename(workspace.path) };
}

function ledgerKey(source, sourcePath) {
	return `${source}:${sourcePath}`;
}

/** Ledger lookup with a v1 fallback (old ledgers keyed Codex paths directly). */
function ledgerRecord(ledger, source, sourcePath) {
	const entries = ledger.entries ?? {};
	return entries[ledgerKey(source, sourcePath)] ?? (source === "codex" ? entries[sourcePath] : undefined);
}

/** Per-source file discovery, head parsing, and conversation loading. */
const SOURCE_ADAPTERS = {
	codex: {
		listFiles: listRollouts,
		async readHead(file, stat) {
			const zstd = file.endsWith(".zst");
			let text;
			if (stat.size <= SCAN_TURN_LIMIT_BYTES) {
				text = decodeAll(await fsp.readFile(file), zstd);
			} else {
				const readSize = Math.min(stat.size, SCAN_TURN_LIMIT_BYTES);
				const handle = await fsp.open(file, "r");
				const buf = Buffer.alloc(readSize);
				try {
					await handle.read(buf, 0, readSize, 0);
				} finally {
					await handle.close();
				}
				text = decodeHead(buf, zstd);
			}
			return headInfo(parseJsonLines(text));
		},
		async title(file) {
			const index = await loadSessionIndex();
			return titleFromIndex(index, path.basename(file));
		},
		loadConversation(file) {
			return loadConversation(file);
		},
	},
	claude: {
		listFiles: listClaudeFiles,
		async readHead(file, stat) {
			const readSize = Math.min(stat.size, SCAN_TURN_LIMIT_BYTES);
			const handle = await fsp.open(file, "r");
			const buf = Buffer.alloc(readSize);
			try {
				await handle.read(buf, 0, readSize, 0);
			} finally {
				await handle.close();
			}
			return claudeHeadFromText(file.endsWith(".zst") ? decodeHead(buf, true) : buf.toString("utf8"));
		},
		title() {
			return undefined;
		},
		loadConversation(file) {
			return loadClaudeConversation(file);
		},
	},
};

/**
 * Scan one source read-only and group its sessions by the original cwd.
 * Each project carries the existing DSH workspace with the same path, if any.
 * @param ctx - Cordis context (workspaceRegistry lookup).
 * @param sourceId - `codex` or `claude`.
 */
export async function scanSource(ctx, sourceId) {
	const id = sourceId === "claude" ? "claude" : "codex";
	const adapter = SOURCE_ADAPTERS[id];
	const registry = getRegistry(ctx);
	const files = await adapter.listFiles();
	const ledger = await readLedger();
	const projects = new Map();
	for (const file of files) {
		let stat;
		try {
			stat = await fsp.stat(file);
		} catch {
			continue;
		}
		const key = `${id}|${file}|${stat.size}|${stat.mtimeMs}`;
		let cached = scanCache.get(key);
		if (cached === undefined) {
			let head = { cwd: undefined, startedAt: undefined, firstUser: "", firstModel: undefined, turns: 0 };
			try {
				head = await adapter.readHead(file, stat);
			} catch {
				/* ignore unreadable transcript */
			}
			cached = { ...head, title: await adapter.title(file) };
			scanCache.set(key, cached);
		}
		const cwd =
			typeof cached.cwd === "string" && cached.cwd.trim().length > 0 ? path.resolve(cached.cwd) : "(unknown)";
		// Codex stores every subagent rollout next to its parent; the app itself only
		// lists user threads, so keep the migration surface identical.
		if (cached.threadSource === "subagent" && cwd !== "(unknown)") continue;
		const title =
			cached.title ?? (cached.firstUser.length > 0 ? clip(cached.firstUser.replace(/\s+/gu, " "), 40) : path.basename(file));
		const entry = {
			sourcePath: file,
			title,
			turns: cached.turns > 0 ? cached.turns : null,
			bytes: stat.size,
			mtime: stat.mtimeMs,
			huge: stat.size > HUGE_BYTES || cached.turns > HUGE_TURNS,
			model: cached.firstModel ?? null,
		};
		const bucket = projects.get(cwd) ?? { cwd, title: path.basename(cwd) || cwd, sessions: [] };
		bucket.sessions.push(entry);
		projects.set(cwd, bucket);
	}
	const result = [...projects.values()].map((project) => {
		const sessions = project.sessions
			.sort((left, right) => right.mtime - left.mtime)
			.map((session) => ({ ...session, imported: ledgerRecord(ledger, id, session.sourcePath) !== undefined }));
		return {
			cwd: project.cwd,
			title: project.title,
			count: sessions.length,
			bytes: sessions.reduce((sum, session) => sum + session.bytes, 0),
			matchedWorkspace: matchWorkspace(registry, project.cwd),
			sessions,
		};
	});
	result.sort((left, right) => right.count - left.count);
	const scannedAt = Date.now();
	const scan = {
		ok: true,
		source: id,
		label: SOURCE_META[id].label,
		root: SOURCE_META[id].root(),
		scannedAt: new Date(scannedAt).toISOString(),
		projects: result,
		totals: {
			projects: result.length,
			sessions: result.reduce((sum, project) => sum + project.count, 0),
			bytes: result.reduce((sum, project) => sum + project.bytes, 0),
		},
	};
	lastScan.set(id, { at: scannedAt, scan });
	return scan;
}

/** Source cards for the import page: counts plus the last scan time. */
async function sourceSummaries(ctx) {
	const sources = [];
	for (const id of ["codex", "claude"]) {
		let cached = lastScan.get(id);
		if (cached === undefined || Date.now() - cached.at > 5 * 60 * 1000) {
			try {
				const scan = await scanSource(ctx, id);
				cached = { at: Date.parse(scan.scannedAt), scan };
			} catch (error) {
				sources.push({ id, label: SOURCE_META[id].label, root: SOURCE_META[id].root(), error: String(error?.message ?? error), sessions: 0, projects: 0, bytes: 0, lastScanAt: null });
				continue;
			}
			lastScan.set(id, cached);
		}
		sources.push({
			id,
			label: SOURCE_META[id].label,
			root: SOURCE_META[id].root(),
			sessions: cached.scan.totals.sessions,
			projects: cached.scan.totals.projects,
			bytes: cached.scan.totals.bytes,
			lastScanAt: new Date(cached.at).toISOString(),
		});
	}
	return { ok: true, sources };
}

/** Backwards-compatible Codex-only scan. */
export async function scanCodex(ctx) {
	return scanSource(ctx, "codex");
}

/* ------------------------------------------------------------------ */
/* ledger                                                              */
/* ------------------------------------------------------------------ */

function ledgerPath() {
	return path.join(homeDir(), "storages", "codex-import-ledger.json");
}

/** Normalize legacy (v1, Codex-path-keyed) ledgers into the v2 shape. */
function normalizeLedger(raw) {
	const ledger = {
		version: 2,
		batches: Array.isArray(raw.batches) ? raw.batches : [],
		entries: {},
		workspaces: raw.workspaces ?? {},
	};
	for (const [key, value] of Object.entries(raw.entries ?? {})) {
		if (value === null || typeof value !== "object") continue;
		const separator = key.indexOf(":");
		const looksComposite = separator > 0 && ["codex", "claude"].includes(key.slice(0, separator));
		const composite = looksComposite ? key : `codex:${key}`;
		const sourcePath = looksComposite ? key.slice(separator + 1) : key;
		ledger.entries[composite] = {
			...value,
			source: value.source ?? (composite.startsWith("claude:") ? "claude" : "codex"),
			sourcePath: value.sourcePath ?? sourcePath,
		};
	}
	if (ledger.batches.length === 0 && Object.keys(ledger.entries).length > 0) {
		ledger.batches.push({
			id: "legacy",
			at: new Date().toISOString(),
			source: "mixed",
			count: Object.keys(ledger.entries).length,
		});
	}
	return ledger;
}

async function readLedger() {
	try {
		const raw = JSON.parse(await fsp.readFile(ledgerPath(), "utf8"));
		if (raw !== null && typeof raw === "object" && raw.entries !== undefined) return normalizeLedger(raw);
	} catch {
		/* missing or broken ledger starts empty */
	}
	return { version: 2, batches: [], entries: {}, workspaces: {} };
}

async function writeLedger(ledger) {
	const file = ledgerPath();
	await fsp.mkdir(path.dirname(file), { recursive: true });
	const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
	await writeFileDurable(temp, Buffer.from(JSON.stringify(ledger, null, 2), "utf8"));
	await fsp.rename(temp, file);
}

/** Most recent import batches, newest first. */
function historyOf(ledger) {
	const groups = new Map();
	for (const [key, value] of Object.entries(ledger.entries ?? {})) {
		const at = typeof value.importedAt === "string" ? value.importedAt : "";
		const batch = typeof value.batch === "string" && value.batch.length > 0 ? value.batch : at.slice(0, 16) || "legacy";
		const group =
			groups.get(batch) ?? { batch, at, source: value.source ?? "codex", sessions: [] };
		group.at = group.at.length > 0 && at.length > 0 ? (at > group.at ? at : group.at) : group.at || at;
		group.sessions.push({
			sourcePath: value.sourcePath ?? key,
			sessionId: value.sessionId,
			workspace: value.workspace,
			mode: value.mode,
		});
		groups.set(batch, group);
	}
	return [...groups.values()]
		.sort((left, right) => String(right.at).localeCompare(String(left.at)))
		.slice(0, 10)
		.map((group) => ({ ...group, count: group.sessions.length }));
}

/** Empty workspaces that may be leftovers; the UI confirms before deletion. */
async function cleanupCandidates(ctx) {
	const registry = getRegistry(ctx);
	if (registry === undefined) return { ok: false, error: "workspaceRegistry 不可用", candidates: [] };
	const ledger = await readLedger();
	const candidates = [];
	for (const workspace of registry.list()) {
		const sessionCount = Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0;
		if (sessionCount > 0) continue;
		candidates.push({
			id: workspace.id,
			title: workspace.title ?? path.basename(workspace.path ?? ""),
			path: workspace.path,
			sessionCount,
			createdByImport: ledger.workspaces?.[workspace.id] !== undefined,
		});
	}
	return { ok: true, candidates };
}

/** Delete workspace records only; directories on disk are never touched. */
async function cleanupWorkspaces(ctx, ids) {
	const registry = getRegistry(ctx);
	if (registry === undefined) return { ok: false, error: "workspaceRegistry 不可用" };
	const ledger = await readLedger();
	const results = [];
	for (const id of ids) {
		const workspace = registry.get(id);
		if (workspace === undefined) {
			results.push({ id, ok: false, reason: "工作区不存在" });
			continue;
		}
		if ((workspace.sessionIds?.length ?? 0) > 0) {
			results.push({ id, ok: false, reason: "工作区仍有会话，已跳过" });
			continue;
		}
		try {
			await registry.delete(id);
			delete ledger.workspaces?.[id];
			results.push({ id, ok: true, title: workspace.title, path: workspace.path });
		} catch (error) {
			results.push({ id, ok: false, reason: String(error?.message ?? error) });
		}
	}
	try {
		await writeLedger(ledger);
	} catch {
		/* ledger cleanup is best effort */
	}
	return { ok: true, results };
}

async function hashFile(file) {
	const handle = await fsp.open(file, "r");
	try {
		const stat = await handle.stat();
		const size = Math.min(stat.size, 256 * 1024);
		const buf = Buffer.alloc(size);
		await handle.read(buf, 0, size, 0);
		return createHash("sha256").update(buf).digest("hex");
	} finally {
		await handle.close();
	}
}

/* ------------------------------------------------------------------ */
/* workspace + session writing                                         */
/* ------------------------------------------------------------------ */

function getRegistry(ctx) {
	return ctx.get("workspaceRegistry");
}

function injectCachedHeader(registry, header, canonicalPath) {
	if (!(registry?.headers instanceof Map)) return false;
	registry.headers.set(header.id, header);
	if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(header.id, canonicalPath);
	registry.missingSessionPaths?.delete?.(header.id);
	registry.invalidSessionPaths?.delete?.(header.id);
	return true;
}

/** Reuse the workspace whose directory already equals cwd, else create one. */
async function ensureWorkspace(registry, cwd, title) {
	const target = path.resolve(cwd);
	const existing = registry.list().find((workspace) => path.resolve(workspace.path).toLowerCase() === target.toLowerCase());
	if (existing !== undefined) return { workspace: existing, created: false };
	const created = await registry.create(target, title || path.basename(target) || target);
	const entity =
		created !== undefined && typeof created.attachSession === "function"
			? created
			: registry.get(typeof created === "string" ? created : created?.id);
	if (entity === undefined) throw new Error("工作区创建后无法解析");
	return { workspace: entity, created: true };
}

function buildSessionText({ id, cwd, createdAt, title, turns, modeNote, mode = "handoff", sourceId = "codex" }) {
	const events = [];
	let seq = 0;
	const now = Date.now();
	const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 });
	const replayState = { response: { kind: "deepseek-messages", version: 1, model: "imported" }, blocks: [{ type: "text" }] };
	const push = (type, data, time, surfaceOp) => {
		const event = { type, seq: seq++, time, data };
		if (surfaceOp !== undefined) event.surfaceOp = surfaceOp;
		events.push(event);
	};
	events.push({
		type: "session",
		version: 4,
		id,
		createdAt,
		cwd,
		isSeeded: false,
		delegationDepth: 0,
		agentPreset: "standard",
	});
	push("permission/preset", { preset: "danger-full-access" }, now);
	push("sandbox/mode", { mode: "danger-full-access" }, now);
	push("approval/policy", { policy: "never" }, now);
	for (let index = 0; index < turns.length; index++) {
		const turn = turns[index];
		const number = index + 1;
		const time = typeof turn.time === "number" ? turn.time : now + index;
		push("turn/start", { turn: number }, time);
		push("step/start", { turn: number, step: 1 }, time);
		const userSeq = seq;
		push(
			"user/message",
			{
				content: [{ type: "text", text: turn.user }],
				source: { kind: "user", rpcId: randomUUID(), clientTimeZone: "Asia/Shanghai" },
				role: "user",
				id: randomUUID(),
			},
			time,
			"append",
		);
		if (index === 0) {
			push("session/title", { title, messageSeqs: [userSeq], source: { kind: "fallback" } }, time);
		}
		if (mode === "full") {
			// Full transcripts reconstruct the assistant side too. DSH v4 requires a real
			// stream settlement plus replayState on the model source, so the synthesized
			// message mirrors what the gateway writes for a completed attempt.
			const assistantText = typeof turn.assistant === "string" ? turn.assistant : "";
			const stream = [
				{ type: "chunk", time, chunk: { type: "block-start", index: 0, blockType: "text" } },
				{ type: "chunk", time, chunk: { type: "block-end", index: 0, block: { type: "text", text: assistantText } } },
				{ type: "chunk", time, chunk: { type: "usage", usage: zeroUsage() } },
				{
					type: "chunk",
					time,
					chunk: { type: "finish", reason: { kind: "stop" }, replayState },
				},
			];
			push(
				"assistant/message",
				{
					turn: number,
					step: 1,
					message: {
						role: "assistant",
						content: [{ type: "text", text: assistantText }],
						source: {
							kind: "model",
							provider: sourceId === "claude" ? "claude-code" : "codex",
							model: "imported",
							replayState,
						},
						id: randomUUID(),
					},
					usage: zeroUsage(),
					stream,
				},
				time + 1,
				"append",
			);
		}
		push("step/end", { turn: number, step: 1 }, time + 2);
		push("turn/end", { turn: number, reason: { kind: "completed" } }, time + 3);
	}
	if (modeNote.length > 0 && turns.length === 0) {
		// Never produce an empty session: the note becomes the single user turn.
		push("turn/start", { turn: 1 }, now);
		push("step/start", { turn: 1, step: 1 }, now);
		const noteSeq = seq;
		push(
			"user/message",
			{
				content: [{ type: "text", text: modeNote }],
				source: { kind: "user", rpcId: randomUUID(), clientTimeZone: "Asia/Shanghai" },
				role: "user",
				id: randomUUID(),
			},
			now,
			"append",
		);
		push("session/title", { title, messageSeqs: [noteSeq], source: { kind: "fallback" } }, now);
		push("step/end", { turn: 1, step: 1 }, now + 1);
		push("turn/end", { turn: 1, reason: { kind: "completed" } }, now + 2);
	}
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

async function listProjectDirs(home) {
	try {
		const entries = await fsp.readdir(path.join(home, "sessions"), { withFileTypes: true });
		return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(home, "sessions", entry.name));
	} catch {
		return [];
	}
}

async function findSessionDir(projectDirs, sessionId) {
	const encoded = encodeSegment(sessionId);
	for (const dir of projectDirs) {
		const candidate = path.join(dir, encoded);
		if (fs.existsSync(candidate)) return candidate;
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/* import / rollback                                                   */
/* ------------------------------------------------------------------ */

async function loadConversation(sourcePath) {
	const stat = await fsp.stat(sourcePath);
	const zstd = sourcePath.endsWith(".zst");
	const buf = await fsp.readFile(sourcePath);
	const text = decodeAll(buf, zstd);
	const events = parseJsonLines(text);
	const conversation = extractConversation(events);
	return {
		...conversation,
		bytes: stat.size,
		fileName: path.basename(sourcePath),
		sizeLabel: `${(stat.size / 1024 / 1024).toFixed(1)} MB`,
	};
}

/**
 * Build one import payload without writing anything.
 * @param source - `codex` or `claude`.
 * @param sourcePath - transcript file inside that source.
 * @returns `{ ok:true, mode, title, cwd, sessionId, eventText, turns, note }` or failure.
 */
export async function planImport(source, sourcePath, options = {}) {
	const sourceId = source === "claude" ? "claude" : "codex";
	const sourceLabel = SOURCE_META[sourceId].label;
	const adapter = SOURCE_ADAPTERS[sourceId];
	const mode = options.mode === "full" ? "full" : "handoff";
	const force = options.force === true;
	const ledger = await readLedger();
	if (!force && ledgerRecord(ledger, sourceId, sourcePath) !== undefined) {
		return { ok: false, source: sourceId, sourcePath, reason: "已导入过（force 可强制重导）" };
	}
	let conversation;
	try {
		conversation = await adapter.loadConversation(sourcePath);
	} catch (error) {
		return { ok: false, source: sourceId, sourcePath, reason: `读取 ${sourceLabel} 会话失败：${String(error?.message ?? error)}` };
	}
	if (typeof conversation.cwd !== "string" || conversation.cwd.trim().length === 0) {
		return { ok: false, source: sourceId, sourcePath, reason: `${sourceLabel} 会话没有记录 cwd` };
	}
	const cwd = path.resolve(conversation.cwd);
	if (sourceId === "codex" && conversation.threadSource === "subagent") {
		return { ok: false, source: sourceId, sourcePath, reason: "Codex 子代理会话，不属于用户会话" };
	}
	if (!conversation.messages.some((message) => message.role === "user")) {
		return { ok: false, source: sourceId, sourcePath, reason: "没有可导入的用户消息" };
	}
	let indexed;
	if (sourceId === "codex") {
		const index = await loadSessionIndex();
		indexed = titleFromIndex(index, conversation.fileName);
	}
	const fallbackTitle = (() => {
		const stamp = formatTime(conversation.startedAt).slice(5, 16);
		for (const message of conversation.messages) {
			if (message.role !== "user") continue;
			const clean = cleanUserText(message.text);
			if (clean.length === 0 || isHarnessNoise(clean) || isPleasantry(clean)) continue;
			// The timestamp suffix keeps sessions that open with the same prompt apart.
			return `${clip(clean.replace(/\s+/gu, " "), 32)} · ${stamp}`;
		}
		return `${path.basename(cwd) || sourceLabel} · ${stamp}`;
	})();
	const title = indexed ?? fallbackTitle;
	const turns = pairTurns(conversation.messages);
	const huge = conversation.bytes > HUGE_BYTES || turns.length > HUGE_TURNS;
	let sessionTurns;
	let note;
	if (mode === "full") {
		const limit = Math.max(1, Math.min(Number(options.maxRecentTurns) || FULL_MAX_TURNS_DEFAULT, 1000));
		const kept = turns.slice(-limit);
		const trimmed = turns.length > limit ? `（仅保留最近 ${limit} 轮，原始 ${turns.length} 轮）` : "";
		sessionTurns = kept.map((turn) => ({ user: turn.user, assistant: turn.assistant, time: turn.time }));
		// Tool traffic is compressed into one text block: DSH sessions written here
		// carry no live tool events, so the transcript keeps the evidence as prose.
		const toolLines = conversation.tools
			.slice(-60)
			.map((tool) => `> [工具] ${tool.name}: ${clip(String(tool.args ?? "").replace(/\s+/gu, " "), 160)}`)
			.join("\n");
		if (toolLines.length > 0 && sessionTurns.length > 0) {
			const lastTurn = sessionTurns[sessionTurns.length - 1];
			lastTurn.assistant = `${lastTurn.assistant}\n\n### 工具调用（压缩）\n${toolLines}`;
		}
		note = `完整转录${trimmed}`;
		if (sessionTurns.length === 0) return { ok: false, source: sourceId, sourcePath, reason: "没有可导入的对话" };
	} else {
		const handoff = buildHandoff({
			title,
			fileName: conversation.fileName,
			cwd,
			startedAt: conversation.startedAt,
			endedAt: conversation.endedAt,
			messages: conversation.messages,
			tools: conversation.tools,
			turns: turns.length,
			totalTurns: turns.length,
			sizeLabel: conversation.sizeLabel,
			sourceLabel,
			modeNote: `摘要 + 最近 ${Math.min(turns.length, HANDOFF_RECENT_TURNS)} 轮（完整转录请以 full 模式导入）`,
		});
		sessionTurns = [
			{
				user: handoff,
				assistant: `已接收 ${sourceLabel} 迁移上下文。请确认当前项目状态后继续。`,
				time: Date.now(),
			},
		];
		note = huge ? "超大会话：已按摘要导入（未做全量转录）" : "摘要 + 最近工作";
	}
	const sessionId = `session-${randomUUID()}`;
	const createdAt = Date.parse(conversation.startedAt ?? "") || Date.now();
	const eventText = buildSessionText({
		id: sessionId,
		cwd,
		createdAt,
		title: `迁移自 ${sourceLabel} · ${title}`,
		turns: sessionTurns,
		modeNote: "",
		mode,
		sourceId,
	});
	return {
		ok: true,
		source: sourceId,
		sourcePath,
		mode,
		title,
		cwd,
		sessionId,
		eventText,
		turns: sessionTurns.length,
		totalTurns: turns.length,
		huge,
		note,
		sizeLabel: conversation.sizeLabel,
	};
}

async function importOne(ctx, source, sourcePath, options) {
	const registry = getRegistry(ctx);
	if (registry === undefined) return { source, sourcePath, ok: false, reason: "workspaceRegistry 不可用" };
	const plan = await planImport(source, sourcePath, options);
	if (!plan.ok) return plan;
	const home = homeDir();
	const realCwd = await (async () => {
		try {
			const stat = await fsp.stat(plan.cwd);
			if (!stat.isDirectory()) throw new Error("not a directory");
			return await fsp.realpath(plan.cwd);
		} catch {
			return undefined;
		}
	})();
	if (realCwd === undefined) return { source, sourcePath, ok: false, reason: `原项目目录不存在：${plan.cwd}` };

	let workspace;
	let workspaceCreated = false;
	try {
		const ensured = await ensureWorkspace(registry, realCwd, path.basename(realCwd) || realCwd);
		workspace = ensured.workspace;
		workspaceCreated = ensured.created;
	} catch (error) {
		return { source, sourcePath, ok: false, reason: `创建工作区失败：${String(error?.message ?? error)}` };
	}

	const sessionId = plan.sessionId;
	const targetDir = path.join(home, "sessions", projectKey(realCwd), encodeSegment(sessionId));
	if (fs.existsSync(targetDir)) return { source, sourcePath, ok: false, reason: "目标会话目录已存在" };
	let wrote = false;
	try {
		await fsp.mkdir(targetDir, { recursive: true });
		await writeFileDurable(path.join(targetDir, "session.v4.jsonl.zstd"), zstdOneFrame(plan.eventText));
		await fsyncDir(targetDir);
		wrote = true;
		const header = {
			type: "session",
			version: 4,
			id: sessionId,
			createdAt: JSON.parse(plan.eventText.split("\n")[0]).createdAt,
			cwd: realCwd,
			isSeeded: false,
			delegationDepth: 0,
			agentPreset: "standard",
		};
		injectCachedHeader(registry, header, realCwd);
		await workspace.attachSession(sessionId);
		const ledger = await readLedger();
		ledger.entries = ledger.entries ?? {};
		ledger.workspaces = ledger.workspaces ?? {};
		ledger.batches = Array.isArray(ledger.batches) ? ledger.batches : [];
		ledger.entries[ledgerKey(plan.source, sourcePath)] = {
			source: plan.source,
			sourcePath,
			sessionId,
			workspace: { id: workspace.id, title: workspace.title ?? workspace.id, created: workspaceCreated },
			mode: plan.mode,
			batch: options.batch ?? new Date().toISOString().slice(0, 16),
			importedAt: new Date().toISOString(),
			sourceHash: await hashFile(sourcePath),
			cwd: realCwd,
			title: plan.title,
		};
		ledger.workspaces[workspace.id] = {
			id: workspace.id,
			title: workspace.title ?? workspace.id,
			path: realCwd,
			created: workspaceCreated,
			createdAt: ledger.workspaces[workspace.id]?.createdAt ?? new Date().toISOString(),
		};
		await writeLedger(ledger);
		return {
			source: plan.source,
			sourcePath,
			ok: true,
			sessionId,
			workspace: { id: workspace.id, title: workspace.title ?? workspace.id, created: workspaceCreated },
			workspaceId: workspace.id,
			mode: plan.mode,
			turns: plan.turns,
			note: plan.note,
		};
	} catch (error) {
		const reason = String(error?.message ?? error);
		try {
			if (wrote) await fsp.rm(targetDir, { recursive: true, force: true });
			try {
				await workspace.detachSession(sessionId);
			} catch {
				/* not attached */
			}
		} catch {
			/* rollback best effort */
		}
		return { source, sourcePath, ok: false, reason };
	}
}

/** Import several transcripts of one source serially, tagged with one batch id. */
export async function importSessions(ctx, source, sourcePaths, options = {}) {
	const results = [];
	const batch = options.batch ?? `${new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-")}-${source}`;
	for (const sourcePath of sourcePaths) {
		results.push(await importOne(ctx, source, sourcePath, { ...options, batch }));
	}
	const okCount = results.filter((result) => result.ok).length;
	return { ok: true, source, batch, imported: okCount, results };
}

/** Delete sessions recorded in the ledger; never removes workspaces. */
export async function rollbackSessions(ctx, sessionIds) {
	const registry = getRegistry(ctx);
	const home = homeDir();
	const ledger = await readLedger();
	const projectDirs = await listProjectDirs(home);
	const results = [];
	for (const sessionId of sessionIds) {
		const record = Object.entries(ledger.entries ?? {}).find(([, value]) => value?.sessionId === sessionId);
		let ok = true;
		const reasons = [];
		const dir = await findSessionDir(projectDirs, sessionId);
		if (dir !== undefined) {
			try {
				await fsp.rm(dir, { recursive: true, force: true });
			} catch (error) {
				ok = false;
				reasons.push(`删除会话目录失败：${String(error?.message ?? error)}`);
			}
		}
		if (registry !== undefined) {
			const workspace = registry.list().find((entry) => entry.sessionIds.includes(sessionId));
			if (workspace !== undefined) {
				try {
					await workspace.detachSession(sessionId);
				} catch (error) {
					ok = false;
					reasons.push(`解除归属失败：${String(error?.message ?? error)}`);
				}
			}
		}
		if (record !== undefined) {
			delete ledger.entries[record[0]];
			try {
				await writeLedger(ledger);
			} catch (error) {
				ok = false;
				reasons.push(`更新账本失败：${String(error?.message ?? error)}`);
			}
		}
		results.push({ sessionId, ok, reason: reasons.length > 0 ? reasons.join("；") : undefined });
	}
	return { ok: true, results };
}

/* ------------------------------------------------------------------ */
/* http helpers + routes                                               */
/* ------------------------------------------------------------------ */

function sendJson(response, status, payload) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(payload));
}

function sameOrigin(request) {
	// Settings panes render inside a sandboxed iframe (Origin: "null") and the
	// GUI may use dsh-app: or a local http port. This server only listens on
	// localhost, so absent/opaque origins are accepted while real cross-site
	// origins are still rejected by host comparison.
	const origin = request.headers.origin;
	if (!origin || origin === "null") return true;
	try {
		const url = new URL(origin);
		if (url.protocol === "dsh-app:") return true;
		return url.host === request.headers.host;
	} catch {
		return true;
	}
}

async function readJson(request, maxBytes = MAX_BODY) {
	const chunks = [];
	let size = 0;
	for await (const part of request) {
		const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
		size += chunk.length;
		if (size > maxBytes) throw new Error("请求体过大");
		chunks.push(chunk);
	}
	if (size === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
		child.effect(
			() =>
				child.webServer.register({
					kind: "prefix",
					path: PREFIX,
					handler: async (request, response) => {
						const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
						const route = url.pathname.slice(PREFIX.length) || "/";
						try {
							if (request.method === "GET" && route === "/api/sources") {
								sendJson(response, 200, await sourceSummaries(child));
								return;
							}
							if (request.method === "GET" && route === "/api/scan") {
								const source = url.searchParams.get("source") === "claude" ? "claude" : "codex";
								sendJson(response, 200, await scanSource(child, source));
								return;
							}
							if (request.method === "GET" && route === "/api/history") {
								const ledger = await readLedger();
								sendJson(response, 200, { ok: true, batches: historyOf(ledger) });
								return;
							}
							if (request.method === "GET" && route === "/api/cleanup-workspaces") {
								sendJson(response, 200, await cleanupCandidates(child));
								return;
							}
							if (request.method === "GET" && route === "/api/preview") {
								const source = url.searchParams.get("source") === "claude" ? "claude" : "codex";
								const sourcePath = url.searchParams.get("sourcePath") ?? "";
								const mode = url.searchParams.get("mode") === "full" ? "full" : "handoff";
								const plan = await planImport(source, sourcePath, { mode, force: true });
								if (!plan.ok) {
									sendJson(response, 400, { ok: false, reason: plan.reason });
									return;
								}
								sendJson(response, 200, {
									ok: true,
									source: plan.source,
									mode: plan.mode,
									title: plan.title,
									cwd: plan.cwd,
									turns: plan.turns,
									totalTurns: plan.totalTurns,
									huge: plan.huge,
									note: plan.note,
									handoff: mode === "handoff" ? extractHandoff(plan.eventText) : "",
								});
								return;
							}
							if (request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								if (route === "/api/import") {
									const paths = Array.isArray(body.sourcePaths) ? body.sourcePaths.filter((item) => typeof item === "string") : [];
									const source = body.source === "claude" ? "claude" : "codex";
									if (paths.length === 0) {
										sendJson(response, 400, { ok: false, error: "sourcePaths 不能为空" });
										return;
									}
									sendJson(
										response,
										200,
										await importSessions(child, source, paths, {
											mode: body.mode,
											maxRecentTurns: body.maxRecentTurns,
											force: body.force === true,
										}),
									);
									return;
								}
								if (route === "/api/rollback") {
									const ids = Array.isArray(body.sessionIds) ? body.sessionIds.filter((item) => typeof item === "string") : [];
									if (ids.length === 0) {
										sendJson(response, 400, { ok: false, error: "sessionIds 不能为空" });
										return;
									}
									sendJson(response, 200, await rollbackSessions(child, ids));
									return;
								}
								if (route === "/api/cleanup-workspaces") {
									const ids = Array.isArray(body.workspaceIds)
										? body.workspaceIds.filter((item) => typeof item === "string")
										: [];
									if (ids.length === 0) {
										sendJson(response, 400, { ok: false, error: "workspaceIds 不能为空" });
										return;
									}
									sendJson(response, 200, await cleanupWorkspaces(child, ids));
									return;
								}
							}
							sendJson(response, 404, { ok: false, error: "not found" });
						} catch (error) {
							sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
						}
					},
				}),
			"codex-import: routes",
		);
	});
}

/** Pull the handoff body back out of a planned session's first user message. */
function extractHandoff(eventText) {
	for (const line of eventText.split("\n")) {
		if (line.length === 0) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === "user/message") return event.data?.content?.[0]?.text ?? "";
		} catch {
			/* skip */
		}
	}
	return "";
}

