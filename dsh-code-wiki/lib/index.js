/**
 * dsh-code-wiki — structured per-project wiki for the DSH settings page.
 *
 * Ports the E:\code\Code-Wiki idea: for every detected project under the
 * configured roots, build a lightweight structured overview (package metadata,
 * README digest, docs tree, top-level layout, git activity, language mix),
 * cache it under storages, and render/export it as Markdown. Strictly
 * read-only against project directories; exports go to Downloads only.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const PREFIX = "/code-wiki";
const DAY = 86_400_000;
const MARKERS = [".git", "package.json", "pyproject.toml", "README.md", "Cargo.toml", "go.mod"];
const DOCS_DIR_NAMES = ["docs", "doc", "documentation"];
const MAX_DOCS_ENTRIES = 100;
const MAX_LANG_FILES = 8000;
const LANG_DEPTH = 3;
const LANG_SKIP = new Set([
	"node_modules", ".git", "dist", "build", "out", "target", ".venv", "venv",
	"__pycache__", ".next", "coverage", ".idea", ".vscode", "worktrees",
]);

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

const EXT_LANGUAGE = {
	".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
	".mjs": "JavaScript", ".cjs": "JavaScript", ".py": "Python", ".md": "Markdown",
	".vue": "Vue", ".rs": "Rust", ".go": "Go", ".java": "Java", ".cs": "C#",
	".c": "C", ".h": "C/C++", ".cpp": "C++", ".json": "JSON", ".yaml": "YAML",
	".yml": "YAML", ".toml": "TOML", ".html": "HTML", ".css": "CSS", ".scss": "CSS",
	".sh": "Shell", ".ps1": "PowerShell", ".sql": "SQL",
};

/* ------------------------------------------------------------------ */
/* paths + config                                                      */
/* ------------------------------------------------------------------ */

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(os.homedir(), ".dsh");
}

function configPath() {
	return path.join(homeDir(), "storages", "code-wiki.json");
}

function cacheDir() {
	return path.join(homeDir(), "storages", "code-wiki");
}

function normalizeRoots(roots) {
	if (!Array.isArray(roots)) return ["E:\\code"];
	const out = roots
		.filter((root) => typeof root === "string" && path.isAbsolute(root.trim()))
		.map((root) => path.resolve(root.trim()));
	return out.length > 0 ? out : ["E:\\code"];
}

function normalizeExcludes(excludes) {
	if (!Array.isArray(excludes)) return [...DEFAULT_EXCLUDES];
	const out = excludes.filter((rule) => typeof rule === "string" && rule.trim().length > 0);
	return out.length > 0 ? out : [...DEFAULT_EXCLUDES];
}

