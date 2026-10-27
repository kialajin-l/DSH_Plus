/// dsh-agent-checkup host half: Evidence-lite probes over local session logs.
/// Read-only over `<home>/sessions/**`; reports go to `<home>/storages/agent-checkup/`.
/// Design: AHM 商品化 1.1「证据轻量体检」— candidate results only, never a health
/// certificate; completed/requested probe counts and skipped sessions are surfaced.
import { existsSync, writeFileSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import zlib from "node:zlib";
import path from "node:path";
import { homedir, tmpdir } from "node:os";

const PREFIX = "/agent-checkup";
const ZSTD_MAGIC = 0xfd2fb528;
const WINDOW_DAYS_DEFAULT = 30;
const MAX_SESSIONS_DEFAULT = 50;
const MAX_WORK_MS = 20000;
const PROBE_IDS = ["P1", "P2", "P3", "P4"];
const DISCLAIMER = "candidate 结果：仅覆盖本地有限探针，不构成健康认证或生产就绪结论。";

const PROBE_LABELS = {
	P1: (value) => `助手输出重复率 ${pct(value)}（Jaccard ≥0.9）`,
	P2: (value) => `工具错误后无跟进比例 ${pct(value)}`,
	P3: (value) => `工具调用失败率 ${pct(value)}`,
	P4: (value) => `上下文膨胀 ${value.toFixed(1)}×（尾部/头部均值）`,
};

function pct(value) {
	return `${(value * 100).toFixed(1)}%`;
}

/* ------------------------------------------------------------------ */
/* paths                                                               */
/* ------------------------------------------------------------------ */

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(homedir(), ".dsh");
}

function storageDir() {
	return path.join(homeDir(), "storages", "agent-checkup");
}

function reportFile() {
	return path.join(storageDir(), "last-report.json");
}

function downloadsDir() {
	const candidate = path.join(homedir(), "Downloads");
	return existsSync(candidate) ? candidate : tmpdir();
}

/* ------------------------------------------------------------------ */
/* zstd multi-frame decoding (same layout as dsh-usage-panel)          */
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
			if (buf.length - p < 3) throw new RangeError("truncated zstd block header");
			const h = buf.readUIntLE(p, 3);
			p += 3;
			const last = h & 1;
			const type = (h >> 1) & 3;
			const size = h >> 3;
			p += type === 1 ? 1 : size;
			if (last) break;
		}
		if (checksum) p += 4;
		if (p > buf.length) throw new RangeError("truncated zstd frame");
		out.push({ start, end: p });
	}
	return out;
}

function decodeLog(buf, compressed) {
	if (!compressed) return buf.toString("utf8");
	const parts = [];
	for (const frame of frameRanges(buf)) {
		parts.push(zlib.zstdDecompressSync(buf.subarray(frame.start, frame.end)));
	}
	return Buffer.concat(parts).toString("utf8");
}

/* ------------------------------------------------------------------ */
/* session file discovery (mirrors dsh-usage-panel)                    */
/* ------------------------------------------------------------------ */

function pickLogFile(entries) {
	let best;
	let bestVersion = -1;
	for (const entry of entries) {
		const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(entry);
		if (match === null) continue;
		const version = match[1] === undefined ? 0 : Number(match[1]);
		if (version > bestVersion) {
			best = entry;
			bestVersion = version;
		}
	}
	return best;
}

async function listSessionFiles(home) {
	const root = path.join(home, "sessions");
	const files = [];
	let projectDirs;
	try {
		projectDirs = await readdir(root, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const projectDir of projectDirs) {
		if (!projectDir.isDirectory()) continue;
		const projectPath = path.join(root, projectDir.name);
		let sessionDirs;
		try {
			sessionDirs = await readdir(projectPath, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const sessionDir of sessionDirs) {
			if (!sessionDir.isDirectory()) continue;
			const dirPath = path.join(projectPath, sessionDir.name);
			let entries;
			try {
				entries = await readdir(dirPath);
			} catch {
				continue;
			}
			const file = pickLogFile(entries);
			if (file !== undefined) files.push(path.join(dirPath, file));
		}
	}
	return files;
}

/* ------------------------------------------------------------------ */
/* per-session transcript extraction                                   */
/* ------------------------------------------------------------------ */

function messageText(content) {
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part && part.type === "text" && typeof part.text === "string" ? part.text : ""))
		.join("\n")
		.trim();
}

