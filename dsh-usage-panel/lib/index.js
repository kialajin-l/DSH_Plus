/**
 * dsh-usage-panel — host half.
 *
 * Read-only analytics over persisted session logs: aggregates provider-reported
 * token usage from `assistant/message` events into daily and per-session spend,
 * priced with the published DeepSeek peak/off-peak table. Never writes session
 * data, workspace records, or projection caches.
 */
import fsp from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import zlib from "node:zlib";

export const name = "dsh-usage-panel";

const PREFIX = "/usage-panel";
const ZSTD_MAGIC = 0xfd2fb528;
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_WORK_MS = 8000;
const MAX_SESSIONS = 30;
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Official DeepSeek CNY prices per million tokens, peak hours (2026-10-25 export). */
const PEAK_PRICES = {
	"deepseek-flash": { hit: 0.04, miss: 2.0, out: 8.0 },
	"deepseek-v4-flash": { hit: 0.04, miss: 2.0, out: 8.0 },
	"deepseek-v4-pro": { hit: 0.3, miss: 9.0, out: 27.0 },
	"deepseek-pro": { hit: 0.3, miss: 9.0, out: 27.0 },
};

function priceTable() {
	const out = {};
	for (const [model, peak] of Object.entries(PEAK_PRICES)) {
		out[model] = {
			peak,
			offPeak: { hit: peak.hit / 2, miss: peak.miss / 2, out: peak.out / 2 },
		};
	}
	return out;
}

const PRICES = priceTable();

/**
 * TokenBom resells models for credits: ¥10 buys 5,000 credits, so one credit is
 * ¥0.002. Its API quotes input/output credits per million tokens with no
 * peak/off-peak split, so those models use one flat rate.
 */
const TOKENBOM = (() => {
	try {
		const file = new URL("../prices/tokenbom.json", import.meta.url);
		const raw = JSON.parse(readFileSync(file, "utf8"));
		const creditCny = typeof raw.creditCny === "number" ? raw.creditCny : 0.002;
		const table = {};
		for (const [model, price] of Object.entries(raw.models ?? {})) {
			const input = (price.inCredits ?? 0) * creditCny;
			const output = (price.outCredits ?? 0) * creditCny;
			table[model] = { flat: { hit: input, miss: input, out: output } };
		}
		return { creditCny, table };
	} catch {
		return { creditCny: 0.002, table: {} };
	}
})();

/* ------------------------------------------------------------------ */
/* paths + zstd                                                        */
/* ------------------------------------------------------------------ */

function homeDir() {
	const fromEnv = process.env.DSH_HOME;
	if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return path.resolve(fromEnv);
	return path.join(homedir(), ".dsh");
}

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

function decodeLog(buf, compressed) {
	if (!compressed) return buf.toString("utf8");
	const parts = [];
	for (const frame of frameRanges(buf)) {
		parts.push(zlib.zstdDecompressSync(buf.subarray(frame.start, frame.end)));
	}
	return Buffer.concat(parts).toString("utf8");
}

/* ------------------------------------------------------------------ */
/* time + pricing                                                      */
/* ------------------------------------------------------------------ */

/** Beijing wall-clock parts for one epoch millisecond. */
function beijingParts(ms) {
	const shifted = new Date(ms + BEIJING_OFFSET_MS);
	return {
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		weekday: shifted.getUTCDay(),
		minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
	};
}

