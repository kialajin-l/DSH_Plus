/**
 * dsh-nexus-memory — host half.
 *
 * Bridges a local Nexus memory database into the conversation. Database paths
 * are configuration, not constants:
 *
 *   - config file: `<DSH home>/storages/nexus-memory.json`
 *   - first load registers an existing legacy path when present, otherwise the
 *     per-user defaults under `<DSH home>/storages/nexus-memory/{primary,code}`
 *
 * Routes:
 *   - `GET  /nexus-memory/api/config`               config + per-database status
 *   - `POST /nexus-memory/api/config`               save absolute paths
 *   - `POST /nexus-memory/api/config/create`        create an empty compatible DB
 *   - `GET  /nexus-memory/api/config/probe?path=`   read-only path probe
 *   - `GET  /nexus-memory/api/stats?db=primary|code`
 *   - `GET  /nexus-memory/api/projects?db=...`
 *   - `POST /nexus-memory/api/search`   { db, project, query, topK }
 *   - `POST /nexus-memory/api/feedback` { db, id, action }
 *   - `POST /nexus-memory/api/preview`  { cwd, sessionId }
 *
 * Every read goes through `py/bridge.py` (read-only SQLite handle). Nothing here
 * writes to the memory databases; only the user-initiated feedback call records
 * one feedback row inside the bridge itself.
 *
 * Automatic injection: the system-prompt provider must answer synchronously, so
 * the section serves a cached snippet and a background refresh warms it for the
 * next assembly. A missing database or failed bridge call degrades to an empty
 * section and never throws into the session.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

export const name = "dsh-nexus-memory";

const PREFIX = "/nexus-memory";
const MAX_BODY = 200_000;
const BRIDGE_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CONFIG_NAME = "nexus-memory.json";
const PLUGIN_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BRIDGE_PATH = path.join(PLUGIN_DIR, "py", "bridge.py");
const SCHEMA_PATH = path.join(PLUGIN_DIR, "py", "schema.sql");
const SKILL_SRC = process.env.NEXUS_SKILL_SRC ?? "C:\\Users\\Wayne\\.agents\\skills\\nexus\\src";
const LEGACY_PRIMARY = "H:\\k\\knowledge\\nexus-db\\primary\\nexus.db";
const LEGACY_CODE = "H:\\k\\knowledge\\nexus-db\\code\\nexus-code.db";

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(homedir(), ".dsh");
}

function pythonExe() {
	if (process.env.NEXUS_PYTHON) return process.env.NEXUS_PYTHON;
	return path.join(homeDir(), "dsh-runtimes", "dsh-primary-runtime", "dependencies", "python", process.platform === "win32" ? "python.exe" : "python3");
}

/* ------------------------------------------------------------------ */
/* configuration                                                       */
/* ------------------------------------------------------------------ */

function defaultPaths(home) {
	const base = path.join(home, "storages", "nexus-memory");
	return { primaryDb: path.join(base, "primary", "nexus.db"), codeDb: path.join(base, "code", "nexus.db") };
}

function configFile(home) {
	return path.join(home, "storages", CONFIG_NAME);
}

/** Keep only absolute, non-empty paths; anything else falls back to the default. */
function normalizeExtractDefaults(raw) {
	return {
		mode: raw?.mode === "model" ? "model" : "rules",
		provider: typeof raw?.provider === "string" ? raw.provider.trim() : "",
		model: typeof raw?.model === "string" ? raw.model.trim() : "",
	};
}

/** Keep only absolute, non-empty paths; anything else falls back to the default. */
function normalizeConfig(raw, home) {
	const fallback = defaultPaths(home);
	const pick = (value, nullish) =>
		typeof value === "string" && value.trim().length > 0 && path.isAbsolute(value.trim())
			? path.resolve(value.trim())
			: nullish;
	return {
		version: 1,
		primaryDb: pick(raw?.primaryDb, fallback.primaryDb),
		codeDb: pick(raw?.codeDb, fallback.codeDb),
		extractDefaults: normalizeExtractDefaults(raw?.extractDefaults),
	};
}

async function readConfig(home) {
	try {
		const raw = JSON.parse(await fsp.readFile(configFile(home), "utf8"));
		return normalizeConfig(raw, home);
	} catch {
		return undefined;
	}
}

async function writeConfig(home, config) {
	const target = configFile(home);
	await fsp.mkdir(path.dirname(target), { recursive: true });
	const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
	await fsp.writeFile(temp, JSON.stringify(config, null, 2), "utf8");
	await fsp.rename(temp, target);
}