async function readSession(file) {
	const buf = await readFile(file);
	const compressed = file.endsWith(".zstd");
	const text = decodeLog(buf, compressed);
	const out = {
		id: path.basename(path.dirname(file)),
		cwd: undefined,
		title: undefined,
		createdAt: 0,
		lastTime: 0,
		assistants: [],
		toolEvents: [],
	};
	for (const line of text.split("\n")) {
		if (line.length === 0) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		const type = event.type;
		if (type === "session") {
			if (typeof event.id === "string") out.id = event.id;
			out.cwd = event.cwd;
			out.createdAt = typeof event.createdAt === "number" ? event.createdAt : 0;
			continue;
		}
		if (type === "session/title" && typeof event.data?.title === "string") {
			out.title = event.data.title;
			continue;
		}
		const time = typeof event.time === "number" ? event.time : 0;
		if (time > out.lastTime) out.lastTime = time;
		// Inherited (seeded/copied) history was produced where it happened;
		// probes only look at this session's own work.
		if (out.createdAt !== 0 && time !== 0 && time < out.createdAt) continue;
		if (type === "assistant/message") {
			const usage = event.data?.usage;
			out.assistants.push({
				time,
				text: messageText(event.data?.message?.content).slice(0, 4000),
				totalTokens:
					(usage?.inputTokens ?? 0) +
					(usage?.outputTokens ?? 0) +
					(usage?.cacheReadTokens ?? 0) +
					(usage?.cacheWriteTokens ?? 0),
			});
			continue;
		}
		if (type === "tool/result") {
			const data = event.data ?? {};
			out.toolEvents.push({ time, failed: data.error !== undefined || data.isError === true });
		}
	}
	return out;
}

/* ------------------------------------------------------------------ */
/* probes                                                              */
/* ------------------------------------------------------------------ */

function bigrams(text) {
	const set = new Set();
	const source = text.replace(/\s+/gu, "");
	for (let index = 0; index + 2 <= source.length; index += 1) set.add(source.slice(index, index + 2));
	return set;
}

function jaccard(left, right) {
	if (left.size === 0 || right.size === 0) return 0;
	let shared = 0;
	for (const item of left) if (right.has(item)) shared += 1;
	return shared / (left.size + right.size - shared);
}

/** P1 duplicate assistant-output ratio (pairwise bigram Jaccard >= 0.9). */
function probeDuplicate(session) {
	const texts = session.assistants.map((entry) => entry.text).filter((text) => text.length >= 40);
	if (texts.length < 2) return { value: null, status: "n/a" };
	// Uniform sampling keeps long sessions bounded: C(120,2) ≈ 7k pairs.
	const stride = Math.max(1, Math.ceil(texts.length / 120));
	const sampled = texts.filter((_, index) => index % stride === 0).slice(0, 120);
	const gramSets = sampled.map((text) => bigrams(text.slice(0, 2000)));
	let pairs = 0;
	let duplicates = 0;
	for (let i = 0; i < gramSets.length; i += 1) {
		for (let j = i + 1; j < gramSets.length; j += 1) {
			pairs += 1;
			const a = gramSets[i];
			const b = gramSets[j];
			if (a.size === 0 || b.size === 0) continue;
			if (Math.abs(a.size - b.size) / Math.max(a.size, b.size) > 0.5) continue;
			if (jaccard(a, b) >= 0.9) duplicates += 1;
		}
	}
	const ratio = pairs > 0 ? duplicates / pairs : 0;
	return { value: ratio, status: ratio > 0.05 ? "warn" : "ok" };
}

/**
 * P2 error visibility: share of tool errors with no assistant message within
 * the next 3 timeline events (an unacknowledged failure the agent ignored).
 */
function probeErrorVisibility(session) {
	const failed = session.toolEvents.filter((event) => event.failed);
	if (failed.length === 0) return { value: null, status: "n/a" };
	const timeline = [
		...session.toolEvents.map((event) => ({ time: event.time, assistant: false })),
		...session.assistants.map((entry) => ({ time: entry.time, assistant: true })),
	]
		.filter((entry) => entry.time > 0)
		.sort((left, right) => left.time - right.time);
	let invisible = 0;
	for (const error of failed) {
		const position = timeline.findIndex((entry) => entry.time === error.time && !entry.assistant);
		if (position === -1) continue;
		const window = timeline.slice(position + 1, position + 4);
		if (!window.some((entry) => entry.assistant)) invisible += 1;
	}
	const ratio = invisible / failed.length;
	return { value: ratio, status: ratio > 0.3 ? "warn" : "ok" };
}

