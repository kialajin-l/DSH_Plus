import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { existsSync, readdirSync, statSync } from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const PREFIX = "/designseed";
const ENGINE_DIR = "E:\\code\\DesignSeed";
const ENGINE_CLI = path.join(ENGINE_DIR, "engine", "cli.js");
const NODE_EXE =
	"H:\\k\\AI_TOOL\\DeepSeek Harness\\resources\\runtime\\primary-runtime\\dependencies\\node\\bin\\node.exe";
const GENERATE_TIMEOUT_MS = 60_000;
const KEEP_GENERATIONS = 20;
const STYLES_TTL_MS = 10 * 60 * 1000;

const FALLBACK_STYLES = [
	{ id: "minimalism", name: "极简主义", nameEn: "Minimalism" },
	{ id: "neumorphism", name: "新拟态", nameEn: "Neumorphism" },
	{ id: "glassmorphism", name: "玻璃拟态", nameEn: "Glassmorphism" },
	{ id: "memphis", name: "孟菲斯", nameEn: "Memphis" },
	{ id: "cyberpunk", name: "赛博朋克", nameEn: "Cyberpunk" },
	{ id: "ink_wash", name: "水墨风", nameEn: "Ink Wash" },
	{ id: "retro_pixel", name: "复古像素", nameEn: "Retro Pixel" },
	{ id: "futurism", name: "未来科技", nameEn: "Futurism" },
	{ id: "organic", name: "自然有机", nameEn: "Organic" },
	{ id: "industrial", name: "工业机械", nameEn: "Industrial" },
	{ id: "hand_drawn", name: "手绘插画", nameEn: "Hand Drawn" },
	{ id: "data_viz", name: "数据可视化", nameEn: "Data Visualization" },
];

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(os.homedir(), ".dsh");
}

function genDir() {
	return path.join(homeDir(), "storages", "designseed");
}

function sendJson(response, status, body) {
	const payload = JSON.stringify(body);
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	});
	response.end(payload);
}

async function readBody(request, limit = 64 * 1024) {
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > limit) throw new Error("请求体过大");
		chunks.push(chunk);
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	if (raw.length === 0) return {};
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error("请求体不是合法 JSON");
	}
}

// Settings panes render inside a sandboxed iframe (Origin: "null") and the GUI
// may use dsh-app: or a local http port. This server only listens on localhost,
// so absent/opaque origins are accepted while real cross-site origins are still
// rejected by host comparison.
function sameOrigin(request) {
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

let stylesCache;
async function loadStyles() {
	if (stylesCache && Date.now() - stylesCache.at < STYLES_TTL_MS) return stylesCache;
	try {
		const requireEngine = createRequire(pathToFileURL(path.join(ENGINE_DIR, "engine", "renderer.js")));
		const renderer = requireEngine(path.join(ENGINE_DIR, "engine", "renderer.js"));
		const list = renderer.listStyles().map((style) => ({
			id: style.id,
			name: style.name ?? style.id,
			nameEn: style.nameEn ?? "",
		}));
		if (!Array.isArray(list) || list.length === 0) throw new Error("引擎返回空风格列表");
		stylesCache = { at: Date.now(), styles: list, degraded: false };
	} catch (error) {
		stylesCache = { at: Date.now(), styles: FALLBACK_STYLES, degraded: true, error: String(error?.message ?? error) };
	}
	return stylesCache;
}

function runEngine(args) {
	return new Promise((resolve) => {
		const started = Date.now();
		const child = spawn(NODE_EXE, [ENGINE_CLI, ...args], { cwd: ENGINE_DIR, windowsHide: true });
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, GENERATE_TIMEOUT_MS);
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", (error) => {
			clearTimeout(timer);
			resolve({ ok: false, error: String(error?.message ?? error), stdout, stderr, durationMs: Date.now() - started });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({
				ok: code === 0 && !timedOut,
				timedOut,
				code,
				stdout,
				stderr,
				durationMs: Date.now() - started,
			});
		});
	});
}

