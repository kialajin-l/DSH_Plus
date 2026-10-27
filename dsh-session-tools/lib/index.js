/**
 * dsh-session-tools — host half.
 *
 * Read-only session tooling: workspace listing, per-session timeline, Markdown
 * transcript export (single + ZIP batch), and batch archive through the
 * workspace registry. Never edits session logs.
 */
import fsp from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { homedir } from "node:os";
import zlib from "node:zlib";

export const name = "dsh-session-tools";

const PREFIX = "/session-tools";
const MAX_BODY = 1_000_000;
const MAX_SESSION_BYTES = 64 * 1024 * 1024;
const ZSTD_MAGIC = 0xfd2fb528;

/* ------------------------------------------------------------------ */
/* home + path encoding (mirrors dsh-session-persistence-jsonl)         */
/* ------------------------------------------------------------------ */

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(homedir(), ".dsh");
}

export function projectKey(cwd) {
	if (!cwd) throw new Error("empty cwd");
	let readable = "";
	let run = false;
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i);
		const ch = String.fromCharCode(code);
		if (ch === "/" || ch === "\\" || ch === ":") {
			if (!run) readable += "-";
			run = true;
		} else if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch;
			run = false;
		} else {
			readable += "~" + code.toString(16).toUpperCase().padStart(4, "0");
			run = false;
		}
	}
	return `--${(readable.replace(/^-+/, "") || "root").slice(0, 251)}--`;
}

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

/* ------------------------------------------------------------------ */
/* zstd multi-frame decode                                             */
/* ------------------------------------------------------------------ */

function frameRanges(buf) {
	const out = [];
	let p = 0;
	while (p + 4 <= buf.length) {
		if (buf.readUInt32LE(p) !== ZSTD_MAGIC) throw new Error(`bad zstd magic at ${p}`);
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
			const h = buf.readUIntLE(p, 3);
			p += 3;
			const last = h & 1;
			const type = (h >> 1) & 3;
			const size = h >> 3;
			p += type === 1 ? 1 : size;
			if (last) break;
			if (p > buf.length) throw new RangeError("truncated zstd frame");
		}
		if (checksum) p += 4;
		if (p > buf.length) throw new RangeError("truncated zstd frame");
		out.push({ start, end: p });
	}
	return out;
}

function decodeLog(buf, zstd) {
	if (!zstd) return buf.toString("utf8");
	const parts = [];
	for (const frame of frameRanges(buf)) parts.push(zlib.zstdDecompressSync(buf.subarray(frame.start, frame.end)));
	return Buffer.concat(parts).toString("utf8");
}

/* ------------------------------------------------------------------ */
/* session discovery                                                   */
/* ------------------------------------------------------------------ */