/**
 * Load the configuration, creating it on first use. A machine that still has the
 * legacy Nexus databases keeps using them; everybody else gets zero-state
 * defaults that can be created from the settings page.
 */
async function loadConfig(home) {
	const existing = await readConfig(home);
	if (existing !== undefined) return existing;
	const fallback = defaultPaths(home);
	const initial = normalizeConfig(
		{
			primaryDb: existsSync(LEGACY_PRIMARY) ? LEGACY_PRIMARY : fallback.primaryDb,
			codeDb: existsSync(LEGACY_CODE) ? LEGACY_CODE : fallback.codeDb,
		},
		home,
	);
	try {
		await writeConfig(home, initial);
	} catch (error) {
		console.warn(`[nexus-memory] config write failed: ${String(error?.message ?? error)}`);
	}
	return initial;
}

async function saveConfig(home, patch) {
	const current = await loadConfig(home);
	const next = normalizeConfig({ ...current, ...patch }, home);
	await writeConfig(home, next);
	return next;
}

function pathFor(config, db) {
	return db === "code" ? config.codeDb : config.primaryDb;
}

async function probeDb(pathname) {
	if (typeof pathname !== "string" || pathname.length === 0) {
		return { exists: false, valid: false, error: "未配置路径" };
	}
	const result = await runBridge({ cmd: "probe", path: pathname });
	if (result?.ok !== true) {
		return { exists: false, valid: false, error: String(result?.error ?? "探测失败") };
	}
	return {
		exists: result.exists === true,
		valid: result.valid === true,
		total: Number.isFinite(result.total) ? Number(result.total) : 0,
		...(typeof result.error === "string" && result.error.length > 0 ? { error: result.error } : {}),
	};
}

async function configPayload(home, config, autoInject) {
	const [primary, code] = await Promise.all([probeDb(config.primaryDb), probeDb(config.codeDb)]);
	return {
		ok: true,
		config: { primaryDb: config.primaryDb, codeDb: config.codeDb, extractDefaults: config.extractDefaults },
		status: { primary, code },
		defaults: defaultPaths(home),
		configPath: configFile(home),
		autoInject,
	};
}

/* ------------------------------------------------------------------ */
/* bridge                                                              */
/* ------------------------------------------------------------------ */

