# dsh-usage-panel

A **usage statistics** settings page for DSH: token and cost accounting across all configured providers.

- Daily bar list (last 30 days), per-model table, per-session table — all computed locally from session logs.
- Provider-aware pricing: official DeepSeek peak/off-peak windows (Beijing time), flat-rate custom providers (TokenBom price table bundled).
- Skips inherited events of forked/subagent sessions so costs are never double-counted.
- Compatible with the `dsh-balance-badge` pricing data.

在 DSH 设置里的用量统计面板：全部基于本地会话日志计算（近 30 天条形图 / 模型表 / 会话表），按服务商感知计价（官方峰谷、TokenBom 平价表内置），并跳过子代理会话继承的历史事件避免重复计费。

## Install

```bash
dsh plugin --profile desktop add @kialajin/dsh-usage-panel
```