async function loadConfig() {
	try {
		const raw = JSON.parse(await fsp.readFile(configPath(), "utf8"));
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
	const temp = `${file}.tmp`;
	await fsp.writeFile(temp, JSON.stringify(config, null, 2), "utf8");
	await fsp.rename(temp, file);
	return config;
}

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function safeStat(p) {
	try {
		return fs.statSync(p);
	} catch {
		return undefined;
	}
}

function readJson(p) {
	try {
		return JSON.parse(fs.readFileSync(p, "utf8"));
	} catch {
		return undefined;
	}
}

function excluded(name, rules) {
	return rules.some((rule) => {
		try {
			return new RegExp(rule, "iu").test(name);
		} catch {
			return name === rule;
		}
	});
}

function isProjectDir(dir) {
	return MARKERS.some((marker) => fs.existsSync(path.join(dir, marker)));
}

function stripMarkdown(text) {
	return String(text)
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_~>#|]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function firstHeading(text) {
	const match = String(text).match(/^#\s+(.+)$/m);
	return match ? match[1].trim() : undefined;
}

function readmeDigest(dir) {
	const entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
	const readme = entries.find((name) => /^readme(\.md|\.txt)?$/iu.test(name));
	if (readme === undefined) return { title: undefined, summary: "" };
	try {
		const text = fs.readFileSync(path.join(dir, readme), "utf8");
		const title = firstHeading(text);
		const paragraphs = text
			.split(/\r?\n\s*\r?\n/)
			.map((block) => stripMarkdown(block))
			.filter((part) => part.length > 24 && !part.startsWith("#"));
		return { title, summary: paragraphs.slice(0, 3).join(" ").slice(0, 600) };
	} catch {
		return { title: undefined, summary: "" };
	}
}

function gitState(dir) {
	const logFile = path.join(dir, ".git", "logs", "HEAD");
	try {
		const text = fs.readFileSync(logFile, "utf8");
		const lines = text.split("\n").filter((line) => line.trim().length > 0);
		if (lines.length === 0) return { commits: 0, lastCommitAt: undefined };
		const parts = lines[lines.length - 1].split("\t")[0].trim().split(/\s+/);
		const stamps = parts.map((part) => Number(part)).filter((value) => Number.isFinite(value) && value > 1e9);
		const lastCommitAt = stamps.length > 0 ? stamps[stamps.length - 1] * 1000 : undefined;
		return { commits: lines.length, lastCommitAt };
	} catch {
		return { commits: 0, lastCommitAt: undefined };
	}
}

function pkgInfo(dir) {
	const pkg = readJson(path.join(dir, "package.json"));
	if (pkg !== undefined) {
		return {
			name: typeof pkg.name === "string" ? pkg.name : undefined,
			description: typeof pkg.description === "string" ? pkg.description : undefined,
			manager: "npm/pnpm/yarn",
			scripts: typeof pkg.scripts === "object" && pkg.scripts !== null
				? Object.entries(pkg.scripts).slice(0, 8).map(([script, command]) => ({ script, command: String(command).slice(0, 120) }))
				: [],
		};
	}
	const pyproject = readText(path.join(dir, "pyproject.toml"));
	if (pyproject !== undefined) {
		const name = pyproject.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
		const description = pyproject.match(/^description\s*=\s*"([^"]+)"/m)?.[1];
		return { name, description, manager: "python/pyproject", scripts: [] };
	}
	if (fs.existsSync(path.join(dir, "requirements.txt"))) {
		return { name: undefined, description: undefined, manager: "python/requirements", scripts: [] };
	}
	return { name: undefined, description: undefined, manager: undefined, scripts: [] };
}

function readText(file) {
	try {
		return fs.readFileSync(file, "utf8");
	} catch {
		return undefined;
	}
}

function collectDocs(dir) {
	for (const name of DOCS_DIR_NAMES) {
		const docsDir = path.join(dir, name);
		if (!fs.existsSync(docsDir)) continue;
		const out = [];
		const walk = (current, prefix, depth) => {
			if (out.length >= MAX_DOCS_ENTRIES || depth > 4) return;
			let entries;
			try {
				entries = fs.readdirSync(current, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				if (out.length >= MAX_DOCS_ENTRIES) return;
				const full = path.join(current, entry.name);
				if (entry.isDirectory()) {
					walk(full, `${prefix}${entry.name}/`, depth + 1);
				} else if (/\.(md|markdown|txt)$/iu.test(entry.name)) {
					const stat = safeStat(full);
					const text = readText(full) ?? "";
					out.push({
						relPath: `${prefix}${entry.name}`,
						title: firstHeading(text) ?? entry.name,
						mtime: stat?.mtimeMs ?? 0,
					});
				}
			}
		};
		walk(docsDir, "", 0);
		if (out.length > 0) return { dirName: name, entries: out };
	}
	return { dirName: undefined, entries: [] };
}

function topLevelDirs(dir) {
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
			.slice(0, 24)
			.map((entry) => {
				let count = 0;
				try {
					count = fs.readdirSync(path.join(dir, entry.name)).length;
				} catch {
					count = 0;
				}
				return { name: entry.name, files: count };
			});
	} catch {
		return [];
	}
}

function languageMix(dir) {
	const counts = new Map();
	let scanned = 0;
	const walk = (current, depth) => {
		if (depth > LANG_DEPTH || scanned >= MAX_LANG_FILES) return;
		let entries;
		try {
			entries = fs.readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (scanned >= MAX_LANG_FILES) return;
			if (entry.isDirectory()) {
				if (LANG_SKIP.has(entry.name) || entry.name.startsWith(".")) continue;
				walk(path.join(current, entry.name), depth + 1);
			} else {
				scanned += 1;
				const ext = path.extname(entry.name).toLowerCase();
				if (ext.length === 0) continue;
				const language = EXT_LANGUAGE[ext] ?? ext.slice(1);
				counts.set(language, (counts.get(language) ?? 0) + 1);
			}
		}
	};
	walk(dir, 0);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([language, count]) => ({ language, files: count }));
}

