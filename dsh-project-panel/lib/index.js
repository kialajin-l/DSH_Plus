/**
 * dsh-project-panel — project progress panel for the DSH settings page.
 *
 * Ports the E:\code\project-workbench scanner: per-project status.json anchors
 * (highest priority) with git/evidence heuristics as fallback, aggregated into
 * one scan response. Read-only except the explicit anchor-write endpoint.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PREFIX = "/project-panel";
const SCAN_CACHE_TTL_MS = 60_000;
const ANCHOR_STATUSES = new Set(["active", "blocked", "paused", "done"]);

const DEFAULT_EXCLUDES = [
	"^_",
	"^node_modules$",
	"^\\.venv$",
	"^\\.pytest",
	"^\\.codegraph$",
	"^\\.mimocode$",
	"^\\.slidep$",
	"^\\.workbuddy$",
	"-worktrees$",
	"-local-state$",
	"-backup-",
	"-recovery-",
	"-recovery\\d*$",
	"-intake-clean$",
	"-curated-",
	"-rebuilt-",
	"-git-recovery$",
	"-lockfix$",
	"-verification$",
	"-before_sync_\\d+$",
	"-20\\d{6}$",
	"^\\.st",
	"^tool ?模型插件$",
	"^tool-model-plugin$",
	"^Wenfxl-Codex-Manager$",
	"^deepwork-smoke$",
	"^workflow-e2e-sandbox$",
	"^Worktree$",
	"^测试$",
];

const MARKERS = [".git", "package.json", "pyproject.toml", "README.md", "Cargo.toml", "go.mod"];
const DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* paths + config                                                      */
/* ------------------------------------------------------------------ */

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(os.homedir(), ".dsh");
}

function configPath() {
	return path.join(homeDir(), "storages", "project-panel.json");
}

function normalizeRoots(roots) {
	const list = Array.isArray(roots) ? roots : [];
	const cleaned = list
		.map((root) => String(root ?? "").trim())
		.filter((root) => path.isAbsolute(root))
		.map((root) => path.resolve(root));
	return cleaned.length > 0 ? [...new Set(cleaned)] : ["E:\\code"];
}

function normalizeExcludes(excludes) {
	const list = Array.isArray(excludes) ? excludes : [];
	const cleaned = list.map((entry) => String(entry ?? "").trim()).filter((entry) => entry.length > 0);
	return cleaned.length > 0 ? cleaned : [...DEFAULT_EXCLUDES];
}

async function loadConfig() {
	const file = configPath();
	try {
		const raw = JSON.parse(await fsp.readFile(file, "utf8"));
		return {
			version: 1,
			roots: normalizeRoots(raw.roots),
			exclude: normalizeExcludes(raw.exclude),
		};
	} catch {
		return { version: 1, roots: normalizeRoots(undefined), exclude: normalizeExcludes(undefined) };
	}
}

async function saveConfig(config) {
	const file = configPath();
	await fsp.mkdir(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	await fsp.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
	await fsp.rename(tmp, file);
	const verify = JSON.parse(await fsp.readFile(file, "utf8"));
	if (!Array.isArray(verify.roots) || verify.roots.length === 0) throw new Error("配置写回校验失败");
	return verify;
}

/* ------------------------------------------------------------------ */
/* scanner (ported from project-workbench/scan.mjs)                     */
/* ------------------------------------------------------------------ */

function safeStat(p) {
	try {
		return fs.statSync(p);
	} catch {
		return null;
	}
}

function readJson(p) {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch {
		return null;
	}
}

function isProjectDir(dir) {
	return MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));
}