/** P3 tool failure rate. */
function probeToolHealth(session) {
	const total = session.toolEvents.length;
	if (total === 0) return { value: null, status: "n/a" };
	const failed = session.toolEvents.filter((event) => event.failed).length;
	const rate = failed / total;
	return { value: rate, status: rate > 0.2 ? "warn" : "ok" };
}

/** P4 context growth: tail vs head mean of assistant totalTokens. */
function probeContextGrowth(session) {
	const series = session.assistants.map((entry) => entry.totalTokens).filter((value) => value > 0);
	if (series.length < 10) return { value: null, status: "n/a" };
	const slice = Math.max(1, Math.floor(series.length * 0.2));
	const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
	const head = mean(series.slice(0, slice));
	const tail = mean(series.slice(-slice));
	if (head <= 0) return { value: null, status: "n/a" };
	const growth = tail / head;
	return { value: growth, status: growth > 4 ? "warn" : "ok" };
}

/* ------------------------------------------------------------------ */
/* checkup run                                                         */
/* ------------------------------------------------------------------ */

async function runCheckup(options = {}) {
	const windowDays = Math.max(1, Math.min(Number(options.days) || WINDOW_DAYS_DEFAULT, 365));
	const maxSessions = Math.max(1, Math.min(Number(options.maxSessions) || MAX_SESSIONS_DEFAULT, 200));
	const started = Date.now();
	const home = homeDir();
	const cutoff = started - windowDays * 24 * 60 * 60 * 1000;
	const files = await listSessionFiles(home);

	// mtime is a cheap prefilter before any zstd decode.
	const recent = [];
	for (const file of files) {
		try {
			if (statSync(file).mtimeMs >= cutoff) recent.push(file);
		} catch {
			continue;
		}
	}
	recent.sort((left, right) => {
		try {
			return statSync(right).mtimeMs - statSync(left).mtimeMs;
		} catch {
			return 0;
		}
	});

	const sessions = [];
	const findings = [];
	let scanned = 0;
	let skipped = 0;
	for (const file of recent) {
		if (sessions.length >= maxSessions) break;
		if (Date.now() - started > MAX_WORK_MS) break;
		try {
			const session = await readSession(file);
			if (session.assistants.length === 0 && session.toolEvents.length === 0) continue;
			if (session.lastTime !== 0 && session.lastTime < cutoff) continue;
			scanned += 1;
			const probes = {
				P1: probeDuplicate(session),
				P2: probeErrorVisibility(session),
				P3: probeToolHealth(session),
				P4: probeContextGrowth(session),
			};
			const warnCount = PROBE_IDS.filter((id) => probes[id].status === "warn").length;
			for (const id of PROBE_IDS) {
				if (probes[id].status === "warn") {
					findings.push({
						sessionId: session.id,
						title: session.title ?? session.id,
						probe: id,
						message: PROBE_LABELS[id](probes[id].value),
					});
				}
			}
			sessions.push({
				sessionId: session.id,
				title: session.title ?? session.id,
				cwd: session.cwd ?? "",
				probes,
				warnCount,
			});
		} catch {
			skipped += 1;
		}
	}
	sessions.sort((left, right) => right.warnCount - left.warnCount);
	const sessionsWarned = sessions.filter((session) => session.warnCount > 0).length;
	return {
		ok: true,
		generatedAt: Date.now(),
		windowDays,
		level: "candidate",
		sessionsScanned: scanned,
		sessionsWarned,
		sessionsSkipped: skipped,
		completedProbes: PROBE_IDS.length,
		requestedProbes: PROBE_IDS.length,
		findings,
		sessions,
		summary: buildSummary(sessions, scanned, sessionsWarned),
		disclaimer: DISCLAIMER,
	};
}

/**
 * Collapse per-session probe results into a short, problem-type-grouped list for
 * the settings pane: what is wrong, roughly why, and what to do about it.
 */
