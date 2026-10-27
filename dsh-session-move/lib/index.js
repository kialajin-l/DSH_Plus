/**
 * dsh-session-move — host half.
 *
 * Moves a cold historical session from one registered workspace to another by
 * rewriting the session header's `cwd`, relocating the log under the target
 * project key, and switching workspace membership through the live
 * `workspaceRegistry` service. Every mutation is backed up first and rolled
 * back on failure; a session that cannot be moved is refused rather than
 * half-moved.
 */
import { createReadStream } from "node:fs";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";

export const name = "dsh-session-move";

const PREFIX = "/session-move";
const MAX_BODY = 1_000_000;
const ZSTD_MAGIC = 0xfd2fb528;
const BACKUP_DIR = "session-move-backups";

/* ------------------------------------------------------------------ */
/* home + paths                                                        */
/* ------------------------------------------------------------------ */

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(homedir(), ".dsh");
}

/** Mirror of dsh-session-persistence-jsonl's project key derivation. */
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

/** Mirror of dsh-session-persistence-jsonl's directory segment encoder. */
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
/* zstd multi-frame codec                                              */
/* ------------------------------------------------------------------ */

/** Index every complete zstd frame in one buffer (magic-validated). */
export function frameRanges(buf) {
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

function decompressFrame(buf) {
	return zlib.zstdDecompressSync(buf);
}

/** Decode a whole session log file into UTF-8 text. */
export function decodeLog(buf, zstd) {
	if (!zstd) return buf.toString("utf8");
	const parts = [];
	for (const frame of frameRanges(buf)) parts.push(decompressFrame(buf.subarray(frame.start, frame.end)));
	return Buffer.concat(parts).toString("utf8");
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

/* ------------------------------------------------------------------ */
/* session directory discovery                                         */
/* ------------------------------------------------------------------ */

async function listProjectDirs(home) {
	const root = path.join(home, "sessions");
	let entries;
	try {
		entries = await fsp.readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries.filter((e) => e.isDirectory()).map((e) => path.join(root, e.name));
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

/** Locate the directory holding one session id; scans every project folder. */
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

/** Highest version wins; within one version the compressed form is preferred. */
function pickPrimaryLog(files) {
	let best;
	for (const entry of files) {
		if (best === undefined || entry.version > best.version || (entry.version === best.version && entry.zstd && !best.zstd)) best = entry;
	}
	return best;
}

/* ------------------------------------------------------------------ */
/* header reads                                                        */
/* ------------------------------------------------------------------ */

function parseHeaderLine(text) {
	const end = text.indexOf("\n");
	const line = end === -1 ? text : text.slice(0, end);
	try {
		return JSON.parse(line);
	} catch {
		return undefined;
	}
}

/** Read the session header without decoding a multi-megabyte log. */
async function readHeader(file, zstd) {
	if (!zstd) {
		const fd = await fsp.open(file, "r");
		try {
			const buf = Buffer.alloc(Math.min(256 * 1024, (await fd.stat()).size));
			await fd.read(buf, 0, buf.length, 0);
			return parseHeaderLine(buf.toString("utf8"));
		} finally {
			await fd.close();
		}
	}
	const size = (await fsp.stat(file)).size;
	for (const chunk of [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024]) {
		const length = Math.min(chunk, size);
		const handle = await fsp.open(file, "r");
		let buf;
		try {
			buf = Buffer.alloc(length);
			await handle.read(buf, 0, length, 0);
		} finally {
			await handle.close();
		}
		try {
			const ranges = frameRanges(buf);
			if (ranges.length === 0) continue;
			let text = "";
			for (const range of ranges) {
				text += decompressFrame(buf.subarray(range.start, range.end)).toString("utf8");
				if (text.includes("\n")) return parseHeaderLine(text);
			}
			if (length === size) return parseHeaderLine(text);
		} catch {
			/* truncated: grow the window */
		}
	}
	// Huge first frame: pay for one full decode.
	return parseHeaderLine(decodeLog(await fsp.readFile(file), true));
}

async function readHeaderFor(entry) {
	return readHeader(entry.full, entry.zstd);
}

/* ------------------------------------------------------------------ */
/* projection-cache titles                                             */
/* ------------------------------------------------------------------ */

async function readTitle(home, id) {
	const file = path.join(home, "storages", "session_projcache", "sessions", `${id}.json`);
	try {
		const raw = await fsp.readFile(file, "utf8");
		const parsed = JSON.parse(raw);
		const title = parsed?.record?.rows?.title?.val;
		if (typeof title === "string" && title.trim().length > 0) return title.trim();
	} catch {
		/* no cache */
	}
	return undefined;
}

/* ------------------------------------------------------------------ */
/* workspace registry helpers                                          */
/* ------------------------------------------------------------------ */

function registryOf(ctx) {
	try {
		return ctx.get("workspaceRegistry");
	} catch {
		return undefined;
	}
}

async function safeStatDir(target) {
	try {
		const stat = await fsp.stat(target);
		return stat.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Publish one session's canonical header into the registry's startup-built
 * index. The registry indexes headers once at boot, so a moved artifact would
 * otherwise be validated against its old cwd; the injected entry carries the
 * rewritten header and the target canon.
 */
function injectCachedHeader(registry, header, canonicalPath) {
	if (!(registry?.headers instanceof Map)) return false;
	registry.headers.set(header.id, header);
	if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(header.id, canonicalPath);
	registry.missingSessionPaths?.delete?.(header.id);
	registry.invalidSessionPaths?.delete?.(header.id);
	return true;
}

/** Reload the registry's canonical-cwd header index from persistence (fallback path). */
async function refreshHeaderIndex(registry) {
	if (typeof registry?.listStoredHeaders !== "function" || typeof registry?.indexHeaders !== "function") {
		throw new Error("workspaceRegistry 不支持安全刷新（缺少 listStoredHeaders/indexHeaders）");
	}
	const headers = await registry.listStoredHeaders();
	await registry.indexHeaders(headers);
}

function supportsMove(registry) {
	if (registry === undefined || typeof registry.get !== "function" || typeof registry.list !== "function") return false;
	if (registry.headers instanceof Map) return true;
	return typeof registry.listStoredHeaders === "function" && typeof registry.indexHeaders === "function";
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
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/* ------------------------------------------------------------------ */
/* state                                                               */
/* ------------------------------------------------------------------ */

async function readWorkspaceFile(home) {
	try {
		const raw = await fsp.readFile(path.join(home, "storages", "workspace.json"), "utf8");
		return JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function isLive(ctx, id) {
	const agents = ctx.get("agents");
	let roster = [];
	try {
		roster = agents?.list?.() ?? [];
	} catch {
		roster = [];
	}
	if (roster.some((agent) => agent?.id === id || agent?.sessionId === id)) return true;
	try {
		return ctx.get("sessions")?.get?.(id) !== undefined;
	} catch {
		return false;
	}
}

async function buildState(ctx) {
	const home = homeDir();
	const registry = registryOf(ctx);
	const snapshot = await readWorkspaceFile(home);
	const defaultWorkspaceId = snapshot?.global?.defaultWorkspaceId;

	let workspaces;
	if (supportsMove(registry)) {
		workspaces = registry.list().map((workspace) => ({
			id: workspace.id,
			title: workspace.title,
			path: workspace.path,
			sessionIds: [...workspace.sessionIds],
		}));
	} else {
		const tables = snapshot?.tables?.workspaces ?? {};
		workspaces = (snapshot?.global?.workspaceIds ?? []).map((id) => ({
			id,
			title: tables[id]?.title ?? id,
			path: tables[id]?.path ?? "",
			sessionIds: [...(tables[id]?.sessionIds ?? [])],
		}));
	}

	const projectDirs = await listProjectDirs(home);
	const result = [];
	for (const workspace of workspaces) {
		const sessions = [];
		for (const id of workspace.sessionIds) {
			const dir = await findSessionDir(projectDirs, id);
			const files = dir === undefined ? [] : await listLogFiles(dir);
			const primary = pickPrimaryLog(files);
			let header;
			if (primary !== undefined) {
				try {
					header = await readHeaderFor(primary);
				} catch {
					header = undefined;
				}
			}
			const title = await readTitle(home, id);
			sessions.push({
				id,
				title: title ?? id.replace(/^session-/, "").slice(0, 8),
				bytes: primary?.size ?? 0,
				live: isLive(ctx, id),
				subagent: header?.origin === "subagent" || header?.parentSession !== undefined,
			});
		}
		result.push({ id: workspace.id, title: workspace.title, path: workspace.path, count: sessions.length, sessions });
	}
	return { workspaces: result, defaultWorkspaceId };
}

/* ------------------------------------------------------------------ */
/* move                                                                */
/* ------------------------------------------------------------------ */

function stamp() {
	const now = new Date();
	const pad = (value) => String(value).padStart(2, "0");
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function copyDir(source, target) {
	await fsp.rm(target, { recursive: true, force: true });
	await fsp.mkdir(path.dirname(target), { recursive: true });
	await fsp.cp(source, target, { recursive: true });
}

async function writeFileDurable(file, data) {
	const handle = await fsp.open(file, "w");
	try {
		await handle.writeFile(data);
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

/** Rewrite only the header line; every following byte stays identical. */
export function rewriteHeaderCwd(text, cwd) {
	const end = text.indexOf("\n");
	if (end === -1) throw new Error("会话日志没有换行分隔的 header");
	const line = text.slice(0, end);
	const rest = text.slice(end);
	const header = JSON.parse(line);
	if (header === null || typeof header !== "object" || header.type !== "session") {
		throw new Error("会话日志第一行不是 session header");
	}
	header.cwd = cwd;
	return `${JSON.stringify(header)}${rest}`;
}

function lineCount(text) {
	let count = 0;
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count += 1;
	if (text.length > 0 && text.charCodeAt(text.length - 1) !== 10) count += 1;
	return count;
}

/**
 * Validate one move and compute its plan without touching anything.
 * @returns `{ ok:true, ...plan }` or `{ sessionId, ok:false, reason }`.
 */
async function inspectMove(ctx, registry, home, sessionId, targetWorkspaceId) {
	const target = registry.get(targetWorkspaceId);
	if (target === undefined) return { sessionId, ok: false, reason: "目标工作区不存在" };

	const source = registry.list().find((workspace) => workspace.sessionIds.includes(sessionId));
	if (source === undefined) return { sessionId, ok: false, reason: "会话不属于任何工作区" };
	if (source.id === targetWorkspaceId) return { sessionId, ok: false, reason: "会话已在该工作区" };

	const targetPath = path.resolve(target.path);
	if (!(await safeStatDir(targetPath))) return { sessionId, ok: false, reason: `目标目录不存在：${targetPath}` };
	if (isLive(ctx, sessionId)) return { sessionId, ok: false, reason: "会话正在运行或已打开，请先切换离开" };

	const projectDirs = await listProjectDirs(home);
	const sourceDir = await findSessionDir(projectDirs, sessionId);
	if (sourceDir === undefined) return { sessionId, ok: false, reason: "找不到会话日志目录" };
	const primary = pickPrimaryLog(await listLogFiles(sourceDir));
	if (primary === undefined) return { sessionId, ok: false, reason: "会话目录中没有日志文件" };

	let header;
	try {
		header = await readHeaderFor(primary);
	} catch (error) {
		return { sessionId, ok: false, reason: `读取会话 header 失败：${String(error?.message ?? error)}` };
	}
	if (header === undefined) return { sessionId, ok: false, reason: "会话 header 无法解析" };
	if (header.origin === "subagent" || header.parentSession !== undefined) {
		return { sessionId, ok: false, reason: "子会话不能单独移动" };
	}

	// Attach validates against the canonical target path.
	let realTarget;
	try {
		realTarget = await fsp.realpath(targetPath);
	} catch (error) {
		return { sessionId, ok: false, reason: `目标目录无法解析：${String(error?.message ?? error)}` };
	}
	const targetDir = path.join(home, "sessions", projectKey(realTarget), encodeSegment(sessionId));
	if (fs.existsSync(targetDir)) return { sessionId, ok: false, reason: "目标项目目录里已存在同名会话目录" };

	return { ok: true, sessionId, source, target, sourceDir, primary, header, realTarget, targetDir };
}

/** Dry-run: report the plan without writing. */
async function planOne(ctx, registry, home, sessionId, targetWorkspaceId) {
	const plan = await inspectMove(ctx, registry, home, sessionId, targetWorkspaceId);
	if (!plan.ok) return plan;
	return {
		sessionId,
		ok: true,
		from: plan.source.path,
		to: plan.target.path,
		targetDir: plan.targetDir,
		bytes: plan.primary.size,
		cwd: plan.header.cwd,
	};
}

async function moveOne(ctx, registry, home, sessionId, targetWorkspaceId, backupRoot) {
	const plan = await inspectMove(ctx, registry, home, sessionId, targetWorkspaceId);
	if (!plan.ok) return plan;
	const { source, target, sourceDir, primary, header, realTarget, targetDir } = plan;

	// 1. Back up the whole session directory plus workspace.json.
	const backupDir = path.join(backupRoot, sessionId);
	await copyDir(sourceDir, backupDir);
	try {
		await fsp.copyFile(path.join(home, "storages", "workspace.json"), path.join(backupRoot, "workspace.json"));
	} catch {
		/* diagnostic copy only */
	}

	const originalText = decodeLog(await fsp.readFile(primary.full), primary.zstd);
	const originalLines = lineCount(originalText);

	let detached = false;
	let wroteTarget = false;
	let removedSource = false;
	try {
		// 2. Drop ownership first: the log is still intact, so rollback is cheap.
		await source.detachSession(sessionId);
		detached = true;

		// 3. Rewrite the header cwd and publish the log under the target project.
		const rewritten = rewriteHeaderCwd(originalText, realTarget);
		await fsp.mkdir(targetDir, { recursive: true });
		const tempFile = path.join(targetDir, `${primary.file}.tmp-${process.pid}-${Date.now()}`);
		const payload = primary.zstd ? zstdOneFrame(rewritten) : Buffer.from(rewritten, "utf8");
		await writeFileDurable(tempFile, payload);
		const finalFile = path.join(targetDir, primary.file);
		await fsp.rename(tempFile, finalFile);
		await fsyncDir(targetDir);
		wroteTarget = true;

		// 4. Verify before destroying anything at the source.
		const verifyText = decodeLog(await fsp.readFile(finalFile), primary.zstd);
		const verifyHeader = parseHeaderLine(verifyText);
		if (verifyHeader?.cwd !== realTarget) throw new Error("回读校验失败：header.cwd 不匹配");
		if (lineCount(verifyText) !== originalLines) throw new Error("回读校验失败：行数不一致");
		if (verifyText.slice(verifyText.indexOf("\n")) !== originalText.slice(originalText.indexOf("\n"))) {
			throw new Error("回读校验失败：正文内容不一致");
		}

		// 5. Remove the source copy, then attach with the rewritten header. The
		//    registry keeps a boot-time header index, so publish the new header
		//    into it; without this an attach would validate against the old cwd.
		await fsp.rm(sourceDir, { recursive: true, force: true });
		removedSource = true;
		const movedHeader = { ...header, cwd: realTarget };
		if (!injectCachedHeader(registry, movedHeader, realTarget)) await refreshHeaderIndex(registry);
		await target.attachSession(sessionId);
	} catch (error) {
		const reason = String(error?.message ?? error);
		try {
			if (removedSource || !fs.existsSync(sourceDir)) await copyDir(backupDir, sourceDir);
			if (wroteTarget) await fsp.rm(targetDir, { recursive: true, force: true });
			if (!injectCachedHeader(registry, header, source.path)) await refreshHeaderIndex(registry);
			if (detached) await source.attachSession(sessionId);
		} catch (rollbackError) {
			return {
				sessionId,
				ok: false,
				reason: `${reason}；回滚也失败：${String(rollbackError?.message ?? rollbackError)}（备份在 ${backupDir}）`,
			};
		}
		return { sessionId, ok: false, reason: `${reason}（已回滚）` };
	}

	// 6. Drop a stale projection cache so the moved session re-projects.
	try {
		await fsp.rm(path.join(home, "storages", "session_projcache", "sessions", `${sessionId}.json`), { force: true });
	} catch {
		/* cache is disposable */
	}

	return { sessionId, ok: true, from: source.path, to: target.path, backup: backupDir };
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
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
			() =>
				child.webServer.register({
					kind: "prefix",
					path: PREFIX,
					handler: async (request, response) => {
						const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
						try {
														if (url.pathname === `${PREFIX}/api/plan`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const sessionIds = Array.isArray(body?.sessionIds) ? body.sessionIds.filter((id) => typeof id === "string") : [];
								const targetWorkspaceId = typeof body?.targetWorkspaceId === "string" ? body.targetWorkspaceId : "";
								if (sessionIds.length === 0 || targetWorkspaceId.length === 0) {
									sendJson(response, 400, { error: "需要 sessionIds 与 targetWorkspaceId" });
									return;
								}
								const registry = registryOf(child);
								if (!supportsMove(registry)) {
									sendJson(response, 503, { error: "workspaceRegistry 不可用" });
									return;
								}
								const result = await serialize(async () => {
									const home = homeDir();
									const plans = [];
									for (const sessionId of [...new Set(sessionIds)]) plans.push(await planOne(child, registry, home, sessionId, targetWorkspaceId));
									return { plans };
								});
								sendJson(response, 200, result);
								return;
							}if (url.pathname === `${PREFIX}/api/state` && request.method === "GET") {
								sendJson(response, 200, await buildState(child));
								return;
							}
							if (url.pathname === `${PREFIX}/api/move`) {
								if (request.method !== "POST" || !sameOrigin(request)) {
									sendJson(response, 403, { error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readJson(request);
								const sessionIds = Array.isArray(body?.sessionIds) ? body.sessionIds.filter((id) => typeof id === "string") : [];
								const targetWorkspaceId = typeof body?.targetWorkspaceId === "string" ? body.targetWorkspaceId : "";
								if (sessionIds.length === 0) {
									sendJson(response, 400, { error: "没有选择会话" });
									return;
								}
								if (targetWorkspaceId.length === 0) {
									sendJson(response, 400, { error: "没有选择目标工作区" });
									return;
								}
								const registry = registryOf(child);
								if (!supportsMove(registry)) {
									sendJson(response, 503, { error: "workspaceRegistry 不可用，已拒绝移动（避免手改 workspace.json 造成不同步）" });
									return;
								}
								const result = await serialize(async () => {
									const home = homeDir();
									const backupRoot = path.join(home, BACKUP_DIR, stamp());
									const results = [];
									const moved = [];
									for (const sessionId of [...new Set(sessionIds)]) {
										try {
											const outcome = await moveOne(child, registry, home, sessionId, targetWorkspaceId, backupRoot);
											results.push(outcome);
											if (outcome.ok) moved.push(sessionId);
										} catch (error) {
											results.push({ sessionId, ok: false, reason: String(error?.message ?? error) });
										}
									}
									return { results, moved };
								});
								sendJson(response, 200, result);
								return;
							}
							sendJson(response, 404, { error: "not found" });
						} catch (error) {
							sendJson(response, 500, { error: String(error?.message ?? error) });
						}
					},
				}),
			"session-move: routes",
		);
	});
}

