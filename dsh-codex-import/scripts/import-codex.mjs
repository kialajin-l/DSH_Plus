#!/usr/bin/env node
/**
 * Import agent-app sessions from the command line.
 *
 * Usage:
 *   node scripts/import-codex.mjs --source codex --project "E:\code\opc-doc" --limit 1 --dry-run
 *   node scripts/import-codex.mjs --source claude --project "E:\code\全模型测试" --mode handoff
 *   node scripts/import-codex.mjs --source codex --mode full --limit 3
 *
 * Real imports go through the running DSH host so the workspace registry stays
 * authoritative; --dry-run only scans and prints the planned handoff.
 */
import { planImport, scanSource } from "../lib/index.js";

function parseArgs(argv) {
	const out = { source: "codex", mode: "handoff", limit: 0, dryRun: false, force: false, port: 0, project: "" };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--dry-run") out.dryRun = true;
		else if (arg === "--force") out.force = true;
		else if (arg === "--source") out.source = argv[++i] === "claude" ? "claude" : "codex";
		else if (arg === "--project") out.project = argv[++i] ?? "";
		else if (arg === "--mode") out.mode = argv[++i] === "full" ? "full" : "handoff";
		else if (arg === "--limit") out.limit = Number(argv[++i] ?? 0) || 0;
		else if (arg === "--port") out.port = Number(argv[++i] ?? 0) || 0;
		else if (arg === "--help" || arg === "-h") out.help = true;
		else throw new Error(`unknown argument: ${arg}`);
	}
	return out;
}

async function resolvePort(explicit) {
	if (explicit > 0) return explicit;
	for (const port of [54078, 50386, 52081, 54752]) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/codex-import/api/sources`, { signal: AbortSignal.timeout(800) });
			if (response.ok) return port;
		} catch {
			/* try next */
		}
	}
	throw new Error("找不到运行中的 DSH host，请用 --port 指定");
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	console.log(`用法:
  node scripts/import-codex.mjs --source codex|claude --project <cwd> [--mode handoff|full] [--limit N] [--dry-run] [--force] [--port N]

选项:
  --source   codex（默认）或 claude
  --project  按原始 cwd 过滤（精确匹配或子串）
  --mode     handoff（默认，摘要+最近工作）或 full（完整转录）
  --limit    最多处理多少个会话（0 = 全部匹配）
  --dry-run  只扫描并打印交接书，不写任何文件
  --force    允许重复导入已导入过的会话
  --port     DSH host 端口（默认自动探测）`);
	process.exit(0);
}

let scan;
let port;
try {
	port = await resolvePort(args.port);
	const response = await fetch(`http://127.0.0.1:${port}/codex-import/api/scan?source=${args.source}`);
	if (!response.ok) throw new Error(`scan HTTP ${response.status}`);
	scan = await response.json();
} catch {
	// Host unavailable: local scan still lists projects, just without workspace matches.
	scan = await scanSource(undefined, args.source);
}

const projects = scan.projects.filter(
	(project) => args.project.length === 0 || project.cwd === args.project || project.cwd.includes(args.project),
);
if (projects.length === 0) {
	console.error(`没有匹配的项目：${args.project || "(全部)"}`);
	process.exit(1);
}

let planned = 0;
for (const project of projects) {
	const sessions = args.limit > 0 ? project.sessions.slice(0, args.limit) : project.sessions;
	if (sessions.length === 0) continue;
	const match = project.matchedWorkspace === null || project.matchedWorkspace === undefined
		? "新建工作区"
		: `并入现有工作区「${project.matchedWorkspace.title}」`;
	console.log(`\n== ${project.title} (${project.cwd}) · ${sessions.length}/${project.count} 个会话 · ${args.mode} · ${match}`);
	if (args.dryRun) {
		for (const session of sessions) {
			const plan = await planImport(args.source, session.sourcePath, { mode: args.mode, force: true });
			if (!plan.ok) {
				console.log(`  × ${session.sourcePath}: ${plan.reason}`);
				continue;
			}
			console.log(`  ✓ ${session.title} · ${plan.turns} 轮 · ${plan.sizeLabel}${plan.huge ? " · 超大" : ""}`);
			const handoff = plan.eventText
				.split("\n")
				.map((line) => {
					try {
						const event = JSON.parse(line);
						return event.type === "user/message" ? event.data.content[0].text : "";
					} catch {
						return "";
					}
				})
				.find((text) => text.length > 0);
			if (typeof handoff === "string" && handoff.length > 0) {
				console.log("  ---- 交接书（前 1200 字）----");
				console.log(handoff.slice(0, 1200).split("\n").map((line) => `  ${line}`).join("\n"));
			}
			planned += 1;
		}
		continue;
	}
	const body = {
		source: args.source,
		sourcePaths: sessions.map((session) => session.sourcePath),
		mode: args.mode,
		force: args.force,
	};
	const response = await fetch(`http://127.0.0.1:${port}/codex-import/api/import`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: "dsh-app://app" },
		body: JSON.stringify(body),
	});
	const data = await response.json();
	if (!response.ok || data.ok !== true) {
		console.error(`  导入请求失败：${data.error ?? response.status}`);
		process.exitCode = 1;
		continue;
	}
	for (const row of data.results ?? []) {
		if (row.ok === true) {
			console.log(`  ✓ ${row.sourcePath} → ${row.sessionId} · ${row.workspace?.title ?? row.workspaceId ?? ""}${row.workspace?.created ? "（新建）" : "（并入）"}`);
			planned += 1;
		} else {
			console.log(`  × ${row.sourcePath}: ${row.reason}`);
		}
	}
}
console.log(`\n${args.dryRun ? "计划" : "导入"}完成：${planned} 个会话。`);
