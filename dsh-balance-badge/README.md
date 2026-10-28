# dsh-balance-badge

A **balance badge** for the DSH title bar: account balance, today's cost, session tokens, and peak/off-peak pricing awareness at a glance.

- Balance popover: top-up / bonus / today cost / current-session tokens.
- Peak vs off-peak aware (Beijing-time weekday windows) for official DeepSeek pricing; flat pricing for custom providers like TokenBom.
- Click to refresh; no configuration needed.

在 DSH 标题栏显示账户余额徽章：余额弹窗含 充值/赠金/今日花费/本会话 tokens；官方 DeepSeek 按峰谷时段计价展示，自定义服务商（如 TokenBom）按平价展示；点击即刷新，零配置。

## Install

```bash
dsh plugin --profile desktop add dsh-balance-badge
```