/** Parse the latest commit from .git/logs/HEAD without spawning git. */
function gitState(dir) {
	const logPath = path.join(dir, ".git", "logs", "HEAD");
	try {
		const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
		const last = lines[lines.length - 1];
		const m = last.match(/^[0-9a-f]{40}\s+[0-9a-f]{40}\s+(.*?)\s+<([^>]*)>\s+(\d+)\s+[+-]\d{4}\t(.*)$/);
		if (!m) return null;
		const subject = m[4].replace(/^commit(?:\s*\([^)]*\))?:\s*/, "").replace(/^merge:\s*/, "merge: ");
		return {
			lastCommitAt: new Date(Number(m[3]) * 1000).toISOString(),
			lastCommit: subject.slice(0, 160),
			author: m[1],
			commits: lines.length,
		};
	} catch {
		return null;
	}
}

function datePrefix(name) {
	const m = name.match(/(20\d{2}-\d{2}-\d{2})/) || name.match(/(20\d{6})/);
	if (!m) return null;
	return m[1].includes("-") ? m[1] : `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}`;
}

function scanEvidence(dir) {
	const ev = { gateCount: 0, latestGateDate: null, statusDocs: [], workflowRuns: 0, latestWorkflowDate: null };
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return ev;
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === ".git") continue;
		if (/(gate|scenario|acceptance)[-_]?results$/i.test(entry.name) || /^verification$/i.test(entry.name)) {
			let files = [];
			try {
				files = fs.readdirSync(path.join(dir, entry.name));
			} catch {}
			for (const f of files) {
				if (!/\.(json|md)$/i.test(f)) continue;
				ev.gateCount += 1;
				const d = datePrefix(f);
				if (d && (!ev.latestGateDate || d > ev.latestGateDate)) ev.latestGateDate = d;
			}
		}
	}
	const docDirs = ["", "docs"];
	for (const sub of docDirs) {
		let files = [];
		try {
			files = fs.readdirSync(path.join(dir, sub));
		} catch {}
		for (const f of files) {
			if (!/\.md$/i.test(f)) continue;
			if (!/(progress|roadmap|status|handoff|CHANGELOG)/i.test(f)) continue;
			const st = safeStat(path.join(dir, sub, f));
			if (!st) continue;
			ev.statusDocs.push({ file: path.join(sub, f).replace(/\\/g, "/"), mtime: new Date(st.mtimeMs).toISOString() });
		}
	}
	ev.statusDocs.sort((a, b) => b.mtime.localeCompare(a.mtime));
	ev.statusDocs = ev.statusDocs.slice(0, 4);
	for (const wr of ["docs/superpowers/workflow-runs", "workflow-runs", "docs/workflow-runs"]) {
		let files = [];
		try {
			files = fs.readdirSync(path.join(dir, wr));
		} catch {
			continue;
		}
		for (const f of files) {
			if (!/\.(md|json)$/i.test(f)) continue;
			ev.workflowRuns += 1;
			const d = datePrefix(f);
			if (d && (!ev.latestWorkflowDate || d > ev.latestWorkflowDate)) ev.latestWorkflowDate = d;
		}
		if (ev.workflowRuns) break;
	}
	return ev;
}

function pkgInfo(dir) {
	const pj = readJson(path.join(dir, "package.json"));
	if (pj) return { name: pj.name, version: pj.version, description: (pj.description || "").slice(0, 160) };
	try {
		const text = fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");
		const name = (text.match(/^name\s*=\s*"([^"]+)"/m) || [])[1];
		const version = (text.match(/^version\s*=\s*"([^"]+)"/m) || [])[1];
		const desc = (text.match(/^description\s*=\s*"([^"]*)"/m) || [])[1] || "";
		if (name || version) return { name, version, description: desc.slice(0, 160) };
	} catch {}
	return null;
}

