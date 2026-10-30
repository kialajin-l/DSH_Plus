# dsh-model-picker

A Codex-style model selector for the DSH composer, with 4 reasoning-effort levels.

- Replaces the native model display in the input dock with a dropdown listing every provider/model configured in your profile.
- Per-model reasoning effort presets; selection persists per session.
- Disabling of the native selector ships inside the package (`cordis.patch.yml`) — no manual profile edits needed.

把 DSH 输入框的模型显示替换为 Codex 风格下拉选择器：列出 profile 里全部 provider/model，支持 4 档推理力度，选择按会话记忆；对原生选择器的禁用补丁随包内置（cordis.patch.yml），无需手工改 profile。

## Install

```bash
dsh plugin --profile desktop add @kialajin/dsh-model-picker
```
