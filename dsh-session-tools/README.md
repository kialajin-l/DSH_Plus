# dsh-session-tools

Session utilities for DSH: export, timeline, duplication and a sidebar right-click menu.

- Export any session as Markdown (single file) or ZIP batch (custom store-only ZIP writer, no dependencies).
- Timeline overlay for jumping between turns; read-only diagnosis endpoint for session log health.
- Safe session duplication (rewrites internal identity fields so DSH accepts the copy).
- Adds sidebar session right-click menu items (used by dsh-session-move).

DSH 会话工具箱：导出 Markdown / 批量 ZIP（零依赖自研 ZIP 写入器）、时间线浮层快速跳轮、安全复制会话（自动重写内部身份字段）、侧栏会话右键菜单扩展。

## Install

```bash
dsh plugin --profile desktop add @kialajin/dsh-session-tools
```