function readmeLine(dir) {
	try {
		const lines = fs.readFileSync(path.join(dir, "README.md"), "utf8").split(/\r?\n/);
		for (const l of lines) {
			const t = l.replace(/^#+\s*/, "").trim();
			if (t && !/^>|^!\[|^-{3,}|^\|/.test(t) && t.length > 4) return t.slice(0, 160);
		}
	} catch {}
	return "";
}

function derive(anchor, git, ev, now) {
	let status;
	let source = "anchor";
	let updated = null;
	if (anchor && !anchor._error) {
		status = anchor.status || "unknown";
		updated = anchor.updated ? `${anchor.updated}T23:59:59` : null;
	} else {
		source = "inferred";
		const dates = [
			git?.lastCommitAt,
			ev.latestGateDate ? `${ev.latestGateDate}T23:59:59` : null,
			ev.latestWorkflowDate ? `${ev.latestWorkflowDate}T23:59:59` : null,
			ev.statusDocs?.[0]?.mtime,
		]
			.filter(Boolean)
			.sort();
		updated = dates[dates.length - 1] || null;
		if (!updated) status = "unknown";
		else {
			const days = (now - Date.parse(updated)) / DAY;
			status = days <= 14 ? "active" : days <= 45 ? "slowing" : "idle";
		}
	}
	const daysSince = updated ? Math.max(0, Math.floor((now - Date.parse(updated)) / DAY)) : null;
	return { status, source, updated, daysSince };
}

function scanProject(root, name, now) {
	const dir = path.join(root, name);
	const rawAnchor = readJson(path.join(dir, "status.json"));
	let anchor = rawAnchor;
	if (!rawAnchor && fs.existsSync(path.join(dir, "status.json"))) {
		anchor = { _error: "status.json 解析失败" };
	}
	const git = gitState(dir);
	const ev = scanEvidence(dir);
	const derived = derive(anchor && !anchor._error ? anchor : null, git, ev, now);
	const anchorData = anchor && !anchor._error ? anchor : null;
	return {
		name,
		path: dir,
		source: derived.source,
		status: derived.status,
		phase: anchorData?.phase ?? null,
		currentTask: anchorData?.current_task ?? null,
		nextStep: anchorData?.next_step ?? null,
		blockers: Array.isArray(anchorData?.blockers) ? anchorData.blockers.map(String).slice(0, 10) : [],
		progress: typeof anchorData?.progress === "number" ? anchorData.progress : null,
		updated: derived.updated,
		daysSince: derived.daysSince,
		activity: derived.daysSince === null ? null : `${derived.daysSince} 天前`,
		lastCommitAt: git?.lastCommitAt ?? null,
		lastCommit: git?.lastCommit ?? null,
		evidenceCount: ev.gateCount + ev.workflowRuns,
		description: pkgInfo(dir)?.description ?? readmeLine(dir),
		anchorError: anchor?._error ?? null,
	};
}

async function scanRoots(config) {
	const now = Date.now();
	const projects = [];
	const errors = [];
	for (const root of config.roots) {
		let entries;
		try {
			entries = await fsp.readdir(root, { withFileTypes: true });
		} catch (error) {
			errors.push({ root, error: String(error?.message ?? error) });
			continue;
		}
		const excludes = config.exclude.map((pattern) => new RegExp(pattern));
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (excludes.some((re) => re.test(entry.name))) continue;
			const dir = path.join(root, entry.name);
			if (!isProjectDir(dir)) continue;
			try {
				projects.push(scanProject(root, entry.name, now));
			} catch (error) {
				errors.push({ root: entry.name, error: String(error?.message ?? error) });
			}
		}
	}
	projects.sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? "") || a.name.localeCompare(b.name));
	const counts = {};
	for (const project of projects) counts[project.status] = (counts[project.status] ?? 0) + 1;
	return { ok: true, generatedAt: now, roots: config.roots, counts, total: projects.length, projects, errors };
}

/* ------------------------------------------------------------------ */
/* scan cache                                                          */
/* ------------------------------------------------------------------ */

let scanCache = { key: "", at: 0, value: null };

async function cachedScan(config) {
	const key = JSON.stringify(config);
	if (scanCache.value !== null && scanCache.key === key && Date.now() - scanCache.at < SCAN_CACHE_TTL_MS) {
		return { ...scanCache.value, cached: true };
	}
	const value = await scanRoots(config);
	scanCache = { key, at: Date.now(), value };
	return value;
}

