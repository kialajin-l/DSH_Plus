# dsh-project-panel

A **项目进度** settings page for DSH: one glance at every project on your disk.

- Scans configured roots (e.g. `E:\code`) and classifies each project: active / slowing / idle, via `status.json` anchors first, then git activity and evidence-file heuristics.
- Stats cards, filters and project cards; write an anchor back with one click.
- Self-contained dark HTML export (single file, opens anywhere).

在 DSH 设置里的项目进度面板：扫描配置的代码根目录，按 status.json 锚点优先 + git/证据推断给出 活跃/放缓/闲置 分类，支持一键写回锚点、导出自包含深色 HTML 报告。

## Install

```bash
dsh plugin --profile desktop add dsh-project-panel
```

## License

[PolyForm Noncommercial 1.0.0](./LICENSE) — free for personal and noncommercial use; commercial use and resale are not permitted. 个人与非商业用途免费使用，禁止商用与转卖。