function buildSummary(sessions, scanned, sessionsWarned) {
	const warned = (id) => sessions.filter((session) => session.probes?.[id]?.status === "warn");
	const definitions = [
		{
			key: "P4",
			title: "上下文膨胀",
			suggestion: "任务收口后开新会话，或在导入/续写时用摘要模式控制上下文",
			detail: (count) => `${count} 个会话存在（多为子代理/长会话）`,
		},
		{
			key: "P1",
			title: "输出重复",
			suggestion: "检查提示词是否缺变化约束，或清理重复循环的会话",
			detail: (count) => `${count} 个会话助手输出重复`,
		},
		{
			key: "P2",
			title: "工具报错无跟进",
			suggestion: "让 agent 对失败工具给出解释与重试",
			detail: (count) => `${count} 个会话工具报错后无跟进`,
		},
		{
			key: "P3",
			title: "工具调用失败",
			suggestion: "检查 MCP/工具配置",
			detail: (count, list) => {
				const values = list.map((session) => session.probes?.P3?.value).filter((value) => Number.isFinite(value));
				const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
				return `平均失败率 ${pct(average)}（${count} 个会话超阈值）`;
			},
		},
	];
	const groups = [];
	for (const definition of definitions) {
		const list = warned(definition.key);
		if (list.length === 0) continue;
		groups.push({
			key: definition.key,
			severity: "warn",
			title: definition.title,
			detail: definition.detail(list.length, list),
			suggestion: definition.suggestion,
			count: list.length,
		});
	}
	if (groups.length === 0) {
		groups.push({ key: "ok", severity: "info", title: "未发现明显问题", detail: "所有探针均通过", suggestion: "" });
	}
	return {
		overview: `扫描 ${scanned} 个会话 · 发现 ${sessionsWarned} 处问题 · 探针 ${PROBE_IDS.length}/${PROBE_IDS.length}`,
		groups,
	};
}

/* ------------------------------------------------------------------ */
/* http                                                                */
/* ------------------------------------------------------------------ */

function sendJson(response, status, payload) {
	response.writeHead(status, {
		"cache-control": "no-store",
		"content-type": "application/json; charset=utf-8",
	});
	response.end(JSON.stringify(payload));
}

function trustedOrigin(request) {
	// Settings panes render inside a sandboxed iframe (Origin: "null") and the
	// GUI may use dsh-app: or a local http port. This server only listens on
	// localhost, so absent/opaque origins are accepted while real cross-site
	// origins are still rejected by host comparison.
	const origin = request.headers.origin;
	if (!origin || origin === "null") return true;
	try {
		const parsed = new URL(origin);
		return parsed.protocol === "dsh-app:" || parsed.host === request.headers.host;
	} catch {
		return true;
	}
}

async function readBody(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	const raw = Buffer.concat(chunks).toString("utf8");
	if (raw.length === 0) return {};
	try {
		return JSON.parse(raw);
	} catch {
		return {};
	}
}

