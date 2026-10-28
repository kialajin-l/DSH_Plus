# dsh-nexus-memory

Long-term memory for DSH backed by a local SQLite (Nexus) store.

- Auto-injects project-scoped relevant memories into new conversations (junk-filtered, score-gated, no global fallback noise).
- Title-bar 记忆 button: extract memories from the recent 10 turns — lightweight rule mode (default, zero tokens) or model extraction with your choice of provider/model; review, edit and save candidates.
- Write-side dedup (normalized bigram Jaccard) and feedback-weighted ranking (accept/correct adjusts future scores).
- Databases live under `~/.dsh/storages/nexus-memory/` by default; missing DBs degrade silently.
- Requires Python 3.8+ on PATH (the included `py/bridge.py` does the SQLite work).

基于本地 SQLite 的 DSH 长期记忆：新会话自动注入项目相关记忆（噪声过滤、阈值门控）；标题栏「记忆」按钮从最近 10 轮提取记忆（默认轻量规则零 token，可选模型提取并自选 provider/model）；写入去重 + 反馈加权排序；库文件默认在 ~/.dsh/storages/nexus-memory/，缺失时静默降级。需要 PATH 中有 Python 3.8+。

## Install

```bash
dsh plugin --profile desktop add dsh-nexus-memory
```