function runBridge(payload) {
	return new Promise((resolve) => {
		let child;
		try {
			child = spawn(pythonExe(), [BRIDGE_PATH], {
				cwd: PLUGIN_DIR,
				env: { ...process.env, PYTHONPATH: SKILL_SRC, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			resolve({ ok: false, error: `无法启动 Python 桥：${String(error?.message ?? error)}` });
			return;
		}

		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				child.kill();
			} catch {
				/* already gone */
			}
			resolve(value);
		};
		const timer = setTimeout(() => finish({ ok: false, error: "Nexus 桥超时（20 秒）" }), BRIDGE_TIMEOUT_MS);

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", (error) => finish({ ok: false, error: `Python 桥启动失败：${String(error?.message ?? error)}` }));
		child.on("close", () => {
			if (stderr.trim().length > 0) console.warn(`[nexus-memory] bridge stderr: ${stderr.trim().slice(0, 400)}`);
			const start = stdout.indexOf("{");
			if (start < 0) {
				finish({ ok: false, error: `桥没有返回 JSON：${stdout.trim().slice(0, 200)}` });
				return;
			}
			try {
				finish(JSON.parse(stdout.slice(start)));
			} catch (error) {
				finish({ ok: false, error: `桥返回无效 JSON：${String(error?.message ?? error)}` });
			}
		});
		child.stdin.end(JSON.stringify(payload));
	});
}

/* ------------------------------------------------------------------ */
/* workspace / session metadata                                        */
/* ------------------------------------------------------------------ */

function canonical(target) {
	try {
		return path.resolve(target).toLowerCase().replace(/[\\/]+$/, "");
	} catch {
		return "";
	}
}

async function workspaceTitle(home, cwd) {
	try {
		const raw = await fsp.readFile(path.join(home, "storages", "workspace.json"), "utf8");
		const tables = JSON.parse(raw)?.tables?.workspaces ?? {};
		const wanted = canonical(cwd);
		for (const workspace of Object.values(tables)) {
			if (typeof workspace?.path === "string" && canonical(workspace.path) === wanted) {
				return typeof workspace.title === "string" ? workspace.title.trim() : "";
			}
		}
	} catch {
		/* no workspace index */
	}
	return "";
}

async function sessionTitle(home, sessionId) {
	if (!sessionId) return "";
	try {
		const file = path.join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`);
		const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
		const title = parsed?.record?.rows?.title?.val;
		return typeof title === "string" ? title.trim() : "";
	} catch {
		return "";
	}
}

/* ------------------------------------------------------------------ */
/* session transcript                                                  */
/* ------------------------------------------------------------------ */

const ZSTD_MAGIC = 0xfd2fb528;
const EXTRACT_DEFAULT_TURNS = 10;
const MODEL_EXTRACT_TIMEOUT_MS = 90_000;

/** Split a multi-frame zstd log into frame ranges (DSH writes one frame per batch). */
function frameRanges(buffer) {
	const ranges = [];
	let offset = 0;
	while (offset + 4 <= buffer.length) {
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
		const start = offset;
		offset += 4;
		if (offset >= buffer.length) break;
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
		offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		for (;;) {
			if (offset + 3 > buffer.length) return ranges;
			const header = buffer.readUIntLE(offset, 3);
			offset += 3;
			const last = header & 1;
			const type = (header >>> 1) & 3;
			const size = header >>> 3;
			offset += type === 1 ? 1 : size;
			if (last) break;
		}
		if (checksum) offset += 4;
		if (offset > buffer.length) break;
		ranges.push({ start, end: offset });
	}
	return ranges;
}

function decodeSessionText(buffer, zstd) {
	if (!zstd) return buffer.toString("utf8");
	const parts = [];
	for (const range of frameRanges(buffer)) {
		try {
			parts.push(zlib.zstdDecompressSync(buffer.subarray(range.start, range.end)));
		} catch {
			/* torn tail frame: keep the committed prefix */
		}
	}
	return Buffer.concat(parts).toString("utf8");
}

/** Injectively escape a session id into one directory name (same rule as DSH). */
function encodeSegment(raw) {
	let out = "";
	for (let index = 0; index < raw.length; index += 1) {
		const code = raw.charCodeAt(index);
		const ch = String.fromCharCode(code);
		if (ch !== "~" && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
		else out += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
	}
	return out;
}

function messageText(content) {
	return (Array.isArray(content) ? content : [])
		.filter((block) => block?.type === "text" && typeof block.text === "string")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

/** Drop harness-injected envelopes so extraction only sees authored prose. */
function cleanTranscriptText(text) {
	let out = String(text).trim();
	if (out.length === 0) return "";
	if (
		/^(?:<system-reminder>|Current runtime context\.|Time sampled while preparing|<novel-studio-context>|The approval policy changed)/iu.test(
			out,
		)
	) {
		return "";
	}
	out = out.replace(/<system-reminder[\s\S]*?<\/system-reminder>/giu, "").trim();
	return out;
}

function pairTranscriptTurns(messages) {
	const turns = [];
	let current;
	for (const message of messages) {
		if (message.role === "user") {
			if (current !== undefined) turns.push(current);
			current = { user: message.text, assistant: "" };
		} else if (current !== undefined) {
			current.assistant = current.assistant.length > 0 ? `${current.assistant}\n${message.text}` : message.text;
		}
	}
	if (current !== undefined) turns.push(current);
	return turns;
}

function formatTranscript(turns) {
	return turns
		.map((turn, index) =>
			[`Q${index + 1}: ${turn.user}`, turn.assistant.length > 0 ? `A${index + 1}: ${turn.assistant}` : ""]
				.filter((part) => part.length > 0)
				.join("\n"),
		)
		.join("\n\n");
}

/** Locate and decode one session log; read-only. */
async function readSessionLog(home, sessionId) {
	if (typeof sessionId !== "string" || sessionId.length === 0) return { ok: false, error: "缺少 sessionId" };
	const root = path.join(home, "sessions");
	let projectDirs;
	try {
		projectDirs = await fsp.readdir(root, { withFileTypes: true });
	} catch {
		return { ok: false, error: "找不到会话目录" };
	}
	const encoded = encodeSegment(sessionId);
	let dir;
	for (const entry of projectDirs) {
		if (!entry.isDirectory()) continue;
		const candidate = path.join(root, entry.name, encoded);
		if (existsSync(candidate)) {
			dir = candidate;
			break;
		}
	}
	if (dir === undefined) return { ok: false, error: "找不到该会话的日志文件" };
	let files;
	try {
		files = await fsp.readdir(dir);
	} catch {
		return { ok: false, error: "会话目录不可读" };
	}
	let best;
	let bestVersion = -1;
	let bestZstd = false;
	for (const fileName of files) {
		const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(fileName);
		if (match === null) continue;
		const version = match[1] === undefined ? 0 : Number(match[1]);
		const zstd = match[2] !== undefined;
		if (version > bestVersion || (version === bestVersion && zstd && !bestZstd)) {
			bestVersion = version;
			bestZstd = zstd;
			best = fileName;
		}
	}
	if (best === undefined) return { ok: false, error: "会话日志不存在" };
	let buffer;
	try {
		buffer = await fsp.readFile(path.join(dir, best));
	} catch (error) {
		return { ok: false, error: `会话日志不可读：${String(error?.message ?? error)}` };
	}
	const text = decodeSessionText(buffer, bestZstd);
	let cwd;
	let title;
	const messages = [];
	for (const line of text.split("\n")) {
		if (line.trim().length === 0) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === "session" && typeof event.cwd === "string") {
			cwd = event.cwd;
			continue;
		}
		if (event.type === "session/title" && typeof event.data?.title === "string") {
			title = event.data.title;
			continue;
		}
		if (event.type === "user/message") {
			const value = cleanTranscriptText(messageText(event.data?.content));
			if (value.length > 0) messages.push({ role: "user", text: value });
			continue;
		}
		if (event.type === "assistant/message") {
			const value = cleanTranscriptText(messageText(event.data?.message?.content));
			if (value.length > 0) messages.push({ role: "assistant", text: value });
		}
	}
	return { ok: true, id: sessionId, cwd, title, messages };
}

async function readSessionTranscript(home, sessionId, turnLimit) {
	const log = await readSessionLog(home, sessionId);
	if (log.ok !== true) return log;
	const limit = Number.isFinite(turnLimit) ? Math.max(1, Math.min(Number(turnLimit), 50)) : EXTRACT_DEFAULT_TURNS;
	const turns = pairTranscriptTurns(log.messages).slice(-limit);
	return { ok: true, id: sessionId, cwd: log.cwd, title: log.title, turns, text: formatTranscript(turns) };
}

/* ------------------------------------------------------------------ */
/* extraction                                                          */
/* ------------------------------------------------------------------ */

const EXTRACT_TYPES = ["fact", "decision", "preference", "rule", "todo"];
const EXTRACT_IMPORTANCE = { rule: 0.8, decision: 0.8, preference: 0.6, todo: 0.6, fact: 0.5 };
const CLASSIFIERS = [
	["rule", /(必须|禁止|不得|不要|只能|不允许|规则|约定|一律)/u],
	["decision", /(决定|采用|选择|改用|切换|定下|确定用|方案)/u],
	["preference", /(偏好|喜欢|习惯|优先|倾向|更愿意)/u],
	["todo", /(TODO|待办|下一步|接下来|后续|计划|待处理)/u],
	["fact", /(事实|结论|发现|确认|证明|现状|结果)/u],
];
const PLEASANTRY_RE = /^(好的|好|嗯|谢谢|多谢|继续|可以|收到|明白|OK|ok)[。.!！?？\s]*$/u;

function classifySentence(sentence) {
	for (const [type, pattern] of CLASSIFIERS) {
		if (pattern.test(sentence)) return type;
	}
	return "fact";
}

function normalizeMemoryKey(text) {
	return text.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase();
}

/** Rule-based extraction: no model call, deterministic. */
function extractCandidatesByRules(text, maxItems) {
	const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(Number(maxItems), 30)) : 12;
	const items = [];
	const seen = new Set();
	for (const paragraph of String(text).split(/\r?\n/u)) {
		for (const rawSentence of paragraph.split(/(?<=[。！？!?；;])\s*/u)) {
			const sentence = rawSentence.replace(/^[\s>*#\-•·\d)）.、]+/u, "").trim();
			if (sentence.length < 20 || sentence.length > 300) continue;
			if (PLEASANTRY_RE.test(sentence)) continue;
			const key = normalizeMemoryKey(sentence);
			if (key.length < 8 || seen.has(key)) continue;
			seen.add(key);
			const type = classifySentence(sentence);
			items.push({
				type,
				topic: sentence.slice(0, 24),
				content: sentence,
				summary: sentence.slice(0, 120),
				importance: EXTRACT_IMPORTANCE[type] ?? 0.5,
			});
			if (items.length >= limit) return items;
		}
	}
	if (items.length > 0) return items;
	// Prose without sentence punctuation: fall back to fixed windows.
	for (let offset = 0; offset < text.length && items.length < limit; offset += 600) {
		const chunk = String(text).slice(offset, offset + 600).trim();
		if (chunk.length < 20) continue;
		items.push({ type: "fact", topic: chunk.slice(0, 24), content: chunk.slice(0, 300), summary: chunk.slice(0, 120), importance: 0.5 });
	}
	return items;
}

function parseCandidateJson(output) {
	const start = output.indexOf("[");
	const end = output.lastIndexOf("]");
	if (start < 0 || end <= start) return undefined;
	let raw;
	try {
		raw = JSON.parse(output.slice(start, end + 1));
	} catch {
		return undefined;
	}
	if (!Array.isArray(raw)) return undefined;
	const items = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const content = typeof entry.content === "string" ? entry.content.trim() : "";
		if (content.length === 0) continue;
		const type = EXTRACT_TYPES.includes(entry.type) ? entry.type : "fact";
		const importance = Number.isFinite(entry.importance) ? Math.max(0, Math.min(1, Number(entry.importance))) : 0.5;
		items.push({
			type,
			topic:
				typeof entry.topic === "string" && entry.topic.trim().length > 0
					? entry.topic.trim().slice(0, 40)
					: content.slice(0, 24),
			content: content.slice(0, 500),
			summary:
				typeof entry.summary === "string" && entry.summary.trim().length > 0
					? entry.summary.trim().slice(0, 200)
					: content.slice(0, 120),
			importance,
		});
	}
	return items.length > 0 ? items : undefined;
}

async function extractCandidatesByModel(scope, text, model, maxItems) {
	let llm;
	try {
		llm = scope.get("llm");
	} catch {
		llm = undefined;
	}
	if (llm === undefined || typeof llm.stream !== "function") {
		return { ok: false, error: "当前环境没有可用的 LLM 服务，请改用规则提取" };
	}
	const provider = typeof model?.provider === "string" ? model.provider.trim() : "";
	const modelId = typeof model?.model === "string" ? model.model.trim() : "";
	if (provider.length === 0 || modelId.length === 0) return { ok: false, error: "未选择提取模型" };
	const limit = Number.isFinite(maxItems) ? Math.max(1, Math.min(Number(maxItems), 30)) : 12;
	const prompt = [
		"你是长期记忆提取器。从下面的会话文本中提取可长期复用的记忆。",
		`只输出严格 JSON 数组，最多 ${limit} 条，每条形如 {"type":"fact|decision|preference|rule|todo","topic":"简短主题","content":"20-300字的事实/决定/规则/偏好/待办","summary":"不超过80字","importance":0.0到1.0}`,
		"不要输出 Markdown 代码块或解释。只提取明确、可复用、不重复的内容；忽略寒暄与临时过程。",
		"",
		"会话文本：",
		String(text).slice(0, 12000),
	].join("\n");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), MODEL_EXTRACT_TIMEOUT_MS);
	let output = "";
	let finishKind;
	try {
		const stream = llm.stream({
			provider,
			model: modelId,
			messages: [{ role: "user", content: [{ type: "text", text: prompt }] }],
			signal: controller.signal,
		});
		for await (const chunk of stream) {
			if (chunk?.type === "text-delta" && typeof chunk.text === "string") output += chunk.text;
			else if (chunk?.type === "finish") finishKind = chunk?.reason?.kind ?? chunk?.finish?.kind ?? finishKind;
		}
	} catch (error) {
		return { ok: false, error: `模型调用失败：${String(error?.message ?? error)}` };
	} finally {
		clearTimeout(timer);
	}
	if (finishKind !== undefined && finishKind !== "stop") {
		return { ok: false, error: `模型未正常结束（${finishKind}）` };
	}
	const candidates = parseCandidateJson(output);
	if (candidates === undefined) {
		return { ok: false, error: `模型输出不是合法 JSON 数组：${output.slice(0, 160)}` };
	}
	return { ok: true, candidates: candidates.slice(0, limit), raw: output.slice(0, 2000) };
}

/** List providers/models the running Host can call, for the extraction dropdowns. */
async function listAvailableModels(scope) {
	let llm;
	try {
		llm = scope.get("llm");
	} catch {
		llm = undefined;
	}
	if (llm === undefined || typeof llm.listProviders !== "function" || typeof llm.listModels !== "function") {
		return { ok: false, error: "当前环境没有可用的 LLM 服务", providers: [] };
	}
	const providers = [];
	for (const entry of llm.listProviders()) {
		const id = typeof entry?.id === "string" ? entry.id : typeof entry?.provider === "string" ? entry.provider : "";
		if (id.length === 0) continue;
		const displayName = typeof entry?.displayName === "string" && entry.displayName.length > 0 ? entry.displayName : id;
		let models = [];
		let error;
		try {
			models = (await llm.listModels(id)).map((item) => ({
				id: item.id,
				name: typeof item.name === "string" && item.name.length > 0 ? item.name : item.id,
			}));
		} catch (failure) {
			error = String(failure?.message ?? failure);
		}
		providers.push({ id, displayName, models, ...(error === undefined ? {} : { error }) });
	}
	return { ok: true, providers };
}

/* ------------------------------------------------------------------ */
/* automatic injection                                                 */
/* ------------------------------------------------------------------ */

function createMemorySection(home, autoInject) {
	const cache = new Map();
	const pending = new Set();

	async function build(cwd, sessionId) {
		const config = await loadConfig(home);
		if (!existsSync(config.primaryDb)) return "";
		const project = await workspaceTitle(home, cwd);
		const title = await sessionTitle(home, sessionId);
		const query = [title, project].filter(Boolean).join(" ").trim() || project;
		if (!query) return "";
		const result = await runBridge({
			cmd: "inject",
			db: "primary",
			dbPath: config.primaryDb,
			project,
			query,
			maxTokens: 500,
			topK: 4,
			// Project-scoped only: a workspace that Nexus does not track as a
			// project must not receive unrelated global memories.
			fallbackGlobal: false,
		});
		if (!result?.ok || typeof result.text !== "string" || result.text.trim().length === 0) return "";
		return ["## Nexus 长期记忆", "", "以下是与当前工作区相关的历史记忆（只读，来自 Nexus）：", result.text.trim()].join("\n");
	}

	function text(context) {
		if (!autoInject) return "";
		const cwd = context?.agent?.session?.header?.cwd;
		if (typeof cwd !== "string" || cwd.length === 0) return "";
		const sessionId = context?.agent?.session?.header?.id ?? context?.agent?.session?.id ?? "";
		const key = `${canonical(cwd)}|${sessionId}`;
		const entry = cache.get(key);
		if (entry !== undefined && Date.now() - entry.at < CACHE_TTL_MS) return entry.text;
		if (!pending.has(key)) {
			pending.add(key);
			build(cwd, sessionId)
				.then((value) => cache.set(key, { at: Date.now(), text: value }))
				.catch(() => cache.set(key, { at: Date.now(), text: "" }))
				.finally(() => pending.delete(key));
		}
		return entry?.text ?? "";
	}
	text.preview = build;
	return text;
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
		if (size > maxBytes) throw new Error("请求体过大");
		chunks.push(chunk);
	}
	if (size === 0) return {};
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function pickDb(value) {
	return value === "code" ? "code" : "primary";
}

/** Empty statistics for an uninitialized database. */
function emptyStats(db) {
	return { ok: true, db, total: 0, byType: {}, byStatus: {}, projects: [], uninitialized: true };
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

export function apply(ctx, config) {
	const autoInject = config?.autoInject !== false;
	const home = homeDir();
	const section = createMemorySection(home, autoInject);

	ctx.inject(["webServer", "systemPrompt"], (child) => {
		let queue = Promise.resolve();
		const serialize = (task) => {
			const run = queue.then(task, task);
			queue = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		};

		child.effect(
			() => {
				const disposeContext = child.systemPrompt.context({
					name: "nexus:memory",
					order: 330,
					text: section,
				});
				const disposeRoutes = child.webServer.register({
					kind: "prefix",
					path: PREFIX,
					handler: async (request, response) => {
						const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
						try {
							if (url.pathname === `${PREFIX}/api/config` && request.method === "GET") {
								const current = await loadConfig(home);
								sendJson(response, 200, await configPayload(home, current, autoInject));
								return;
							}
							if (url.pathname === `${PREFIX}/api/config` && request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const patch = {};
								for (const key of ["primaryDb", "codeDb"]) {
									if (body?.[key] === undefined) continue;
									if (typeof body[key] !== "string" || body[key].trim().length === 0) {
										sendJson(response, 400, { ok: false, error: `${key} 必须是非空字符串` });
										return;
									}
									if (!path.isAbsolute(body[key].trim())) {
										sendJson(response, 400, { ok: false, error: `${key} 必须是绝对路径` });
										return;
									}
									patch[key] = body[key].trim();
								}
								if (body?.extractDefaults !== undefined) {
									if (typeof body.extractDefaults !== "object" || body.extractDefaults === null) {
										sendJson(response, 400, { ok: false, error: "extractDefaults 必须是对象" });
										return;
									}
									patch.extractDefaults = normalizeExtractDefaults(body.extractDefaults);
								}
								const next = await serialize(() => saveConfig(home, patch));
								sendJson(response, 200, await configPayload(home, next, autoInject));
								return;
							}
							if (url.pathname === `${PREFIX}/api/config/create` && request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const which = pickDb(body?.db);
								const current = await loadConfig(home);
								const target = pathFor(current, which);
								if (existsSync(target)) {
									sendJson(response, 200, { ok: false, error: "已存在", path: target });
									return;
								}
								if (!existsSync(SCHEMA_PATH)) {
									sendJson(response, 500, { ok: false, error: "插件缺少 py/schema.sql" });
									return;
								}
								const result = await serialize(() =>
									runBridge({ cmd: "create", dbPath: target, schemaPath: SCHEMA_PATH }),
								);
								sendJson(response, 200, result);
								return;
							}
							if (url.pathname === `${PREFIX}/api/config/probe` && request.method === "GET") {
								const target = url.searchParams.get("path") ?? "";
								sendJson(response, 200, { ok: true, ...(await serialize(() => probeDb(target))) });
								return;
							}
							if (url.pathname === `${PREFIX}/api/stats` && request.method === "GET") {
								const db = pickDb(url.searchParams.get("db"));
								const current = await loadConfig(home);
								const dbPath = pathFor(current, db);
								if (!existsSync(dbPath)) {
									sendJson(response, 200, emptyStats(db));
									return;
								}
								const stats = await serialize(() => runBridge({ cmd: "stats", db, dbPath }));
								if (stats?.ok !== true && stats?.missing === true) {
									sendJson(response, 200, emptyStats(db));
									return;
								}
								sendJson(response, 200, stats);
								return;
							}
							if (url.pathname === `${PREFIX}/api/projects` && request.method === "GET") {
								const db = pickDb(url.searchParams.get("db"));
								const current = await loadConfig(home);
								const dbPath = pathFor(current, db);
								if (!existsSync(dbPath)) {
									sendJson(response, 200, { ok: true, db, projects: [], uninitialized: true });
									return;
								}
								const stats = await serialize(() => runBridge({ cmd: "stats", db, dbPath }));
								if (stats?.ok !== true) {
									sendJson(response, 200, stats);
									return;
								}
								sendJson(response, 200, { ok: true, db, projects: stats.projects ?? [] });
								return;
							}
							if (url.pathname === `${PREFIX}/api/preview`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const cwd = typeof body?.cwd === "string" ? body.cwd.trim() : "";
								const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
								if (cwd.length === 0) {
									sendJson(response, 400, { ok: false, error: "cwd 不能为空" });
									return;
								}
								const value = await serialize(() => section.preview(cwd, sessionId));
								sendJson(response, 200, { ok: true, text: value });
								return;
							}
							if (url.pathname === `${PREFIX}/api/search`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const db = pickDb(body?.db);
								const query = typeof body?.query === "string" ? body.query.trim() : "";
								const project = typeof body?.project === "string" ? body.project.trim() : "";
								const topK = Number.isFinite(body?.topK) ? Math.max(1, Math.min(Number(body.topK), 20)) : 5;
								if (query.length === 0) {
									sendJson(response, 400, { ok: false, error: "搜索内容不能为空" });
									return;
								}
								const current = await loadConfig(home);
								const dbPath = pathFor(current, db);
								if (!existsSync(dbPath)) {
									sendJson(response, 200, { ok: true, results: [], uninitialized: true, path: dbPath });
									return;
								}
								const result = await serialize(() => runBridge({ cmd: "search", db, dbPath, project, query, topK }));
								if (result?.ok !== true && result?.missing === true) {
									sendJson(response, 200, { ok: true, results: [], uninitialized: true, path: dbPath });
									return;
								}
								sendJson(response, 200, result);
								return;
							}
							if (url.pathname === `${PREFIX}/api/feedback`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const db = pickDb(body?.db);
								const id = typeof body?.id === "string" ? body.id.trim() : "";
								const action = typeof body?.action === "string" ? body.action.trim() : "";
								if (id.length === 0 || !["accepted", "ignored", "corrected", "deleted"].includes(action)) {
									sendJson(response, 400, { ok: false, error: "反馈参数无效" });
									return;
								}
								const current = await loadConfig(home);
								const dbPath = pathFor(current, db);
								if (!existsSync(dbPath)) {
									sendJson(response, 200, { ok: false, error: "记忆库尚未初始化" });
									return;
								}
								sendJson(response, 200, await serialize(() => runBridge({ cmd: "feedback", db, dbPath, id, action })));
								return;
							}
							if (url.pathname === `${PREFIX}/api/models` && request.method === "GET") {
								sendJson(response, 200, await listAvailableModels(child));
								return;
							}
							if (url.pathname === `${PREFIX}/api/extract/source` && request.method === "GET") {
								const sessionId = url.searchParams.get("sessionId") ?? "";
								const turnsParam = Number(url.searchParams.get("turns"));
								const transcript = await readSessionTranscript(home, sessionId, turnsParam);
								if (transcript.ok !== true) {
									sendJson(response, 200, transcript);
									return;
								}
								sendJson(response, 200, {
									ok: true,
									sessionId,
									title: transcript.title ?? null,
									cwd: transcript.cwd ?? null,
									turns: transcript.turns.length,
									text: transcript.text,
									preview: transcript.text.slice(0, 600),
								});
								return;
							}
							if (url.pathname === `${PREFIX}/api/extract`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const mode = body?.mode === "model" ? "model" : "rules";
								const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
								const inline = typeof body?.text === "string" ? body.text.trim() : "";
								const maxItems = Number.isFinite(body?.maxItems) ? Number(body.maxItems) : 12;
								let text = inline;
								let title;
								if (text.length === 0) {
									if (sessionId.length === 0) {
										sendJson(response, 400, { ok: false, error: "缺少 sessionId 或 text" });
										return;
									}
									const turnsParam = Number.isFinite(body?.turns) ? Number(body.turns) : EXTRACT_DEFAULT_TURNS;
									const transcript = await readSessionTranscript(home, sessionId, turnsParam);
									if (transcript.ok !== true) {
										sendJson(response, 200, transcript);
										return;
									}
									text = transcript.text;
									title = transcript.title;
								}
								if (text.trim().length < 10) {
									sendJson(response, 400, { ok: false, error: "会话文本太短，无法提取" });
									return;
								}
								if (mode === "model") {
									const current = await loadConfig(home);
									const provider =
										typeof body?.model?.provider === "string" && body.model.provider.trim().length > 0
											? body.model.provider.trim()
											: current.extractDefaults.provider;
									const modelId =
										typeof body?.model?.model === "string" && body.model.model.trim().length > 0
											? body.model.model.trim()
											: current.extractDefaults.model;
									const result = await extractCandidatesByModel(
										child,
										text,
										{ provider, model: modelId },
										maxItems,
									);
									sendJson(
										response,
										200,
										result.ok === true
											? { ok: true, mode, candidates: result.candidates, sessionId, title: title ?? null }
											: { ok: false, mode, error: result.error, sessionId, title: title ?? null },
									);
									return;
								}
								sendJson(response, 200, {
									ok: true,
									mode: "rules",
									candidates: extractCandidatesByRules(text, maxItems),
									sessionId,
									title: title ?? null,
								});
								return;
							}
							if (url.pathname === `${PREFIX}/api/remember`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const db = pickDb(body?.db);
								const items = Array.isArray(body?.items) ? body.items : [];
								if (items.length === 0) {
									sendJson(response, 400, { ok: false, error: "没有要保存的记忆" });
									return;
								}
								if (items.length > 50) {
									sendJson(response, 400, { ok: false, error: "一次最多保存 50 条" });
									return;
								}
								const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
								let project = typeof body?.project === "string" ? body.project.trim() : "";
								const current = await loadConfig(home);
								const dbPath = pathFor(current, db);
								if (!existsSync(dbPath)) {
									sendJson(response, 200, { ok: false, error: "记忆库尚未初始化，请先在「长期记忆」里创建空库" });
									return;
								}
								if (project.length === 0 && sessionId.length > 0) {
									try {
										const log = await readSessionLog(home, sessionId);
										if (log.ok === true && typeof log.cwd === "string" && log.cwd.length > 0) {
											project = await workspaceTitle(home, log.cwd);
										}
										if (project.length === 0 && typeof log.title === "string" && log.title.length > 0) {
											project = log.title;
										}
									} catch {
										/* keep fallback project */
									}
								}
								if (project.length === 0) project = "conversations";
								const result = await serialize(() =>
									runBridge({ cmd: "remember", db, dbPath, project, sessionId, items }),
								);
								sendJson(response, 200, result);
								return;
							}
							sendJson(response, 404, { ok: false, error: "not found" });
						} catch (error) {
							sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
						}
					},
				});
				return [disposeRoutes, disposeContext];
			},
			"nexus-memory: routes and prompt context",
		);
	});
}