function dateKey(ms) {
	const p = beijingParts(ms);
	return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function startOfBeijingDay(ms) {
	const p = beijingParts(ms);
	const utcMidnight = Date.UTC(p.year, p.month - 1, p.day);
	return utcMidnight - BEIJING_OFFSET_MS;
}

/** Peak billing: Beijing weekday 09:00–12:00 and 14:00–18:00. */
function isPeak(ms) {
	const p = beijingParts(ms);
	if (p.weekday === 0 || p.weekday === 6) return false;
	return (p.minutes >= 540 && p.minutes < 720) || (p.minutes >= 840 && p.minutes < 1080);
}

function priceFor(provider, model) {
	if (typeof model !== "string") return undefined;
	// TokenBom bills flat credits per model regardless of the clock.
	if (provider === "tokenbom") return TOKENBOM.table[model];
	// DeepSeek-billed providers (official API and the app-managed account channel)
	// share the official CNY price table; the 2026-10 export confirmed both are billed.
	return PRICES[model];
}

/** CNY cost of one billed request, or null when the model has no published price. */
function costOf(provider, model, usage, time) {
	const price = priceFor(provider, model);
	if (price === undefined) return null;
	const table = price.flat ?? (isPeak(time) ? price.peak : price.offPeak);
	const miss = ((usage.inputTokens ?? 0) + (usage.cacheWriteTokens ?? 0)) * table.miss / 1e6;
	const hit = (usage.cacheReadTokens ?? 0) * table.hit / 1e6;
	const out = (usage.outputTokens ?? 0) * table.out / 1e6;
	return miss + hit + out;
}

/* ------------------------------------------------------------------ */
/* log scanning                                                        */
/* ------------------------------------------------------------------ */

const fileCache = new Map();

function pickLogFile(entries) {
	let best;
	let bestVersion = -1;
	for (const entry of entries) {
		const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(entry);
		if (match === null) continue;
		const version = match[1] === undefined ? 0 : Number(match[1]);
		if (version > bestVersion) {
			bestVersion = version;
			best = entry;
		}
	}
	return best;
}

/** Decode one session log into billed points plus identity/title. */
async function readSessionFile(file) {
	const stat = await fsp.stat(file);
	const cached = fileCache.get(file);
	if (cached !== undefined && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs && Date.now() - cached.at < CACHE_TTL_MS) {
		return cached.value;
	}
	const buf = await fsp.readFile(file);
	const compressed = file.endsWith(".zstd");
	const text = decodeLog(buf, compressed);
	const points = [];
	let id;
	let cwd;
	let title;
	let model;
	let provider;
	let seeded = false;
	let createdAt;
	let inheritedSkipped = 0;
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
			id = event.id;
			cwd = event.cwd;
			seeded = event.isSeeded === true;
			if (typeof event.createdAt === "number") createdAt = event.createdAt;
			continue;
		}
		if (type === "session/title" && typeof event.data?.title === "string") {
			title = event.data.title;
			continue;
		}
		if (type === "model/selection" || type === "request/context") {
			if (typeof event.data?.model === "string") model = event.data.model;
			if (typeof event.data?.provider === "string") provider = event.data.provider;
			continue;
		}
		if (type === "request/header") {
			const config = event.data?.header?.config;
			if (typeof config?.model === "string") model = config.model;
			if (typeof config?.provider === "string") provider = config.provider;
			continue;
		}
		if (type !== "assistant/message") continue;
		const usage = event.data?.usage;
		if (usage === undefined || usage === null) continue;
		const time = typeof event.time === "number" ? event.time : undefined;
		if (time === undefined) continue;
		// A session log may carry events older than the session itself: seeded
		// (forked/subagent) sessions copy their parent's transcript, and duplicated
		// sessions clone another log. Those events were billed where they happened,
		// so only count work that happened after this session was created.
		if (createdAt !== undefined && time < createdAt) {
			inheritedSkipped += 1;
			continue;
		}
		const tokens = {
			input: usage.inputTokens ?? 0,
			output: usage.outputTokens ?? 0,
			cacheRead: usage.cacheReadTokens ?? 0,
			cacheWrite: usage.cacheWriteTokens ?? 0,
		};
		tokens.total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
		const cost = costOf(provider, model, usage, time);
		points.push({ time, provider: provider ?? null, model: model ?? null, tokens, cost, peak: isPeak(time) });
	}
	const value = { id, cwd, title, points };
	fileCache.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, at: Date.now(), value });
	return value;
}