/* ------------------------------------------------------------------ */
/* anchor write                                                        */
/* ------------------------------------------------------------------ */

function todayBeijing() {
	return new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
}

function pathUnderRoots(candidate, roots) {
	const resolved = path.resolve(String(candidate ?? ""));
	const lower = resolved.toLowerCase();
	const hit = roots.find((root) => {
		const base = path.resolve(root).toLowerCase();
		return lower === base || lower.startsWith(base.endsWith("\\") ? base : `${base}\\`);
	});
	return hit === undefined ? null : resolved;
}

async function writeAnchor(body) {
	const config = await loadConfig();
	const dir = pathUnderRoots(body?.path, config.roots);
	if (dir === null) return { ok: false, error: "path 必须是已配置扫描根下的绝对路径" };
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { ok: false, error: "目录不存在" };
	const status = String(body?.status ?? "").trim();
	if (!ANCHOR_STATUSES.has(status)) return { ok: false, error: `status 必须是 ${[...ANCHOR_STATUSES].join("/")}` };
	const file = path.join(dir, "status.json");
	const existing = readJson(file) ?? {};
	if (existing._error) return { ok: false, error: "现有 status.json 解析失败，请先手工修复" };
	const previousUpdated = existing.updated ?? null;
	const merged = {
		...existing,
		project: typeof existing.project === "string" && existing.project.length > 0 ? existing.project : path.basename(dir),
		updated: todayBeijing(),
		status,
	};
	if (body?.phase !== undefined) merged.phase = String(body.phase ?? "").slice(0, 200);
	if (body?.currentTask !== undefined) merged.current_task = String(body.currentTask ?? "").slice(0, 300);
	if (body?.nextStep !== undefined) merged.next_step = String(body.nextStep ?? "").slice(0, 300);
	if (body?.blockers !== undefined) {
		merged.blockers = Array.isArray(body.blockers) ? body.blockers.map((item) => String(item)).slice(0, 10) : [];
	}
	const tmp = path.join(dir, `.status.json.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
	try {
		await fsp.writeFile(tmp, JSON.stringify(merged, null, 2), "utf8");
		await fsp.rename(tmp, file);
		const verify = JSON.parse(await fsp.readFile(file, "utf8"));
		if (verify.status !== status || verify.updated !== merged.updated) throw new Error("读回校验失败");
		// The panel must reflect the new anchor immediately, not after the TTL.
		scanCache = { key: "", at: 0, value: null };
		return { ok: true, path: dir, file, previousUpdated };
	} catch (error) {
		try {
			await fsp.rm(tmp, { force: true });
		} catch {}
		if (Object.keys(existing).length > 0) {
			try {
				await fsp.writeFile(file, JSON.stringify(existing, null, 2), "utf8");
			} catch {}
		}
		return { ok: false, error: String(error?.message ?? error) };
	}
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

function readBody(request) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let size = 0;
		request.on("data", (chunk) => {
			size += chunk.length;
			if (size > 256 * 1024) {
				reject(new Error("请求体过大"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				resolve(text.length > 0 ? JSON.parse(text) : {});
			} catch (error) {
				reject(error);
			}
		});
		request.on("error", reject);
	});
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

export function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
		child.effect(
			() =>
				child.webServer.register({
					kind: "prefix",
					path: PREFIX,
					handler: async (request, response) => {
						const url = new URL(request.url ?? PREFIX, `http://${request.headers.host ?? "127.0.0.1"}`);
						const pathname = url.pathname;
						try {
							if (pathname === `${PREFIX}/ping` && request.method === "GET") {
								sendJson(response, 200, { ok: true, plugin: "dsh-project-panel" });
								return;
							}
							if (pathname === `${PREFIX}/api/config` && request.method === "GET") {
								sendJson(response, 200, { ok: true, config: await loadConfig(), configFile: configPath() });
								return;
							}
							if (pathname === `${PREFIX}/api/config` && request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readBody(request);
								const config = {
									version: 1,
									roots: normalizeRoots(body?.roots),
									exclude: normalizeExcludes(body?.exclude),
								};
								const saved = await saveConfig(config);
								scanCache = { key: "", at: 0, value: null };
								sendJson(response, 200, { ok: true, config: saved });
								return;
							}
							if (pathname === `${PREFIX}/api/scan` && request.method === "GET") {
								sendJson(response, 200, await cachedScan(await loadConfig()));
								return;
							}
							if (pathname === `${PREFIX}/api/anchor` && request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readBody(request);
								sendJson(response, 200, await writeAnchor(body));
								return;
							}
							if (pathname === `${PREFIX}/api/export` && (request.method === "GET" || request.method === "POST")) {
								const summary = await cachedScan(await loadConfig());
								const html = renderExportHtml(summary);
								const stamp = new Date(Date.now() + 8 * 3600e3).toISOString().replace(/[-:TZ]/g, "").slice(0, 14);
								const file = path.join(os.homedir(), "Downloads", `project-progress-${stamp}.html`);
								await fsp.mkdir(path.dirname(file), { recursive: true });
								await fsp.writeFile(file, html, "utf8");
								sendJson(response, 200, { ok: true, file, count: summary.projects.length });
								return;
							}
							sendJson(response, 404, { ok: false, error: "未知路径" });
						} catch (error) {
							sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
						}
					},
				}),
			"project-panel: routes",
		);
	});
}