function cacheHash(dir) {
	const stat = safeStat(dir);
	let seed = `${dir.toLowerCase()}|${stat?.mtimeMs ?? 0}`;
	try {
		for (const entry of fs.readdirSync(dir).slice(0, 40)) {
			const s = safeStat(path.join(dir, entry));
			seed += `|${entry}:${s?.mtimeMs ?? 0}`;
		}
	} catch {
		/* ignore */
	}
	return crypto.createHash("sha1").update(seed).digest("hex").slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* wiki build                                                          */
/* ------------------------------------------------------------------ */

async function buildWiki(dir, rules) {
	const stat = safeStat(dir);
	if (stat === undefined || !stat.isDirectory()) return { ok: false, error: "目录不存在" };
	const name = path.basename(dir);
	const pkg = pkgInfo(dir);
	const readme = readmeDigest(dir);
	const docs = collectDocs(dir);
	const git = gitState(dir);
	const langs = languageMix(dir);
	const wiki = {
		version: 1,
		path: dir,
		name,
		builtAt: Date.now(),
		displayName: pkg.name ?? readme.title ?? name,
		description: pkg.description ?? "",
		summary: readme.summary,
		readmeTitle: readme.title,
		manager: pkg.manager,
		scripts: pkg.scripts,
		languages: langs,
		topDirs: topLevelDirs(dir),
		docsDir: docs.dirName,
		docs: docs.entries,
		docsTruncated: docs.entries.length >= MAX_DOCS_ENTRIES,
		commits: git.commits,
		lastCommitAt: git.lastCommitAt,
	};
	const hash = cacheHash(dir);
	const cacheFile = path.join(cacheDir(), `wiki-${hash}.json`);
	await fsp.mkdir(cacheDir(), { recursive: true });
	const temp = `${cacheFile}.tmp`;
	await fsp.writeFile(temp, JSON.stringify({ ...wiki, cacheFile: path.basename(cacheFile) }, null, 2), "utf8");
	await fsp.rename(temp, cacheFile);
	void rules;
	return { ok: true, path: dir, name, cacheFile: path.basename(cacheFile) };
}

function projectDirs(config) {
	const out = [];
	for (const root of config.roots) {
		let entries;
		try {
			entries = fs.readdirSync(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (excluded(entry.name, config.exclude)) continue;
			const dir = path.join(root, entry.name);
			if (isProjectDir(dir)) out.push(dir);
		}
	}
	return out.sort((a, b) => a.localeCompare(b));
}

async function buildAll(config) {
	const started = Date.now();
	const built = [];
	const skipped = [];
	for (const dir of projectDirs(config)) {
		try {
			const result = await buildWiki(dir, config.exclude);
			if (result.ok) built.push(result);
			else skipped.push({ path: dir, reason: result.error });
		} catch (error) {
			skipped.push({ path: dir, reason: String(error?.message ?? error) });
		}
	}
	return { ok: true, generatedAt: Date.now(), durationMs: Date.now() - started, built, skipped };
}

async function listBuilt() {
	try {
		await fsp.mkdir(cacheDir(), { recursive: true });
		const files = (await fsp.readdir(cacheDir())).filter((name) => /^wiki-[0-9a-f]+\.json$/.test(name));
		// Cache files are keyed by a path+mtime hash, so a rebuilt project leaves a
		// stale sibling behind; keep only the newest entry per project path.
		const byPath = new Map();
		for (const file of files) {
			const wiki = readJson(path.join(cacheDir(), file));
			if (wiki === undefined) continue;
			const existing = byPath.get(wiki.path);
			if (existing === undefined || (wiki.builtAt ?? 0) >= (existing.builtAt ?? 0)) byPath.set(wiki.path, { wiki, file });
		}
		const items = [];
		for (const { wiki, file } of byPath.values()) {
			items.push({
				path: wiki.path,
				name: wiki.name,
				displayName: wiki.displayName,
				description: wiki.description,
				summary: wiki.summary,
				languages: wiki.languages,
				commits: wiki.commits,
				lastCommitAt: wiki.lastCommitAt,
				builtAt: wiki.builtAt,
				cacheFile: file,
			});
		}
		items.sort((a, b) => (b.lastCommitAt ?? 0) - (a.lastCommitAt ?? 0));
		return { ok: true, items };
	} catch (error) {
		return { ok: false, error: String(error?.message ?? error), items: [] };
	}
}

function renderMarkdown(wiki) {
	const lines = [];
	lines.push(`# ${wiki.displayName ?? wiki.name} · 项目 Wiki`, "");
	lines.push(`- 路径：\`${wiki.path}\``);
	if (wiki.description) lines.push(`- 简介：${wiki.description}`);
	if (wiki.manager) lines.push(`- 包管理：${wiki.manager}`);
	lines.push(`- 生成时间：${new Date(wiki.builtAt).toLocaleString("zh-CN")}`, "");
	if (wiki.summary) lines.push("## README 摘要", "", wiki.summary, "");
	if (wiki.languages?.length > 0) {
		lines.push("## 技术栈", "", ...wiki.languages.map((lang) => `- ${lang.language}：${lang.files} 个文件`), "");
	}
	if (wiki.scripts?.length > 0) {
		lines.push("## 常用脚本", "", ...wiki.scripts.map((s) => `- \`${s.script}\`：\`${s.command}\``), "");
	}
	if (wiki.topDirs?.length > 0) {
		lines.push("## 顶层目录", "", ...wiki.topDirs.map((d) => `- ${d.name}/（${d.files} 个条目）`), "");
	}
	if (wiki.docs?.length > 0) {
		lines.push(
			`## ${wiki.docsDir ?? "docs"} 文档${wiki.docsTruncated ? "（已截断）" : `（${wiki.docs.length}）`}`,
			"",
			...wiki.docs.map((doc) => `- \`${doc.relPath}\` — ${doc.title}（${new Date(doc.mtime).toLocaleDateString("zh-CN")}）`),
			"",
		);
	}
	lines.push(
		"## Git 活跃度",
		"",
		`- 提交数（reflog）：${wiki.commits ?? 0}`,
		`- 最近提交：${wiki.lastCommitAt ? new Date(wiki.lastCommitAt).toLocaleString("zh-CN") : "—"}`,
		"",
	);
	return lines.join("\n");
}

async function exportWiki(bodyPath) {
	const hash = cacheHash(bodyPath);
	const cacheFile = path.join(cacheDir(), `wiki-${hash}.json`);
	const wiki = readJson(cacheFile);
	if (wiki === undefined) return { ok: false, error: "该项目尚未构建 Wiki，请先构建" };
	const markdown = renderMarkdown(wiki);
	const safeName = String(wiki.name).replace(/[^\w\u4e00-\u9fa5.-]+/g, "_");
	const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
	const outPath = path.join(os.homedir(), "Downloads", `wiki-${safeName}-${stamp}.md`);
	await fsp.mkdir(path.dirname(outPath), { recursive: true });
	await fsp.writeFile(outPath, markdown, "utf8");
	return { ok: true, path: outPath, bytes: Buffer.byteLength(markdown) };
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
								sendJson(response, 200, { ok: true, plugin: "dsh-code-wiki" });
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
								sendJson(response, 200, { ok: true, config: saved });
								return;
							}
							if (pathname === `${PREFIX}/api/build` && request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readBody(request);
								if (typeof body?.path === "string" && body.path.trim().length > 0) {
									const result = await buildWiki(path.resolve(body.path.trim()), (await loadConfig()).exclude);
									sendJson(response, 200, result);
									return;
								}
								sendJson(response, 200, await buildAll(await loadConfig()));
								return;
							}
							if (pathname === `${PREFIX}/api/list` && request.method === "GET") {
								sendJson(response, 200, await listBuilt());
								return;
							}
							if (pathname === `${PREFIX}/api/wiki` && request.method === "GET") {
								const target = url.searchParams.get("path") ?? "";
								if (target.trim().length === 0) {
									sendJson(response, 400, { ok: false, error: "缺少 path" });
									return;
								}
								const hash = cacheHash(path.resolve(target));
								const wiki = readJson(path.join(cacheDir(), `wiki-${hash}.json`));
								if (wiki === undefined) {
									sendJson(response, 404, { ok: false, error: "尚未构建" });
									return;
								}
								sendJson(response, 200, { ok: true, wiki });
								return;
							}
							if (pathname === `${PREFIX}/api/export` && request.method === "POST") {
								if (!sameOrigin(request)) {
									sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
									return;
								}
								const body = await readBody(request);
								if (typeof body?.path !== "string" || body.path.trim().length === 0) {
									sendJson(response, 400, { ok: false, error: "缺少 path" });
									return;
								}
								sendJson(response, 200, await exportWiki(path.resolve(body.path.trim())));
								return;
							}
							sendJson(response, 404, { ok: false, error: "未知路径" });
						} catch (error) {
							sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
						}
					},
				}),
			"code-wiki: routes",
		);
	});
}

