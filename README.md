# DHS_Plus — DeepSeek Harness 插件合集

个人维护的 DSH 插件源码集中地，从这里开发、调试、打包。

## 已上架 npm（点击即装）

| 插件 | npm | 功能 |
|---|---|---|
| **dsh-codex-import** | [![npm](https://img.shields.io/npm/v/dsh-codex-import)](https://www.npmjs.com/package/dsh-codex-import) | Codex App + Claude Code 会话一键导入 DSH：同路径自动归并工作区、摘要 handoff / 全量转录、历史回滚 |
| **dsh-project-panel** | [![npm](https://img.shields.io/npm/v/dsh-project-panel)](https://www.npmjs.com/package/dsh-project-panel) | 项目进度面板：活跃度推断、锚点标记、自包含深色 HTML 导出 |
| **dsh-agent-checkup** | [![npm](https://img.shields.io/npm/v/dsh-agent-checkup)](https://www.npmjs.com/package/dsh-agent-checkup) | Agent 体检（AHM Evidence-lite）：重复性/错误可见性/工具失败率/上下文膨胀四探针，HTML 报告 |
| **dsh-code-wiki** | [![npm](https://img.shields.io/npm/v/dsh-code-wiki)](https://www.npmjs.com/package/dsh-code-wiki) | 仓库 Wiki：README 摘要、docs 树、技术栈、git 活跃度、语言构成，MD 导出 |
| **dsh-balance-badge** | [![npm](https://img.shields.io/npm/v/dsh-balance-badge)](https://www.npmjs.com/package/dsh-balance-badge) | 标题栏余额徽章：余额/今日花费/本会话 tokens，峰谷计价感知 |
| **dsh-usage-panel** | [![npm](https://img.shields.io/npm/v/dsh-usage-panel)](https://www.npmjs.com/package/dsh-usage-panel) | 用量统计：近 30 天/模型/会话三视角，服务商感知计价，防子代理重复计费 |
| **dsh-session-tools** | [![npm](https://img.shields.io/npm/v/dsh-session-tools)](https://www.npmjs.com/package/dsh-session-tools) | 会话工具箱：Markdown/ZIP 导出、时间线跳轮、安全复制、右键菜单 |
| **dsh-session-move** | [![npm](https://img.shields.io/npm/v/dsh-session-move)](https://www.npmjs.com/package/dsh-session-move) | 跨工作区安全移动会话，每次移动自动备份 |
| **dsh-nexus-memory** | [![npm](https://img.shields.io/npm/v/dsh-nexus-memory)](https://www.npmjs.com/package/dsh-nexus-memory) | 长期记忆：自动注入项目相关记忆、规则/模型提取、去重与反馈排序（需 Python） |
| **dsh-quote-selection** | [![npm](https://img.shields.io/npm/v/dsh-quote-selection)](https://www.npmjs.com/package/dsh-quote-selection) | 选中即引用：工具条添加到对话/新开讨论，引用卡片双击跳轮 |
| **dsh-model-picker** | [![npm](https://img.shields.io/npm/v/dsh-model-picker)](https://www.npmjs.com/package/dsh-model-picker) | Codex 风格模型选择器 + 4 档推理力度，补丁随包内置 |

```powershell
npm install --prefix "$env:USERPROFILE\.dsh\profiles\desktop" --legacy-peer-deps dsh-codex-import dsh-project-panel dsh-code-wiki dsh-agent-checkup dsh-balance-badge dsh-usage-panel dsh-session-tools dsh-session-move dsh-nexus-memory dsh-quote-selection dsh-model-picker
```

## 全部插件

| 目录 | 作用 |
|---|---|
| `dsh-balance-badge` | 会话标题栏的 DeepSeek 余额徽章：充值/赠金余额、峰谷时段与折扣、本会话 tokens、今日花费 |
| `dsh-usage-panel` | 设置页「用量与花费」：每日/会话/模型级 tokens 与人民币花费，官方峰谷价 + TokenBom 积分价 |
| `dsh-session-move` | 设置页「会话整理」：把历史会话从一个工作区移动到另一个（改日志头 cwd + 搬目录 + 改归属，带备份回滚） |
| `dsh-nexus-memory` | 设置页「长期记忆」：接入本地 Nexus 记忆库（默认 primary / code 双库）；数据库路径可配置、可检测、可一键创建空库（配置在 `<DSH home>/storages/nexus-memory.json`）；搜索、反馈、项目记忆自动注入；会话标题栏「记忆」面板支持规则/模型两种提取，候选确认后写入记忆库 |
| `dsh-quote-selection` | 选中对话文字 → 浮动工具条（添加为折叠引用卡 / 新开讨论 / 复制）；卡片「在文本框中显示」可先编辑，直接发送时自动展开成引用块；双击卡片定位到原会话轮 |
| `dsh-session-tools` | 设置页「会话工具」：会话 Markdown 导出（单条 + 批量 ZIP）、批量归档；会话标题栏「时间线」浮层，点击轮次跳转定位 |
| `dsh-codex-import` | 设置页「导入」：Codex App + Claude Code 统一入口；同路径项目自动归并到现有工作区；默认交接书摘要、完整转录可选；导入历史可回滚；可清理空工作区条目 |
| `dsh-model-picker` | 输入框旁的紧凑模型选择器（Codex 风格）：模型 + 推理档一胶囊切换，替换原生 ui-model-selection（cordis.patch.yml 中 disabled） |
| `dsh-project-panel` | 设置页「项目进度」：扫描配置根目录下的项目，聚合 status.json 锚点（最高优先级）与 git/证据启发式推断（≤14 天活跃 / ≤45 天放缓）；支持状态筛选与锚点写入（`POST /project-panel/api/anchor`）。扫描根配置在 `<DSH home>/storages/project-panel.json`（源自 [kialajin-l/project-workbench](https://github.com/kialajin-l/project-workbench)）|
| `dsh-agent-checkup` | 设置页「Agent 体检」：按 AHM Evidence-lite 设计，对近 30 天本地会话跑 4 个只读探针（P1 输出重复率 / P2 错误可见性 / P3 工具失败率 / P4 上下文膨胀），candidate 级报告 + JSON 导出。纯本地只读，不联网 |
| `dsh-code-wiki` | 设置页「项目 Wiki」：扫描配置根目录下项目，生成结构化总览（README 摘要 / package.json 元数据与脚本 / docs 树 / 顶层目录 / git 活跃度 / 语言构成），缓存于 `<DSH home>/storages/code-wiki/`，可导出单文件 Markdown 到 Downloads（源自 [kialajin-l/Code-Wiki](https://github.com/kialajin-l/Code-Wiki)）|
| `dsh-designseed` | 设置页「原型设计」：调用 [DesignSeed](https://github.com/kialajin-l/DesignSeed) 引擎（需同机部署，见下方注意）从需求描述生成 AI 风格化 HTML 原型（28 种风格，支持双风格混合），iframe 预览 + storages 留存。只读引擎，输出写 `<DSH home>/storages/designseed/` |

## 开发方式

profile 里已经用 **junction** 把 `~/.dsh/profiles/desktop/node_modules/<包名>` 指到这里：

```
C:\Users\Wayne\.dsh\profiles\desktop\node_modules\dsh-balance-badge
  -> <DHS_Plus 源码目录>\\dsh-balance-badge
```

所以改这里的源码，DSH 重载插件后即生效（客户端 bundle 需要刷新页面；宿主代码需要触发一次 profile 重载或重启）。

模拟器/真机验证入口：

```
http://127.0.0.1:<port>/balance-badge/ping
http://127.0.0.1:<port>/usage-panel/api/summary?days=7
http://127.0.0.1:<port>/session-move/api/state
http://127.0.0.1:<port>/nexus-memory/api/stats?db=primary
http://127.0.0.1:<port>/project-panel/api/scan
```

## 打包分发

```powershell
npm run pack:all
```

产物在 `dist/`，每个插件一个 `.tgz`。安装方拿到 tgz 后：

```powershell
dsh plugin --profile <profile> add file:<绝对路径>/dsh-balance-badge-0.1.0.tgz
```

或者直接把目录拷进 `<profile>/node_modules/` 并加入 `dsh.profile.bundles`。

### 一键安装（推荐）

把整个 `DHS_Plus` 目录拷到目标机任意位置，然后在**普通 PowerShell**（管理员不需要）里执行：

```powershell
cd <DHS_Plus 目录>
powershell -ExecutionPolicy Bypass -File install.ps1
```

脚本会自动完成：

1. 发现全部插件（12 个，含 `dsh.bundle.patch` 声明的包）
2. 为每个插件创建 `<profile>/node_modules/<name>` junction
3. 注册 profile `package.json` 的 `file:` 依赖与 `dsh.profile.bundles`
4. 追加 model-picker 所需的原生选择器禁用 patch（`-NoModelPickerPatch` 跳过）
5. 修改前自动备份 `package.json` / `cordis.patch.yml`（`*.bak-install-<时间戳>`）

幂等：重复执行只补缺失项。**完成后重启 DeepSeek Harness 生效。**

参数：`-ProfileDir`（默认 `~\.dsh\profiles\desktop`）、`-SourceDir`（默认脚本所在目录）、`-NoModelPickerPatch`。

注意：

- flowforge / ruleforge 是 **MCP 配置**（cordis.patch.yml 的 stdio 条目），不在脚本范围，按需手动加
- `dsh-designseed` 依赖 [DesignSeed](https://github.com/kialajin-l/DesignSeed) 引擎，需将其克隆到本机并在插件配置里指定引擎路径
- `dsh-nexus-memory` 需要目标机有 Python；检测不到会自动降级为「未初始化」，不影响其他插件

## 约定

- 每个插件都是 `type: module`，宿主入口 `lib/index.js`，客户端入口 `client/client.js`（`window.__ModuleLoader__.load` 自包含包）。
- 宿主侧的写操作必须：备份 → 原子写（临时文件 + rename）→ 读回校验 → 失败回滚。
- 涉及浏览器 POST 的路由必须校验 `Origin`：同 host 或 `dsh-app:`（桌面壳）才放行。
- 只读分析优先（例如用量面板、记忆搜索都不得写会话或记忆库）。

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — 个人与非商业用途免费使用，禁止商用与转卖。
Free for personal and noncommercial use; commercial use and resale are not permitted.
