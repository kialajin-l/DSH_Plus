# dsh-session-move

Move DSH sessions between workspaces safely, with full backups.

- Validates live/subagent/offline sessions before touching anything.
- Every move is backed up under `~/.dsh/session-move-backups/<timestamp>/`.
- Right-click menu integration in the sidebar (via dsh-session-tools) or standalone settings page.

在 DSH 工作区之间安全移动会话：移动前校验（运行中/子代理/离线状态），每次移动自动备份到 ~/.dsh/session-move-backups/，可与 dsh-session-tools 的右键菜单联动。

## Install

```bash
dsh plugin --profile desktop add @kialajin/dsh-session-move
```