async function listSessionFiles(home) {
	const root = path.join(home, "sessions");
	const files = [];
	let projectDirs;
	try {
		projectDirs = await fsp.readdir(root, { withFileTypes: true });
	} catch {
		return files;
	}
	for (const projectDir of projectDirs) {
		if (!projectDir.isDirectory()) continue;
		const projectPath = path.join(root, projectDir.name);
		let sessionDirs;
		try {
			sessionDirs = await fsp.readdir(projectPath, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const sessionDir of sessionDirs) {
			if (!sessionDir.isDirectory()) continue;
			const dirPath = path.join(projectPath, sessionDir.name);
			let entries;
			try {
				entries = await fsp.readdir(dirPath);
			} catch {
				continue;
			}
			const file = pickLogFile(entries);
			if (file !== undefined) files.push({ file: path.join(dirPath, file), dir: dirPath });
		}
	}
	return files;
}

async function loadWorkspaces(home) {
	const file = path.join(home, "storages", "workspace.json");
	const out = { byPath: new Map(), bySession: new Map() };
	try {
		const parsed = JSON.parse(await fsp.readFile(file, "utf8"));
		const table = parsed?.tables?.workspaces ?? {};
		for (const record of Object.values(table)) {
			if (record === null || typeof record !== "object") continue;
			if (typeof record.path === "string") out.byPath.set(path.resolve(record.path).toLowerCase(), record.title ?? record.path);
			for (const id of Array.isArray(record.sessionIds) ? record.sessionIds : []) {
				out.bySession.set(id, record.title ?? record.path ?? "");
			}
		}
	} catch {
		// workspace metadata is optional; sessions still aggregate without it
	}
	return out;
}

function emptyTokens() {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addTokens(target, tokens) {
	target.input += tokens.input;
	target.output += tokens.output;
	target.cacheRead += tokens.cacheRead;
	target.cacheWrite += tokens.cacheWrite;
	target.total += tokens.total;
}

/** Build the whole summary for the requested window. */
async function buildSummary(home, days) {
	const started = Date.now();
	const windowDays = Math.max(1, Math.min(Number.isFinite(days) ? Math.trunc(days) : 7, 31));
	const todayStart = startOfBeijingDay(Date.now());
	const start = todayStart - (windowDays - 1) * 24 * 60 * 60 * 1000;
	const dates = [];
	for (let index = 0; index < windowDays; index += 1) dates.push(dateKey(start + index * 24 * 60 * 60 * 1000));
	const dayBuckets = new Map(dates.map((date) => [date, {
		date,
		cost: 0,
		tokens: emptyTokens(),
		peakCost: 0,
		offPeakCost: 0,
		byModel: {},
		priced: true,
	}]));
	const sessionRows = [];
	const pricedFor = new Set();
	const unpricedModels = new Set();
	const workspaces = await loadWorkspaces(home);
	const files = await listSessionFiles(home);
	let skipped = 0;
	let partial = false;

	for (const entry of files) {
		if (Date.now() - started > MAX_WORK_MS) {
			partial = true;
			break;
		}
		let session;
		try {
			session = await readSessionFile(entry.file);
		} catch {
			skipped += 1;
			continue;
		}
		const points = session.points.filter((point) => point.time >= start);
		if (points.length === 0) continue;
		const id = session.id ?? path.basename(entry.dir);
		const title = session.title ?? id.slice(0, 8);
		const workspace = session.cwd === undefined
			? ""
			: workspaces.byPath.get(path.resolve(session.cwd).toLowerCase()) ?? workspaces.bySession.get(id) ?? "";
		const row = {
			id,
			title,
			workspace,
			cwd: session.cwd ?? "",
			lastTime: 0,
			cost: 0,
			tokens: emptyTokens(),
			models: [],
		};
		const modelRows = new Map();
		for (const point of points) {
			row.lastTime = Math.max(row.lastTime, point.time);
			addTokens(row.tokens, point.tokens);
			if (point.cost === null) {
				if (point.model !== null) unpricedModels.add(point.model);
			} else {
				row.cost += point.cost;
				if (point.model !== null) pricedFor.add(point.model);
			}
			const bucket = dayBuckets.get(dateKey(point.time));
			if (bucket === undefined) continue;
			addTokens(bucket.tokens, point.tokens);
			if (point.cost === null) {
				bucket.priced = false;
			} else {
				bucket.cost += point.cost;
				if (point.peak) bucket.peakCost += point.cost;
				else bucket.offPeakCost += point.cost;
			}
			const modelKey = point.model ?? "unknown";
			const aggregate = bucket.byModel[modelKey] ?? (bucket.byModel[modelKey] = { cost: 0, tokens: emptyTokens(), priced: point.cost !== null });
			addTokens(aggregate.tokens, point.tokens);
			if (point.cost !== null) aggregate.cost += point.cost;
			else aggregate.priced = false;
			const modelRow = modelRows.get(modelKey) ?? (() => {
				const created = { model: modelKey, cost: 0, tokens: emptyTokens(), priced: point.cost !== null };
				modelRows.set(modelKey, created);
				return created;
			})();
			addTokens(modelRow.tokens, point.tokens);
			if (point.cost !== null) modelRow.cost += point.cost;
			else modelRow.priced = false;
		}
		row.models = [...modelRows.values()].sort((a, b) => b.cost - a.cost);
		sessionRows.push(row);
	}

	sessionRows.sort((a, b) => b.cost - a.cost || b.lastTime - a.lastTime);
	const totals = { cost: 0, tokens: emptyTokens(), pricedFor: [...pricedFor].sort(), unpricedModels: [...unpricedModels].sort() };
	for (const row of sessionRows) {
		totals.cost += row.cost;
		addTokens(totals.tokens, row.tokens);
	}
	const dayList = dates.map((date) => {
		const bucket = dayBuckets.get(date);
		return {
			date,
			cost: bucket.cost,
			priced: bucket.priced,
			tokens: bucket.tokens,
			peakCost: bucket.peakCost,
			offPeakCost: bucket.offPeakCost,
			byModel: bucket.byModel,
		};
	});
	return {
		ok: true,
		generatedAt: Date.now(),
		partial,
		skipped,
		days: dayList,
		totals,
		sessions: sessionRows.slice(0, MAX_SESSIONS),
		prices: PRICES,
		tokenbom: {
			creditCny: TOKENBOM.creditCny,
			models: Object.keys(TOKENBOM.table).length,
		},
	};
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
	const origin = request.headers.origin;
	const host = request.headers.host;
	if (!origin || !host) return false;
	try {
		const url = new URL(origin);
		// The Desktop shell serves the Web UI from its own dsh-app:// scheme and
		// forwards these requests to the loopback Host; a browser page can never
		// forge that Origin, so treat it as the trusted application origin.
		if (url.protocol === "dsh-app:") return true;
		return url.host === host;
	} catch {
		return false;
	}
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
						if (request.method !== "GET") {
							sendJson(response, 405, { ok: false, error: "只支持 GET" });
							return;
						}
						if (url.pathname === `${PREFIX}/api/summary`) {
							const days = Number(url.searchParams.get("days") ?? "7");
							try {
								const summary = await buildSummary(homeDir(), days);
								sendJson(response, 200, summary);
							} catch (error) {
								sendJson(response, 500, { ok: false, error: String(error?.message ?? error) });
							}
							return;
						}
						sendJson(response, 404, { ok: false, error: "未知接口" });
					},
				}),
			"usage-panel: routes",
		);
	});
}