/* ------------------------------------------------------------------ */
/* html export                                                         */
/* ------------------------------------------------------------------ */

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

const EXPORT_STATUS_META = {
	active: { label: "推进中", color: "#3fb96f" },
	slowing: { label: "放缓", color: "#d8a03c" },
	idle: { label: "沉寂", color: "#8a919c" },
	blocked: { label: "阻塞", color: "#e0564f" },
	paused: { label: "暂停", color: "#4f8fe0" },
	done: { label: "完成", color: "#9a7ff0" },
	unknown: { label: "未知", color: "#6b7280" },
};

function exportCard(project) {
	const meta = EXPORT_STATUS_META[project.status] ?? EXPORT_STATUS_META.unknown;
	const rows = [];
	const row = (label, value) => {
		if (value === undefined || value === null || String(value).length === 0) return;
		rows.push(`<div class="row"><span class="k">${label}</span><span class="v">${value}</span></div>`);
	};
	row("阶段", escapeHtml(project.phase));
	row("在办", escapeHtml(project.currentTask));
	row("下一步", escapeHtml(project.nextStep));
	if (Array.isArray(project.blockers) && project.blockers.length > 0) {
		row("阻塞", escapeHtml(project.blockers.join("；")));
	}
	const badges = [
		`<span class="badge" style="color:${meta.color};border-color:${meta.color}55">${meta.label}</span>`,
		project.source === "anchor"
			? '<span class="badge src-anchor">锚点</span>'
			: '<span class="badge src-inferred">推断</span>',
	];
	const progress =
		typeof project.progress === "number"
			? `<div class="progress"><div class="bar" style="width:${Math.max(0, Math.min(100, project.progress))}%"></div></div>`
			: "";
	return `<div class="card" data-status="${escapeHtml(project.status)}">
	<div class="card-head"><span class="name">${escapeHtml(project.name)}</span>${badges.join("")}</div>
	${progress}
	${rows.length > 0 ? `<div class="rows">${rows.join("")}</div>` : ""}
	<div class="card-foot">${escapeHtml(project.lastCommit ?? "")}${project.lastCommit ? " · " : ""}${escapeHtml(project.activity ?? "")}</div>
</div>`;
}

