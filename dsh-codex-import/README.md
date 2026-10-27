# dsh-codex-import

Unified **导入** page for DeepSeek Harness (DSH): bring your Codex App and Claude Code session history into DSH.

- **Handoff mode (default)** — each imported session becomes a compact handoff: 项目与目标 / 最近工作 / 变更与命令 / 未完成·下一步 (recent turns, ~12k char budget). Low token cost, opens instantly.
- **Full transcript mode** — replays the original conversation turn-by-turn, assistant messages synthesized with the exact settlement/stream structure DSH requires.
- **Same-project merge** — sessions whose original cwd maps to an existing DSH workspace are added to that workspace instead of creating duplicates.
- Sub-agent rollouts are filtered out; only real user threads are imported.
- Rollback with full backups (ledger at `~/.dsh/storages/codex-import-ledger.json`).

在 DSH 设置里新增「导入」页：把 Codex App 与 Claude Code 的会话历史迁入 DSH。默认 handoff 模式（总结+最近若干轮，省 token），可选完整转录模式；原项目路径与现有工作区相同时间会话自动归并；自动过滤子代理记录；支持一键回滚（含备份）。

## Install

```bash
dsh plugin --profile desktop add dsh-codex-import
```

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for personal and noncommercial use; commercial use and resale are not permitted. 个人与非商业用途免费使用，禁止商用与转卖。