function cleanupGenerations() {
	const dir = genDir();
	let entries;
	try {
		entries = readdirSync(dir).filter((name) => /^gen-\d+\.html$/.test(name));
	} catch {
		return;
	}
	if (entries.length <= KEEP_GENERATIONS) return;
	const sorted = entries
		.map((name) => {
			const full = path.join(dir, name);
			try {
				return { name, mtime: statSync(full).mtimeMs };
			} catch {
				return { name, mtime: 0 };
			}
		})
		.sort((left, right) => right.mtime - left.mtime);
	for (const stale of sorted.slice(KEEP_GENERATIONS)) {
		try {
			fsp.unlink(path.join(dir, stale.name)).catch(() => {});
		} catch {
			/* best effort */
		}
	}
}

async function handleGenerate(body) {
	const prompt = String(body?.prompt ?? "").trim();
	if (prompt.length === 0) return { ok: false, error: "需求描述不能为空" };
	if (prompt.length > 2000) return { ok: false, error: "需求描述过长（≤2000 字）" };
	const { styles } = await loadStyles();
	const known = new Set(styles.map((style) => style.id));
	const style = String(body?.style ?? "").trim() || "minimalism";
	if (known.size > 0 && !known.has(style)) return { ok: false, error: `未知风格：${style}` };
	const mixStyle = String(body?.mixStyle ?? "").trim();
	if (mixStyle && mixStyle === style) return { ok: false, error: "混合风格 B 不能与主风格相同" };
	if (mixStyle && known.size > 0 && !known.has(mixStyle)) return { ok: false, error: `未知混合风格：${mixStyle}` };
	let mixRatio = Number(body?.mixRatio ?? 0.3);
	if (!Number.isFinite(mixRatio)) mixRatio = 0.3;
	mixRatio = Math.min(0.9, Math.max(0.1, mixRatio));
	const styleArg = mixStyle ? `${style}:${mixStyle}:${mixRatio.toFixed(2)}` : style;

	const dir = genDir();
	await fsp.mkdir(dir, { recursive: true });
	const output = path.join(dir, `gen-${Date.now()}.html`);
	const run = await runEngine([
		"generate",
		"--prompt",
		prompt,
		"--style",
		styleArg,
		"--output",
		output,
	]);
	if (!run.ok || !existsSync(output)) {
		try {
			if (existsSync(output)) await fsp.unlink(output);
		} catch {
			/* best effort */
		}
		const tail = (run.stderr || run.stdout || "").trim().split("\n").slice(-4).join("\n");
		return {
			ok: false,
			error: run.timedOut ? `引擎超时（>${GENERATE_TIMEOUT_MS / 1000}s）` : `引擎退出码 ${run.code}${tail ? `：${tail}` : ""}`,
			durationMs: run.durationMs,
		};
	}
	const html = await fsp.readFile(output, "utf8");
	cleanupGenerations();
	return { ok: true, file: output, html, style: styleArg, durationMs: run.durationMs };
}

export function apply(ctx) {
	ctx.inject(["webServer"], (child) => {
		const route = {
			kind: "prefix",
			path: PREFIX,
			handler: async (request, response) => {
				const host = request.headers.host ?? "127.0.0.1";
				const url = new URL(request.url ?? PREFIX, `http://${host}`);
				const pathname = url.pathname;
				try {
					if (pathname === `${PREFIX}/ping` && request.method === "GET") {
						sendJson(response, 200, { ok: true, plugin: "dsh-designseed" });
						return;
					}
					if (pathname === `${PREFIX}/api/styles` && request.method === "GET") {
						const cache = await loadStyles();
						sendJson(response, 200, {
							ok: true,
							styles: cache.styles,
							degraded: cache.degraded === true,
							error: cache.error,
						});
						return;
					}
					if (pathname === `${PREFIX}/api/generate` && request.method === "POST") {
						if (!sameOrigin(request)) {
							sendJson(response, 403, { ok: false, error: "拒绝跨源或非 POST 请求" });
							return;
						}
						const body = await readBody(request);
						const result = await handleGenerate(body);
						sendJson(response, result.ok ? 200 : 400, result);
						return;
					}
					sendJson(response, 404, { ok: false, error: "未知接口" });
				} catch (error) {
					sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
				}
			},
		};
		child.effect(() => child.webServer.register(route), "designseed: routes");
	});
}