function renderExportHtml(summary) {
	const generatedAt = new Date(summary.generatedAt).toLocaleString("zh-CN", { hour12: false });
	const counts = summary.counts ?? {};
	const order = ["active", "slowing", "idle", "blocked", "paused", "done", "unknown"];
	const chips = [
		`<button class="chip on" data-filter="all">全部 ${summary.total}</button>`,
		...order
			.filter((status) => (counts[status] ?? 0) > 0)
			.map((status) => {
				const meta = EXPORT_STATUS_META[status];
				return `<button class="chip" data-filter="${status}">${meta.label} ${counts[status]}</button>`;
			}),
	].join("");
	const cards = (summary.projects ?? []).map(exportCard).join("\n");
	const stats = [
		["项目总数", summary.total, "#d7dde5"],
		["推进中", counts.active ?? 0, "#3fb96f"],
		["放缓", counts.slowing ?? 0, "#d8a03c"],
		["沉寂", counts.idle ?? 0, "#8a919c"],
		["阻塞", counts.blocked ?? 0, "#e0564f"],
	]
		.map(([label, value, color]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="color:${color}">${value}</div></div>`)
		.join("");
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>项目进度 · ${escapeHtml(generatedAt)}</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#111418;color:#d7dde5;font:14px/1.55 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}
.wrap{max-width:1200px;margin:0 auto;padding:24px}
h1{font-size:20px;margin:0 0 4px}
.sub{color:#8a919c;font-size:12px;margin-bottom:18px}
.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.stat{flex:1 1 120px;background:#1a1f26;border:1px solid #262c35;border-radius:10px;padding:12px 14px}
.stat-label{color:#8a919c;font-size:12px}
.stat-value{font-size:24px;font-weight:600;margin-top:4px;font-variant-numeric:tabular-nums}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.chip{background:transparent;border:1px solid #262c35;color:#8a919c;border-radius:999px;padding:4px 12px;font:inherit;font-size:12px;cursor:pointer}
.chip.on{color:#d7dde5;border-color:#4f8fe0;background:#4f8fe01a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.card{background:#1a1f26;border:1px solid #262c35;border-radius:10px;padding:12px 14px}
.card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.name{font-weight:600;font-size:14px}
.badge{font-size:11px;border:1px solid;border-radius:999px;padding:1px 8px;white-space:nowrap}
.src-anchor{color:#4f8fe0;border-color:#4f8fe055}
.src-inferred{color:#8a919c;border-color:#8a919c55}
.rows{display:grid;gap:3px;margin-top:6px}
.row{display:flex;gap:8px;font-size:12px}
.row .k{flex:0 0 44px;color:#8a919c}
.row .v{color:#b9c1cc;min-width:0;word-break:break-word}
.card-foot{margin-top:8px;color:#6b7280;font-size:11px;border-top:1px solid #262c35;padding-top:6px}
.progress{height:6px;background:#262c35;border-radius:3px;overflow:hidden;margin-top:6px}
.bar{height:100%;background:#3fb96f}
.foot{color:#6b7280;font-size:12px;margin-top:20px;text-align:center}
</style>
</head>
<body>
<div class="wrap">
	<h1>项目进度</h1>
	<div class="sub">生成时间：${escapeHtml(generatedAt)} · 数据来自本地扫描（锚点优先，其余为推断）</div>
	<div class="stats">${stats}</div>
	<div class="chips">${chips}</div>
	<div class="grid">${cards}</div>
	<div class="foot">由 dsh-project-panel 导出 · ${escapeHtml(generatedAt)}</div>
</div>
<script>
(function(){
	var chips=document.querySelectorAll(".chip");
	chips.forEach(function(chip){
		chip.addEventListener("click",function(){
			chips.forEach(function(c){c.classList.remove("on");});
			chip.classList.add("on");
			var filter=chip.getAttribute("data-filter");
			document.querySelectorAll(".card").forEach(function(card){
				card.style.display=(filter==="all"||card.getAttribute("data-status")===filter)?"":"none";
			});
		});
	});
})();
</script>
</body>
</html>`;
}

