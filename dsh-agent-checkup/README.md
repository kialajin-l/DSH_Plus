# dsh-agent-checkup

An **Agent 体检** settings page for DSH (AHM Evidence-lite): read-only health probes over your local DSH session logs.

- Four probes: repetitive loops (bigram similarity), error visibility, tool failure rate, context bloat (head/tail growth).
- Findings are **candidate-level** (heuristics with disclaimers), grouped by type with suggestions; self-contained dark HTML report export.

DSH 设置里的 Agent 体检页：对本地会话日志做四项只读探针（重复循环/错误可见性/工具失败率/上下文膨胀），结果为候选级判断（带免责声明），按类型聚合给出建议，可导出自包含深色 HTML 报告。

## Install

```bash
dsh plugin --profile desktop add dsh-agent-checkup
```

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for personal and noncommercial use; commercial use and resale are not permitted. 个人与非商业用途免费使用，禁止商用与转卖。
