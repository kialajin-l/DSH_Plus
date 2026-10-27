#!/usr/bin/env node
/**
 * rescue-session.mjs — 为超过请求体上限的卡死会话生成「续接」新会话。
 *
 * 用法（必须用 DSH runtime node ≥24，系统 node 20 没有 zlib.zstd）：
 *   & "H:\k\AI_TOOL\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" `
 *     E:\code\DHS_Plus\scripts\rescue-session.mjs <卡死会话目录或 session.v4.jsonl.zstd 路径>
 *
 * 行为：
 *   1. 解码原会话日志（多帧 zstd），提取标题/首条消息/最近 N 轮对话；
 *   2. 生成 handoff 交接书（单条 user 消息，~12k 预算）；
 *   3. 以 codex-import 同款 v4 事件格式（header 单独一帧 + 正文一帧，带校验和）
 *      写入同一 projectKey 下的新会话目录；
 *   4. 备份并更新 workspace.json，把新会话挂到原工作区；
 *   5. 重启 DeepSeek Harness 后侧栏可见。
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";

const HOME = path.join(process.env.USERPROFILE, ".dsh");
const WORKSPACE_JSON = path.join(HOME, "storages", "workspace.json");
const TURN_BUDGET = 8;          // 带入交接书的最近轮数
const CHAR_BUDGET = 12000;      // 交接书总字符预算
const PER_MSG_CAP = 1500;       // 单条消息截断

/* ---------- zstd 多帧解码（与 codex-import 同款） ---------- */
function zstdFrames(buf) {
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0xFD2FB528) return [[0, buf.length]];
  const out = [];
  let p = 0;
  while (p + 6 < buf.length) {
    const start = p;
    p += 4; // magic 28 B5 2F FD
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

function decodeAll(buf) {
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

/* ---------- projectKey / encodeSegment（与宿主同款） ---------- */
function projectKey(cwd) {
  let key = "";
  for (const ch of cwd) {
    if (/[A-Za-z0-9._-]/.test(ch)) key += ch;
    else if (/[\\/ :]/.test(ch)) key += (key.endsWith("-") ? "" : "-");
    else key += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
  }
  key = key.replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (key.length > 245) key = key.slice(0, 245);
  return `--${key}--`;
}

function encodeSegment(raw) {
  let out = "";
  for (const ch of raw) {
    if (/[A-Za-z0-9_-]/.test(ch)) out += ch;
    else out += `~${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return out;
}

/* ---------- 提取对话 ---------- */
function msgText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function extract(buf) {
  const text = decodeAll(buf);
  const lines = text.split("\n").filter((line) => line.length > 0);
  let header = null;
  const titleEvents = [];
  const turns = new Map(); // turnNo -> { user, assistant }
  for (const line of lines) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!header && event.type === "session") header = event;
    if (event.type === "session/title") titleEvents.push(event);
    if (event.type === "user/message") {
      const no = typeof event.data?.turn === "number" ? event.data.turn : turns.size + 1;
      const slot = turns.get(no) ?? { user: "", assistant: "" };
      if (!slot.user) slot.user = msgText(event.data?.content);
      turns.set(no, slot);
    }
    if (event.type === "assistant/message") {
      const no = typeof event.data?.turn === "number" ? event.data.turn : turns.size;
      const slot = turns.get(no) ?? { user: "", assistant: "" };
      if (!slot.assistant) slot.assistant = msgText(event.data?.message?.content);
      turns.set(no, slot);
    }
  }
  const turnList = [...turns.entries()]
    .filter(([, slot]) => slot.user || slot.assistant)
    .sort((a, b) => a[0] - b[0]);
  return { header, title: titleEvents[0]?.data?.title ?? "", turnList };
}

function cap(text, max = PER_MSG_CAP) {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…（截断，原文 ${t.length} 字）`;
}

function buildHandoff({ title, firstUser, turnList }) {
  const recent = turnList.slice(-TURN_BUDGET);
  const parts = [];
  parts.push(`> 本会话由救援脚本自动生成：原会话超过请求体上限无法继续，这里承接其上下文。原会话保留未动，可随时回看。\n`);
  parts.push(`## 项目与目标\n\n- 工作区：${title || "（原会话未命名）"}\n- 最初请求：\n\n${cap(firstUser, 1200)}\n`);
  parts.push(`## 最近 ${recent.length} 轮对话（倒序，越上越新）\n`);
  for (const [no, slot] of [...recent].reverse()) {
    parts.push(`### 第 ${no} 轮\n`);
    if (slot.user) parts.push(`**用户**：${cap(slot.user, 1000)}\n`);
    if (slot.assistant) parts.push(`**助手**：${cap(slot.assistant, 1200)}\n`);
  }
  const last = recent[recent.length - 1]?.[1];
  if (last?.assistant) {
    parts.push(`## 未完成 · 下一步\n\n- 以上为原会话最后的进展；原会话最后一条助手回复见「最近对话」末轮，请从中判断未完成事项并继续。\n`);
  }
  let body = parts.join("\n");
  if (body.length > CHAR_BUDGET) body = `${body.slice(0, CHAR_BUDGET)}\n…（交接书超预算已截断）\n`;
  return body;
}

/* ---------- v4 事件组装（user-only handoff，与 codex-import 同款） ---------- */
function buildSessionText({ id, cwd, createdAt, title, handoff }) {
  const events = [];
  let seq = 0;
  const now = Date.now();
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
  push("turn/start", { turn: 1 }, now);
  push("step/start", { turn: 1, step: 1 }, now);
  const userSeq = seq;
  push(
    "user/message",
    {
      content: [{ type: "text", text: handoff }],
      source: { kind: "user", rpcId: randomUUID(), clientTimeZone: "Asia/Shanghai" },
      role: "user",
      id: randomUUID(),
    },
    now,
    "append",
  );
  push("session/title", { title, messageSeqs: [userSeq], source: { kind: "fallback" } }, now);
  push("step/end", { turn: 1, step: 1 }, now + 1);
  push("turn/end", { turn: 1, reason: { kind: "completed" } }, now + 2);
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

/* ---------- 主流程 ---------- */
async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("用法: rescue-session.mjs <卡死会话目录或 session.v4.jsonl.zstd 路径>");
  const stat = await fsp.stat(input);
  const sessionDir = stat.isDirectory() ? input : path.dirname(input);
  const logFile = stat.isDirectory() ? path.join(sessionDir, "session.v4.jsonl.zstd") : input;
  const buf = await fsp.readFile(logFile);
  const { header, title, turnList } = extract(buf);
  if (!header?.cwd) throw new Error("无法从日志头解析 cwd");
  const firstUser = turnList[0]?.[1]?.user ?? "";
  const origTitle = title || (firstUser ? firstUser.slice(0, 24) : "未命名会话");

  const handoff = buildHandoff({ title: origTitle, firstUser, turnList });
  const newId = `session-${randomUUID()}`;
  const nowIso = new Date().toISOString();
  const newTitle = `续接 · ${origTitle.slice(0, 30)}`;
  const eventText = buildSessionText({ id: newId, cwd: header.cwd, createdAt: header.createdAt, title: newTitle, handoff });

  const targetDir = path.join(HOME, "sessions", projectKey(header.cwd), encodeSegment(newId));
  await fsp.mkdir(targetDir, { recursive: true });
  await fsp.writeFile(path.join(targetDir, "session.v4.jsonl.zstd"), zstdOneFrame(eventText));

  // 挂到 workspace.json（先备份）
  const raw = await fsp.readFile(WORKSPACE_JSON, "utf8");
  await fsp.writeFile(`${WORKSPACE_JSON}.bak-rescue-${Date.now()}`, raw);
  const reg = JSON.parse(raw);
  let attached = false;
  for (const ws of Object.values(reg.tables?.workspaces ?? {})) {
    const wsPath = (ws.path ?? "").toLowerCase();
    if (path.resolve(wsPath).toLowerCase() === path.resolve(header.cwd).toLowerCase()) {
      if (!ws.sessionIds.includes(newId)) ws.sessionIds.push(newId);
      ws.updatedAt = nowIso;
      attached = true;
      break;
    }
  }
  if (!attached) throw new Error(`workspace.json 中未找到 cwd=${header.cwd} 的工作区；会话文件已写入但未挂载`);
  await fsp.writeFile(WORKSPACE_JSON, `${JSON.stringify(reg, null, 2)}\n`);

  console.log(`原会话 : ${sessionDir}`);
  console.log(`原标题 : ${origTitle || "(无)"}  轮数: ${turnList.length}`);
  console.log(`新会话 : ${newId}`);
  console.log(`标题   : ${newTitle}`);
  console.log(`目录   : ${targetDir}`);
  console.log(`交接书 : ${handoff.length} 字符（${TURN_BUDGET} 轮预算）`);
  console.log(`已挂载 : 是（重启 DeepSeek Harness 后侧栏可见）`);
}

main().catch((error) => {
  console.error("RESCUE FAILED:", error.message);
  process.exit(1);
});
