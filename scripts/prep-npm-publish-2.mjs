// Prep batch 2: remaining 7 publishable plugins (designseed skipped: hardcoded engine dir).
// License: PolyForm Noncommercial (copied from already-published dsh-codex-import).
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = "E:\\code\\DHS_Plus";
const licSource = join(root, "dsh-codex-import", "LICENSE");
if (!existsSync(licSource)) throw new Error("PolyForm LICENSE source missing: " + licSource);
const LICENSE = readFileSync(licSource, "utf8");

const plugins = [
  {
    dir: "dsh-balance-badge",
    name: "@kialajin/dsh-balance-badge",
    kw: ["balance", "usage", "pricing", "badge"],
    files: ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-balance-badge

A **balance badge** for the DSH title bar: account balance, today's cost, session tokens, and peak/off-peak pricing awareness at a glance.

- Balance popover: top-up / bonus / today cost / current-session tokens.
- Peak vs off-peak aware (Beijing-time weekday windows) for official DeepSeek pricing; flat pricing for custom providers like TokenBom.
- Click to refresh; no configuration needed.

在 DSH 标题栏显示账户余额徽章：余额弹窗含 充值/赠金/今日花费/本会话 tokens；官方 DeepSeek 按峰谷时段计价展示，自定义服务商（如 TokenBom）按平价展示；点击即刷新，零配置。

## Install

\`\`\`bash
dsh plugin --profile desktop add @kialajin/dsh-balance-badge
\`\`\`
`,
  },
  {
    dir: "dsh-usage-panel",
    name: "@kialajin/dsh-usage-panel",
    kw: ["usage", "cost", "pricing", "statistics", "tokens"],
    files: ["lib", "client", "prices", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-usage-panel

A **usage statistics** settings page for DSH: token and cost accounting across all configured providers.

- Daily bar list (last 30 days), per-model table, per-session table — all computed locally from session logs.
- Provider-aware pricing: official DeepSeek peak/off-peak windows (Beijing time), flat-rate custom providers (TokenBom price table bundled).
- Skips inherited events of forked/subagent sessions so costs are never double-counted.
- Compatible with the \`dsh-balance-badge\` pricing data.

在 DSH 设置里的用量统计面板：全部基于本地会话日志计算（近 30 天条形图 / 模型表 / 会话表），按服务商感知计价（官方峰谷、TokenBom 平价表内置），并跳过子代理会话继承的历史事件避免重复计费。

## Install

\`\`\`bash
dsh plugin --profile desktop add @kialajin/dsh-usage-panel
\`\`\`
`,
  },
  {
    dir: "dsh-session-move",
    name: "@kialajin/dsh-session-move",
    kw: ["session", "move", "workspace", "organize"],
    files: ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-session-move

Move DSH sessions between workspaces safely, with full backups.

- Validates live/subagent/offline sessions before touching anything.
- Every move is backed up under \`~/.dsh/session-move-backups/<timestamp>/\`.
- Right-click menu integration in the sidebar (via dsh-session-tools) or standalone settings page.

在 DSH 工作区之间安全移动会话：移动前校验（运行中/子代理/离线状态），每次移动自动备份到 ~/.dsh/session-move-backups/，可与 dsh-session-tools 的右键菜单联动。

## Install

\`\`\`bash
dsh plugin --profile desktop add @kialajin/dsh-session-move
\`\`\`
`,
  },
  {
    dir: "dsh-nexus-memory",
    kw: ["memory", "long-term", "nexus", "sqlite"],
    files: ["lib", "client", "py", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-nexus-memory

Long-term memory for DSH backed by a local SQLite (Nexus) store.

- Auto-injects project-scoped relevant memories into new conversations (junk-filtered, score-gated, no global fallback noise).
- Title-bar 记忆 button: extract memories from the recent 10 turns — lightweight rule mode (default, zero tokens) or model extraction with your choice of provider/model; review, edit and save candidates.
- Write-side dedup (normalized bigram Jaccard) and feedback-weighted ranking (accept/correct adjusts future scores).
- Databases live under \`~/.dsh/storages/nexus-memory/\` by default; missing DBs degrade silently.
- Requires Python 3.8+ on PATH (the included \`py/bridge.py\` does the SQLite work).

基于本地 SQLite 的 DSH 长期记忆：新会话自动注入项目相关记忆（噪声过滤、阈值门控）；标题栏「记忆」按钮从最近 10 轮提取记忆（默认轻量规则零 token，可选模型提取并自选 provider/model）；写入去重 + 反馈加权排序；库文件默认在 ~/.dsh/storages/nexus-memory/，缺失时静默降级。需要 PATH 中有 Python 3.8+。

## Install

\`\`\`bash
dsh plugin --profile desktop add dsh-nexus-memory
\`\`\`
`,
  },
  {
    dir: "dsh-quote-selection",
    name: "@kialajin/dsh-quote-selection",
    kw: ["quote", "selection", "composer", "input"],
    files: ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-quote-selection

Select any text in a DSH conversation and act on it immediately.

- Floating toolbar on text selection: 添加到对话 / 新开讨论 / 复制.
- Quotes collapse into a compact quote card aligned to the composer; double-click jumps back to the quoted turn.
- Sending auto-expands the quote into the message, even if you never clicked the card.

在 DSH 会话里选中任意文字即弹出工具条：添加到对话 / 新开讨论 / 复制；引用折叠为输入框上方的引用卡片，双击跳回被引用轮次；发送时即使未点开卡片也会自动展开引用并入消息。

## Install

\`\`\`bash
dsh plugin --profile desktop add @kialajin/dsh-quote-selection
\`\`\`
`,
  },
  {
    dir: "dsh-session-tools",
    name: "@kialajin/dsh-session-tools",
    kw: ["session", "export", "markdown", "timeline", "zip"],
    files: ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-session-tools

Session utilities for DSH: export, timeline, duplication and a sidebar right-click menu.

- Export any session as Markdown (single file) or ZIP batch (custom store-only ZIP writer, no dependencies).
- Timeline overlay for jumping between turns; read-only diagnosis endpoint for session log health.
- Safe session duplication (rewrites internal identity fields so DSH accepts the copy).
- Adds sidebar session right-click menu items (used by dsh-session-move).

DSH 会话工具箱：导出 Markdown / 批量 ZIP（零依赖自研 ZIP 写入器）、时间线浮层快速跳轮、安全复制会话（自动重写内部身份字段）、侧栏会话右键菜单扩展。

## Install

\`\`\`bash
dsh plugin --profile desktop add @kialajin/dsh-session-tools
\`\`\`
`,
  },
  {
    dir: "dsh-model-picker",
    name: "@kialajin/dsh-model-picker",
    kw: ["model", "selector", "reasoning", "input"],
    files: ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"],
    readme: `# dsh-model-picker

A Codex-style model selector for the DSH composer, with 4 reasoning-effort levels.

- Replaces the native model display in the input dock with a dropdown listing every provider/model configured in your profile.
- Per-model reasoning effort presets; selection persists per session.
- Disabling of the native selector ships inside the package (\`cordis.patch.yml\`) — no manual profile edits needed.

把 DSH 输入框的模型显示替换为 Codex 风格下拉选择器：列出 profile 里全部 provider/model，支持 4 档推理力度，选择按会话记忆；对原生选择器的禁用补丁随包内置（cordis.patch.yml），无需手工改 profile。

## Install

\`\`\`bash
dsh plugin --profile desktop add @kialajin/dsh-model-picker
\`\`\`
`,
  },
];

for (const p of plugins) {
  const dir = join(root, p.dir);
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  delete pkg.private;
  if (p.name) pkg.name = p.name;
  pkg.license = "PolyForm-Noncommercial-1.0.0";
  pkg.author = { name: "kialajin" };
  pkg.keywords = ["deepseek-harness", "dsh", "dsh-plugin", ...p.kw];
  pkg.files = p.files;
  pkg.repository = { type: "git", url: "git+https://github.com/kialajin-l/DSH_Plus.git", directory: p.dir };
  pkg.homepage = `https://github.com/kialajin-l/DSH_Plus/tree/main/${p.dir}#readme`;
  pkg.bugs = { url: "https://github.com/kialajin-l/DSH_Plus/issues" };
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, "README.md"), p.readme, "utf8");
  writeFileSync(join(dir, "LICENSE"), LICENSE, "utf8");
  console.log(`${p.dir}: v${pkg.version} prepped (license PolyForm, files=[${p.files.join(",")}])`);
}