async function listProjectDirs(home) {
	const root = path.join(home, "sessions");
	let entries;
	try {
		entries = await fsp.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
}

function isLogName(file) {
	return /^session\.(?:v\d+\.)?jsonl(?:\.zstd)?$/.test(file);
}

function logVersion(file) {
	const match = /^session\.v(\d+)\.jsonl/.exec(file);
	return match === null ? 0 : Number(match[1]);
}

function logZstd(file) {
	return file.endsWith(".zstd");
}

async function listLogFiles(sessionDir) {
	let names;
	try {
		names = await fsp.readdir(sessionDir);
	} catch {
		return [];
	}
	const files = [];
	for (const file of names) {
		if (!isLogName(file)) continue;
		const full = path.join(sessionDir, file);
		try {
			const stat = await fsp.stat(full);
			if (!stat.isFile()) continue;
			files.push({ file, full, size: stat.size, version: logVersion(file), zstd: logZstd(file) });
		} catch {
			/* ignore */
		}
	}
	return files;
}

function pickPrimaryLog(files) {
	let best;
	for (const entry of files) {
		if (
			best === undefined ||
			entry.version > best.version ||
			(entry.version === best.version && entry.zstd && !best.zstd)
		) {
			best = entry;
		}
	}
	return best;
}

/** Locate one session's project directory by scanning every project folder. */
async function findSessionDir(projectDirs, id) {
	const segment = encodeSegment(id);
	for (const dir of projectDirs) {
		const candidate = path.join(dir, segment);
		try {
			const stat = await fsp.stat(candidate);
			if (stat.isDirectory()) return candidate;
		} catch {
			/* keep scanning */
		}
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/* log parsing                                                         */
/* ------------------------------------------------------------------ */

function textOf(content) {
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (block === null || typeof block !== "object") continue;
		if (block.type !== "text" || typeof block.text !== "string") continue;
		if (block.text.length > 0) parts.push(block.text);
	}
	return parts.join("\n").trim();
}

function clockOf(ms) {
	const date = new Date(ms);
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
		date.getMinutes(),
	)}:${pad(date.getSeconds())}`;
}

/** Harness-injected user-role blocks are context, not something the user typed. */
function isInjectedText(text) {
	const head = text.trimStart();
	return (
		head.startsWith("<system-reminder>") ||
		head.startsWith("<novel-studio-context>") ||
		head.startsWith("Current runtime context.") ||
		head.startsWith("Time sampled while preparing")
	);
}

/** Parse one decoded log into the handful of facts the routes need. */
function parseSession(text) {
	const result = {
		header: undefined,
		title: "",
		createdAt: undefined,
		lastTime: 0,
		turns: 0,
		models: [],
		timeline: [],
		transcript: [],
	};
	const modelSeen = new Set();
	let currentTurn = 0;
	let current = undefined;
	const calls = new Map();
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		const time = typeof event.time === "number" ? event.time : 0;
		if (time > result.lastTime) result.lastTime = time;
		switch (event.type) {
			case "session": {
				result.header = event;
				result.createdAt = typeof event.createdAt === "number" ? event.createdAt : event.time;
				break;
			}
			case "session/title": {
				if (typeof event.data?.title === "string" && event.data.title.trim().length > 0) {
					result.title = event.data.title.trim();
				}
				break;
			}
			case "turn/start": {
				const turn = typeof event.data?.turn === "number" ? event.data.turn : currentTurn + 1;
				currentTurn = turn;
				result.turns += 1;
				current = { turn, time, prompt: "", answer: "", tokens: 0 };
				result.timeline.push(current);
				break;
			}
			case "user/message": {
				const body = textOf(event.data?.content);
				const real = body.length > 0 && !isInjectedText(body);
				if (current === undefined) {
					currentTurn += 1;
					current = { turn: currentTurn, time, prompt: "", answer: "", tokens: 0 };
					result.timeline.push(current);
				}
				if (real) current.prompt = current.prompt.length > 0 ? `${current.prompt}\n\n${body}` : body;
				result.transcript.push({ kind: "user", turn: current.turn, time, text: real ? body : "" });
				break;
			}
			case "assistant/message": {
				const body = textOf(event.data?.message?.content);
				const usage = event.data?.usage;
				const tokens = typeof usage?.totalTokens === "number"
					? usage.totalTokens
					: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0) + (usage?.cacheReadTokens ?? 0) + (usage?.cacheWriteTokens ?? 0);
				if (current !== undefined) {
					if (body.length > 0) current.answer = current.answer.length > 0 ? `${current.answer}\n\n${body}` : body;
					current.tokens += tokens;
				}
				result.transcript.push({ kind: "assistant", turn: current?.turn ?? currentTurn, time, text: body, tokens });
				break;
			}
			case "tool/call": {
				const callId = typeof event.data?.callId === "string" ? event.data.callId : "";
				const entry = {
					kind: "tool",
					turn: current?.turn ?? currentTurn,
					time,
					name: typeof event.data?.name === "string" ? event.data.name : "tool",
					arguments: typeof event.data?.arguments === "string" ? event.data.arguments : "",
					result: "",
				};
				if (callId.length > 0) calls.set(callId, entry);
				result.transcript.push(entry);
				break;
			}
			case "tool/result": {
				const callId = typeof event.data?.toolCallId === "string" ? event.data.toolCallId : "";
				const entry = callId.length > 0 ? calls.get(callId) : undefined;
				const body = textOf(event.data?.content);
				if (entry !== undefined) entry.result = body;
				else result.transcript.push({ kind: "tool", turn: current?.turn ?? currentTurn, time, name: "tool", arguments: "", result: body });
				break;
			}
			case "request/header": {
				const model = event.data?.header?.config?.model;
				const provider = event.data?.header?.config?.provider;
				if (typeof model === "string" && !modelSeen.has(`${provider ?? ""}/${model}`)) {
					modelSeen.add(`${provider ?? ""}/${model}`);
					result.models.push(provider === undefined ? model : `${provider}/${model}`);
				}
				break;
			}
			case "model/selection": {
				const model = event.data?.model;
				const provider = event.data?.provider;
				if (typeof model === "string" && !modelSeen.has(`${provider ?? ""}/${model}`)) {
					modelSeen.add(`${provider ?? ""}/${model}`);
					result.models.push(provider === undefined ? model : `${provider}/${model}`);
				}
				break;
			}
			default:
				break;
		}
	}
	if (result.title.length === 0) {
		const fallback = result.transcript.find((entry) => entry.kind === "user" && entry.text.length > 0);
		result.title = fallback === undefined ? "" : fallback.text.split(/\r?\n/u)[0].slice(0, 60);
	}
	return result;
}

const cache = new Map();

async function loadSession(home, id) {
	const projectDirs = await listProjectDirs(home);
	const dir = await findSessionDir(projectDirs, id);
	if (dir === undefined) return undefined;
	const primary = pickPrimaryLog(await listLogFiles(dir));
	if (primary === undefined) return undefined;
	const key = `${primary.full}`;
	const cached = cache.get(key);
	if (cached !== undefined && cached.size === primary.size && cached.mtimeMs === primary.mtimeMs) return cached.data;
	if (primary.size > MAX_SESSION_BYTES) throw new Error("\u4f1a\u8bdd\u65e5\u5fd7\u8fc7\u5927");
	const stat = await fsp.stat(primary.full);
	const buf = await fsp.readFile(primary.full);
	const parsed = parseSession(decodeLog(buf, primary.zstd));
	const data = { ...parsed, size: primary.size, dir };
	cache.set(key, { size: stat.size, mtimeMs: stat.mtimeMs, data });
	return data;
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

/**
 * Encode a session log as the persistence backend expects it: the first zstd
 * frame carries exactly the header line and every later frame carries events.
 */
function encodeLogFrames(headerLine, bodyText) {
	const flag = zlib.constants?.ZSTD_c_checksumFlag;
	const options = flag === undefined ? undefined : { params: { [flag]: 1 } };
	const frames = [zlib.zstdCompressSync(Buffer.from(`${headerLine}\n`, "utf8"), options)];
	const body = bodyText.endsWith("\n") ? bodyText : `${bodyText}\n`;
	if (body.trim().length > 0) frames.push(zlib.zstdCompressSync(Buffer.from(body, "utf8"), options));
	return Buffer.concat(frames);
}

const HEADER_KEYS = new Set([
	"type",
	"version",
	"id",
	"createdAt",
	"cwd",
	"isSeeded",
	"delegationDepth",
	"agentPreset",
	"parentSession",
	"origin",
]);

function cloneHeader(header, id) {
	const out = {};
	for (const key of HEADER_KEYS) {
		if (Object.hasOwn(header, key)) out[key] = header[key];
	}
	out.type = "session";
	out.version = 4;
	out.id = id;
	out.createdAt = Date.now();
	return out;
}

/** Publish one header into the registry's boot-built index (session-move pattern). */
function injectCachedHeader(registry, header, canonicalPath) {
	if (!(registry?.headers instanceof Map)) return false;
	registry.headers.set(header.id, header);
	if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(header.id, canonicalPath);
	registry.missingSessionPaths?.delete?.(header.id);
	registry.invalidSessionPaths?.delete?.(header.id);
	return true;
}

/**
 * Rewrite the producer-owned identity fields an event may carry. Delivery
 * markers and job ownership name their Session, so a verbatim copy would name
 * the source Session and fail adoption.
 */
function rewriteSessionRefs(value, fromId, toId) {
	if (Array.isArray(value)) {
		for (const item of value) rewriteSessionRefs(item, fromId, toId);
		return value;
	}
	if (value !== null && typeof value === "object") {
		for (const key of Object.keys(value)) {
			const current = value[key];
			if (current === fromId && (key === "sessionId" || key === "owner" || key === "session")) {
				value[key] = toId;
				continue;
			}
			rewriteSessionRefs(current, fromId, toId);
		}
	}
	return value;
}

/** Clone one persisted session in place: new id, same cwd, same transcript. */
async function duplicateSession(ctx, home, sessionId) {
	const sessions = ctx.get("sessions");
	if (sessions !== undefined && typeof sessions.get === "function" && sessions.get(sessionId) !== undefined) {
		return { ok: false, sessionId, reason: "会话正在运行，先切换到别的会话再复制" };
	}
	const dir = await findSessionDir(await listProjectDirs(home), sessionId);
	if (dir === undefined) return { ok: false, sessionId, reason: "会话不存在" };
	const primary = pickPrimaryLog(await listLogFiles(dir));
	if (primary === undefined) return { ok: false, sessionId, reason: "找不到会话日志" };
	if (primary.size > MAX_SESSION_BYTES) {
		return { ok: false, sessionId, reason: `会话日志过大（${(primary.size / 1048576).toFixed(1)} MB），暂不支持复制` };
	}
	const text = decodeLog(await fsp.readFile(primary.full), primary.zstd);
	const lines = text.split("\n").filter((line) => line.length > 0);
	if (lines.length === 0) return { ok: false, sessionId, reason: "会话日志为空" };
	let header;
	try {
		header = JSON.parse(lines[0]);
	} catch {
		return { ok: false, sessionId, reason: "会话头无法解析" };
	}
	if (header?.type !== "session" || typeof header.id !== "string") {
		return { ok: false, sessionId, reason: "会话头格式不正确" };
	}
	if (header.isSeeded === true) return { ok: false, sessionId, reason: "种子会话不支持复制" };
	const cwd = typeof header.cwd === "string" && header.cwd.length > 0 ? path.resolve(header.cwd) : undefined;
	if (cwd === undefined) return { ok: false, sessionId, reason: "会话没有记录工作目录" };

	const newId = `session-${randomUUID()}`;
	const nextHeader = cloneHeader(header, newId);
	const bodyLines = lines.slice(1);
	let lastTitle = -1;
	for (let index = 0; index < bodyLines.length; index += 1) {
		try {
			if (JSON.parse(bodyLines[index])?.type === "session/title") lastTitle = index;
		} catch {
			/* keep original line */
		}
	}
	if (lastTitle >= 0) {
		try {
			const event = JSON.parse(bodyLines[lastTitle]);
			const title = typeof event.data?.title === "string" && event.data.title.trim().length > 0 ? event.data.title : "会话";
			event.data = { ...event.data, title: `${title}（副本）` };
			bodyLines[lastTitle] = JSON.stringify(event);
		} catch {
			/* leave the title untouched */
		}
	}
	for (let index = 0; index < bodyLines.length; index += 1) {
		if (!bodyLines[index].includes(sessionId)) continue;
		try {
			bodyLines[index] = JSON.stringify(rewriteSessionRefs(JSON.parse(bodyLines[index]), sessionId, newId));
		} catch {
			/* keep the original line */
		}
	}

	const targetDir = path.join(home, "sessions", projectKey(cwd), encodeSegment(newId));
	const finalFile = path.join(targetDir, "session.v4.jsonl.zstd");
	await fsp.mkdir(targetDir, { recursive: true });
	const tempFile = path.join(targetDir, `.tmp-${process.pid}-${Date.now()}`);
	try {
		await writeFileDurable(tempFile, encodeLogFrames(JSON.stringify(nextHeader), bodyLines.join("\n")));
		await fsp.rename(tempFile, finalFile);
		const verify = decodeLog(await fsp.readFile(finalFile), true);
		const verifyHeader = JSON.parse(verify.split("\n")[0]);
		if (verifyHeader?.id !== newId || verifyHeader?.cwd !== cwd) throw new Error("回读校验失败");
	} catch (error) {
		await fsp.rm(targetDir, { recursive: true, force: true });
		return { ok: false, sessionId, reason: `写入副本失败：${String(error?.message ?? error)}` };
	}

	const registry = ctx.get("workspaceRegistry");
	if (registry === undefined || typeof registry.get !== "function") {
		await fsp.rm(targetDir, { recursive: true, force: true });
		return { ok: false, sessionId, reason: "workspaceRegistry 不可用，无法登记副本归属" };
	}
	const workspaces = await loadWorkspaces(home);
	const owner = workspaces.find((workspace) => workspace.sessionIds.includes(sessionId));
	const entity = owner === undefined ? undefined : registry.get(owner.id);
	if (entity === undefined || typeof entity.attachSession !== "function") {
		await fsp.rm(targetDir, { recursive: true, force: true });
		return { ok: false, sessionId, reason: "无法确定原会话所属工作区，副本已回滚" };
	}
	try {
		injectCachedHeader(registry, nextHeader, cwd);
		await entity.attachSession(newId);
	} catch (error) {
		await fsp.rm(targetDir, { recursive: true, force: true });
		return { ok: false, sessionId, reason: `归属登记失败：${String(error?.message ?? error)}（已回滚）` };
	}
	return { ok: true, sessionId: newId, sourceId: sessionId };
}

async function loadWorkspaces(home) {
	const file = path.join(home, "storages", "workspace.json");
	try {
		const raw = JSON.parse(await fsp.readFile(file, "utf8"));
		const table = raw?.tables?.workspaces ?? {};
		return Object.entries(table).map(([id, value]) => ({
			id,
			title: typeof value?.title === "string" ? value.title : id,
			path: typeof value?.path === "string" ? value.path : "",
			sessionIds: Array.isArray(value?.sessionIds) ? value.sessionIds : [],
		}));
	} catch {
		return [];
	}
}

/* ------------------------------------------------------------------ */
/* markdown rendering                                                  */
/* ------------------------------------------------------------------ */

function truncate(text, max) {
	if (typeof text !== "string") return "";
	const clean = text.trim();
	return clean.length > max ? `${clean.slice(0, max)}\u2026` : clean;
}

function renderMarkdown(session) {
	const lines = [];
	const title = session.title.length > 0 ? session.title : session.header?.id ?? "session";
	lines.push(`# ${title}`, "");
	lines.push(`- \u4f1a\u8bdd ID\uff1a${session.header?.id ?? ""}`);
	lines.push(`- \u521b\u5efa\u65f6\u95f4\uff1a${session.createdAt === undefined ? "" : clockOf(session.createdAt)}`);
	if (session.header?.cwd !== undefined) lines.push(`- \u5de5\u4f5c\u76ee\u5f55\uff1a${session.header.cwd}`);
	if (session.models.length > 0) lines.push(`- \u6a21\u578b\uff1a${session.models.join("\u3001")}`);
	lines.push("", "---", "");
	for (const entry of session.transcript) {
		if (entry.kind === "user") {
			if (entry.text.length === 0) continue;
			lines.push(`## \u7b2c ${entry.turn} \u8f6e \u00b7 \u7528\u6237\uff08${clockOf(entry.time)}\uff09`, "", entry.text, "");
		} else if (entry.kind === "assistant") {
			if (entry.text.length === 0) continue;
			lines.push(`## \u7b2c ${entry.turn} \u8f6e \u00b7 \u52a9\u624b\uff08${clockOf(entry.time)}\uff09`, "", entry.text, "");
		} else if (entry.kind === "tool") {
			lines.push(`### \u5de5\u5177\u8c03\u7528 ${entry.name}`, "");
			if (entry.arguments.length > 0) {
				lines.push("```json", truncate(entry.arguments, 500), "```", "");
			}
			if (entry.result.length > 0) {
				lines.push(truncate(entry.result, 800), "");
			}
		}
	}
	return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* minimal ZIP writer (STORE, CRC32)                                   */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i += 1) {
		let c = i;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[i] = c >>> 0;
	}
	return table;
})();

