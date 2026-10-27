import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = "E:\\code\\DHS_Plus";
const plugins = [
  {
    dir: "dsh-codex-import",
    kw: ["import", "codex", "claude-code", "session", "migration"],
    readme: `# dsh-codex-import

Unified **导入** page for DeepSeek Harness (DSH): bring your Codex App and Claude Code session history into DSH.

- **Handoff mode (default)** — each imported session becomes a compact handoff: 项目与目标 / 最近工作 / 变更与命令 / 未完成·下一步 (recent turns, ~12k char budget). Low token cost, opens instantly.
- **Full transcript mode** — replays the original conversation turn-by-turn, assistant messages synthesized with the exact settlement/stream structure DSH requires.
- **Same-project merge** — sessions whose original cwd maps to an existing DSH workspace are added to that workspace instead of creating duplicates.
- Sub-agent rollouts are filtered out; only real user threads are imported.
- Rollback with full backups (ledger at \`~/.dsh/storages/codex-import-ledger.json\`).

在 DSH 设置里新增「导入」页：把 Codex App 与 Claude Code 的会话历史迁入 DSH。默认 handoff 模式（总结+最近若干轮，省 token），可选完整转录模式；原项目路径与现有工作区相同时间会话自动归并；自动过滤子代理记录；支持一键回滚（含备份）。

## Install

\`\`\`bash
dsh plugin --profile desktop add dsh-codex-import
\`\`\`
`,
  },
  {
    dir: "dsh-project-panel",
    kw: ["project", "status", "dashboard", "git"],
    readme: `# dsh-project-panel

A **项目进度** settings page for DSH: one glance at every project on your disk.

- Scans configured roots (e.g. \`E:\\code\`) and classifies each project: active / slowing / idle, via \`status.json\` anchors first, then git activity and evidence-file heuristics.
- Stats cards, filters and project cards; write an anchor back with one click.
- Self-contained dark HTML export (single file, opens anywhere).

在 DSH 设置里的项目进度面板：扫描配置的代码根目录，按 status.json 锚点优先 + git/证据推断给出 活跃/放缓/闲置 分类，支持一键写回锚点、导出自包含深色 HTML 报告。

## Install

\`\`\`bash
dsh plugin --profile desktop add dsh-project-panel
\`\`\`
`,
  },
  {
    dir: "dsh-code-wiki",
    kw: ["wiki", "documentation", "code", "readme"],
    readme: `# dsh-code-wiki

A **项目 Wiki** settings page for DSH: a structured, cached wiki for every project in your configured roots.

- Per-project digest: README summary, docs tree, tech stack, language mix, git activity.
- Build once, browse instantly (cache under \`~/.dsh/storages/code-wiki/\`); Markdown export to Downloads.

在 DSH 设置里为配置根目录下的每个项目生成结构化 Wiki：README 摘要、docs 目录树、技术栈、语言构成与 git 活跃度；一次构建、缓存秒开，支持导出 Markdown。

## Install

\`\`\`bash
dsh plugin --profile desktop add dsh-code-wiki
\`\`\`
`,
  },
  {
    dir: "dsh-agent-checkup",
    kw: ["agent", "quality", "audit", "diagnostics"],
    readme: `# dsh-agent-checkup

An **Agent 体检** settings page for DSH (AHM Evidence-lite): read-only health probes over your local DSH session logs.

- Four probes: repetitive loops (bigram similarity), error visibility, tool failure rate, context bloat (head/tail growth).
- Findings are **candidate-level** (heuristics with disclaimers), grouped by type with suggestions; self-contained dark HTML report export.

DSH 设置里的 Agent 体检页：对本地会话日志做四项只读探针（重复循环/错误可见性/工具失败率/上下文膨胀），结果为候选级判断（带免责声明），按类型聚合给出建议，可导出自包含深色 HTML 报告。

## Install

\`\`\`bash
dsh plugin --profile desktop add dsh-agent-checkup
\`\`\`
`,
  },
];

for (const p of plugins) {
  const dir = join(root, p.dir);
  const pkgPath = join(dir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  delete pkg.private;
  pkg.license = "MIT";
  pkg.author = { name: "kialajin" };
  pkg.keywords = ["deepseek-harness", "dsh", "dsh-plugin", ...p.kw];
  pkg.files = ["lib", "client", "cordis.patch.yml", "README.md", "LICENSE"];
  pkg.engines = pkg.engines || {};
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, "README.md"), p.readme, "utf8");
  writeFileSync(
    join(dir, "LICENSE"),
    `MIT License\n\nCopyright (c) 2026 kialajin\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.\n`,
    "utf8",
  );
  console.log(`${p.dir}: metadata + README + LICENSE done (v${pkg.version})`);
}