/** Render a checkup report as one self-contained dark HTML page (no external deps). */
function renderReportHtml(report) {
	const esc = (value) =>
		String(value ?? "")
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;");
	const when = new Date(report.generatedAt ?? Date.now()).toLocaleString("zh-CN");
	const groups = Array.isArray(report.summary?.groups) ? report.summary.groups : [];
	const sessions = Array.isArray(report.sessions) ? report.sessions : [];
	const groupHtml = groups
		.map((group) => {
			const badge = group.severity === "warn" ? "注意" : "正常";
			return `<div class="group"><div class="group-head"><span class="badge ${group.severity === "warn" ? "warn" : "ok"}">${badge}</span><span class="gtitle">${esc(group.title)}</span></div><div class="gdetail">${esc(group.detail)}</div>${group.suggestion ? `<div class="gsugg">建议：${esc(group.suggestion)}</div>` : ""}</div>`;
		})
		.join("\n");
	const rows = sessions
		.map(
			(session) => `<tr><td class="ellipsis" title="${esc(session.title)}">${esc(session.title)}</td>${["P1", "P2", "P3", "P4"]
				.map((probe) => {
					const cell = session.probes?.[probe];
					const cls = cell?.status === "warn" ? "warn" : cell?.status === "ok" ? "ok" : "na";
					return `<td><span class="pill ${cls}">${probe} ${esc(cell?.status ?? "n/a")}${cell?.status === "n/a" ? "" : ` ${Number(cell?.value ?? 0).toFixed(1)}x`}</span></td>`;
				})
				.join("")}</tr>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>Agent 体检报告</title><style>
body{margin:0;background:#111418;color:#d7dde3;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 20px 48px}
h1{font-size:20px;margin:0 0 4px}.when{color:#7d8794;font-size:12px;margin-bottom:18px}
.overview{background:#1a1f26;border:1px solid #2a313a;border-radius:10px;padding:12px 16px;font-weight:600;margin-bottom:16px}
.group{background:#1a1f26;border:1px solid #2a313a;border-radius:10px;padding:12px 16px;margin-bottom:10px}
.group-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.badge,.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px}
.badge.warn,.pill.warn{background:#3d2f14;color:#e8b45a}.badge.ok,.pill.ok{background:#16301f;color:#5ec98a}.pill.na{background:#232a32;color:#7d8794}
.gtitle{font-weight:600}.gdetail{color:#aeb8c2;font-size:13px}.gsugg{margin-top:6px;color:#c9a35a;font-size:13px}
details{margin-top:20px}summary{cursor:pointer;color:#7d8794;font-size:13px}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
td{padding:6px 8px;border-top:1px solid #2a313a}.ellipsis{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.note{color:#7d8794;font-size:11px;margin-top:24px}
</style></head><body><main>
<h1>Agent 体检报告</h1><div class="when">${esc(when)} · 由 dsh-agent-checkup 导出</div>
<div class="overview">${esc(report.summary?.overview ?? `扫描 ${report.sessionsScanned ?? "?"} 个会话 · 探针 ${report.completedProbes ?? "?"}/${report.requestedProbes ?? "?"}`)}</div>
${groupHtml}
<details><summary>会话明细（${sessions.length} 个）</summary><table><tr><td></td><td>P1</td><td>P2</td><td>P3</td><td>P4</td></tr>${rows}</table></details>
<div class="note">candidate 结果：仅本地有限探针，不构成健康认证或生产就绪结论。</div>
</main></body></html>`;
}

export function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
		child.effect(
			() =>
				child.webServer.register({
					kind: "prefix",
					path: PREFIX,
					handler: async (request, response) => {
						const url = new URL(request.url ?? PREFIX, `http://${request.headers.host ?? "127.0.0.1"}`);
						if (url.pathname === `${PREFIX}/ping`) {
							sendJson(response, 200, { ok: true, plugin: "dsh-agent-checkup" });
							return;
						}
						if (url.pathname === `${PREFIX}/api/run` && request.method === "POST") {
							if (!trustedOrigin(request)) {
								sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
								return;
							}
							try {
								const body = await readBody(request);
								const report = await runCheckup(body);
								await mkdir(storageDir(), { recursive: true });
								await writeFile(reportFile(), JSON.stringify(report, null, 2), "utf8");
								sendJson(response, 200, report);
							} catch (error) {
								sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
							}
							return;
						}
						if (url.pathname === `${PREFIX}/api/report` && request.method === "GET") {
							if (!existsSync(reportFile())) {
								sendJson(response, 200, { ok: false, error: "尚未运行" });
								return;
							}
							try {
								response.writeHead(200, { "cache-control": "no-store", "content-type": "application/json; charset=utf-8" });
								response.end(await readFile(reportFile(), "utf8"));
							} catch (error) {
								sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
							}
							return;
						}
						if (url.pathname === `${PREFIX}/api/report/export` && request.method === "GET") {
							if (!existsSync(reportFile())) {
								sendJson(response, 200, { ok: false, error: "尚未运行" });
								return;
							}
							try {
								const raw = await readFile(reportFile(), "utf8");
								const report = JSON.parse(raw);
								const target = path.join(downloadsDir(), `agent-checkup-${Date.now()}.html`);
								writeFileSync(target, renderReportHtml(report), "utf8");
								sendJson(response, 200, { ok: true, path: target });
							} catch (error) {
								sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
							}
							return;
						}
						sendJson(response, 404, { ok: false, error: "未知接口" });
					},
				}),
			"agent-checkup: routes",
		);
	});
}

// Testable directly; the host only uses apply().
export { runCheckup };