function crc32(buf) {
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i += 1) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
	const now = new Date();
	const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2)) & 0xffff;
	const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
	const locals = [];
	const centrals = [];
	let offset = 0;
	for (const file of files) {
		const name = Buffer.from(file.name, "utf8");
		const data = file.data;
		const crc = crc32(data);
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(0x0800, 6);
		local.writeUInt16LE(0, 8);
		local.writeUInt16LE(dosTime, 10);
		local.writeUInt16LE(dosDate, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(data.length, 18);
		local.writeUInt32LE(data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, data);
		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4);
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(0, 10);
		central.writeUInt16LE(dosTime, 12);
		central.writeUInt16LE(dosDate, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(data.length, 20);
		central.writeUInt32LE(data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += local.length + name.length + data.length;
	}
	const centralBuf = Buffer.concat(centrals);
	const eocd = Buffer.alloc(22);
	eocd.writeUInt32LE(0x06054b50, 0);
	eocd.writeUInt16LE(0, 4);
	eocd.writeUInt16LE(0, 6);
	eocd.writeUInt16LE(files.length, 8);
	eocd.writeUInt16LE(files.length, 10);
	eocd.writeUInt32LE(centralBuf.length, 12);
	eocd.writeUInt32LE(offset, 16);
	eocd.writeUInt16LE(0, 20);
	return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ------------------------------------------------------------------ */
/* http helpers                                                        */
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
		if (size > maxBytes) throw new Error("\u8bf7\u6c42\u4f53\u8fc7\u5927");
		chunks.push(chunk);
	}
	if (size === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function safeFileName(title, id) {
	const base = (title.length > 0 ? title : id).replace(/[\\/:*?"<>|]/gu, "-").trim().slice(0, 60);
	return `${base.length > 0 ? base : id}-${id.slice(0, 8)}.md`;
}

function stamp() {
	const date = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(
		date.getMinutes(),
	)}${pad(date.getSeconds())}`;
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
		const home = homeDir();
		const route = {
			kind: "prefix",
			path: PREFIX,
			handler: async (request, response) => {
				const host = request.headers.host ?? "127.0.0.1";
				const url = new URL(request.url ?? PREFIX, `http://${host}`);
				const pathname = url.pathname;
				try {
					if (pathname === `${PREFIX}/api/list` && request.method === "GET") {
						const workspaces = await loadWorkspaces(home);
						const output = [];
						for (const workspace of workspaces) {
							const sessions = [];
							for (const id of workspace.sessionIds) {
								let parsed;
								try {
									parsed = await loadSession(home, id);
								} catch {
									parsed = undefined;
								}
								const at = parsed?.lastTime ?? 0;
								sessions.push({
									id,
									title: parsed?.title ?? "",
									bytes: parsed?.size ?? 0,
									lastTime: at,
									turns: parsed?.turns ?? null,
								});
							}
							sessions.sort((left, right) => right.lastTime - left.lastTime);
							output.push({ id: workspace.id, title: workspace.title, path: workspace.path, sessions });
						}
						output.sort((left, right) => {
							const leftAt = Math.max(0, ...left.sessions.map((entry) => entry.lastTime));
							const rightAt = Math.max(0, ...right.sessions.map((entry) => entry.lastTime));
							return rightAt - leftAt;
						});
						sendJson(response, 200, { ok: true, workspaces: output });
						return;
					}
					if (pathname === `${PREFIX}/api/timeline` && request.method === "GET") {
						const id = url.searchParams.get("sessionId") ?? "";
						if (id.length === 0) {
							sendJson(response, 400, { ok: false, error: "sessionId \u4e0d\u80fd\u4e3a\u7a7a" });
							return;
						}
						const session = await loadSession(home, id);
						if (session === undefined) {
							sendJson(response, 404, { ok: false, error: "\u4f1a\u8bdd\u4e0d\u5b58\u5728" });
							return;
						}
						const turns = session.timeline.map((entry) => ({
							turn: entry.turn,
							time: entry.time,
							prompt: truncate(entry.prompt, 200),
							answer: truncate(entry.answer, 300),
							tokens: entry.tokens,
						}));
						sendJson(response, 200, { ok: true, id, title: session.title, turns });
						return;
					}
					if (pathname === `${PREFIX}/api/markdown` && request.method === "GET") {
						const id = url.searchParams.get("sessionId") ?? "";
						if (id.length === 0) {
							sendJson(response, 400, { ok: false, error: "sessionId \u4e0d\u80fd\u4e3a\u7a7a" });
							return;
						}
						const session = await loadSession(home, id);
						if (session === undefined) {
							sendJson(response, 404, { ok: false, error: "\u4f1a\u8bdd\u4e0d\u5b58\u5728" });
							return;
						}
						const body = renderMarkdown(session);
						response.writeHead(200, {
							"cache-control": "no-store",
							"content-type": "text/markdown; charset=utf-8",
							"content-disposition": `attachment; filename="${encodeURIComponent(safeFileName(session.title, id))}"`,
						});
						response.end(body);
						return;
					}
					if (pathname === `${PREFIX}/api/export` && request.method === "POST") {
						if (!sameOrigin(request)) {
							sendJson(response, 403, { ok: false, error: "\u62d2\u7edd\u8de8\u6e90\u6216\u975e POST \u8bf7\u6c42" });
							return;
						}
						const body = await readJson(request);
						const ids = Array.isArray(body?.sessionIds) ? body.sessionIds.filter((id) => typeof id === "string") : [];
						if (ids.length === 0) {
							sendJson(response, 400, { ok: false, error: "\u672a\u9009\u62e9\u4f1a\u8bdd" });
							return;
						}
						const files = [];
						for (const id of ids) {
							const session = await loadSession(home, id);
							if (session === undefined) continue;
							files.push({
								name: safeFileName(session.title, id),
								data: Buffer.from(renderMarkdown(session), "utf8"),
							});
						}
						if (files.length === 0) {
							sendJson(response, 404, { ok: false, error: "\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u4f1a\u8bdd" });
							return;
						}
						const zip = zipStore(files);
						response.writeHead(200, {
							"cache-control": "no-store",
							"content-type": "application/zip",
							"content-disposition": `attachment; filename="dsh-sessions-${stamp()}.zip"`,
						});
						response.end(zip);
						return;
					}
					if (pathname === `${PREFIX}/api/archive` && request.method === "POST") {
						if (!sameOrigin(request)) {
							sendJson(response, 403, { ok: false, error: "\u62d2\u7edd\u8de8\u6e90\u6216\u975e POST \u8bf7\u6c42" });
							return;
						}
						const registry = child.get("workspaceRegistry");
						if (registry === undefined || typeof registry.archiveSession !== "function") {
							sendJson(response, 503, { ok: false, error: "workspaceRegistry \u4e0d\u53ef\u7528" });
							return;
						}
						const body = await readJson(request);
						const ids = Array.isArray(body?.sessionIds) ? body.sessionIds.filter((id) => typeof id === "string") : [];
						if (ids.length === 0) {
							sendJson(response, 400, { ok: false, error: "\u672a\u9009\u62e9\u4f1a\u8bdd" });
							return;
						}
						const results = [];
						for (const id of ids) {
							try {
								await registry.archiveSession(id);
								results.push({ sessionId: id, ok: true });
							} catch (error) {
								results.push({ sessionId: id, ok: false, reason: String(error?.message ?? error) });
							}
						}
						sendJson(response, 200, { ok: true, results });
						return;
					}
					if (pathname === `${PREFIX}/api/duplicate` && request.method === "POST") {
						if (!sameOrigin(request)) {
							sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
							return;
						}
						const body = await readJson(request);
						const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
						if (sessionId.length === 0) {
							sendJson(response, 400, { ok: false, error: "sessionId 不能为空" });
							return;
						}
						sendJson(response, 200, await duplicateSession(child, home, sessionId));
						return;
					}
					if (url.pathname === "/session-tools/api/diag") {
						const id = url.searchParams.get("id") ?? "";
						const out = { ok: true, services: {} };
						const persistence = ctx.get("sessionPersistence");
						out.services.persistence = persistence !== undefined;
						if (persistence !== undefined) {
							try {
								const list = await persistence.list();
								out.persistenceCount = list.length;
								out.hasTarget = id.length > 0
									? list.some((row) => (row?.id ?? row?.header?.id) === id)
									: undefined;
							} catch (error) {
								out.persistenceError = String(error?.message ?? error);
							}
							if (id.length > 0) {
								try {
									const handle = await persistence.open(id, "read");
									out.openOk = true;
									await handle?.close?.();
								} catch (error) {
									out.openOk = false;
									out.openError = String(error?.message ?? error);
								}
							}
						}
						const sessions = ctx.get("sessions");
						out.services.sessions = sessions !== undefined;
						if (sessions !== undefined) {
							try {
								out.sessionCount = sessions.list().length;
							} catch (error) {
								out.sessionsError = String(error?.message ?? error);
							}
						}
						sendJson(response, 200, out);
						return;
					}
					sendJson(response, 404, { ok: false, error: "\u672a\u77e5\u8def\u5f84" });
				} catch (error) {
					sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
				}
			},
		};
		child.effect(() => child.webServer.register(route), "session-tools: routes");
	});
}

