window.__ModuleLoader__.load({
	id: "dsh-designseed",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-designseed";
		const inject = ["slots", "locale"];
		const API = "/designseed/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))";
		const ACCENT = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const BAD = "var(--dsw-alias-state-danger-primary, #d36268)";

		function selectStyle(extra) {
			return {
				width: "100%",
				padding: "7px 10px",
				border: `1px solid ${LINE}`,
				borderRadius: 8,
				background: "transparent",
				color: LABEL,
				font: "inherit",
				fontSize: 13,
				boxSizing: "border-box",
				...extra,
			};
		}

		function Picker({ styles, form, setForm, disabled }) {
			return h(
				"div",
				{ style: { display: "grid", gap: 10 } },
				h(
					"label",
					{ style: { display: "grid", gap: 4, fontSize: 12, color: MUTED } },
					"主风格",
					h(
						"select",
						{
							value: form.style,
							disabled,
							onChange: (event) => setForm((previous) => ({ ...previous, style: event.target.value })),
							style: selectStyle(),
						},
						styles.map((style) =>
							h("option", { key: style.id, value: style.id }, `${style.name}${style.nameEn ? ` · ${style.nameEn}` : ""}`),
						),
					),
				),
				h(
					"label",
					{ style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: MUTED } },
					h("input", {
						type: "checkbox",
						checked: form.mixEnabled,
						onChange: (event) => setForm((previous) => ({ ...previous, mixEnabled: event.target.checked })),
					}),
					"混合另一种风格",
				),
				form.mixEnabled
					? h(
							"div",
							{ style: { display: "grid", gap: 8 } },
							h(
								"select",
								{
									value: form.mixStyle,
									onChange: (event) => setForm((previous) => ({ ...previous, mixStyle: event.target.value })),
									style: selectStyle(),
								},
								styles
									.filter((style) => style.id !== form.style)
									.map((style) => h("option", { key: style.id, value: style.id }, style.name)),
							),
							h(
								"label",
								{ style: { display: "grid", gap: 4, fontSize: 11, color: FAINT } },
								`混合比例 ${(form.mixRatio * 100).toFixed(0)}%`,
								h("input", {
									type: "range",
									min: 10,
									max: 90,
									value: Math.round(form.mixRatio * 100),
									onChange: (event) =>
										setForm((previous) => ({ ...previous, mixRatio: Number(event.target.value) / 100 })),
									style: { width: "100%" },
								}),
							),
						)
					: null,
			);
		}

		function DesignSeed({ t }) {
			const [state, setState] = React.useState({ status: "loading" });
			const [form, setForm] = React.useState({
				prompt: "",
				style: "minimalism",
				mixEnabled: false,
				mixStyle: "cyberpunk",
				mixRatio: 0.3,
			});
			const [busy, setBusy] = React.useState(false);
			const [error, setError] = React.useState(null);
			const [result, setResult] = React.useState(null);
			const load = React.useCallback(async () => {
				setState((previous) => ({ ...previous, refreshing: true }));
				try {
					const response = await fetch(`${API}/styles`, { cache: "no-store" });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "请求失败");
					setState({ status: "ready", styles: body.styles, degraded: body.degraded === true });
				} catch (err) {
					setState({ status: "error", message: String(err?.message ?? err) });
				}
			}, []);
			React.useEffect(() => {
				void load();
			}, [load]);
			if (state.status === "loading") {
				return h("div", { style: { color: MUTED, fontSize: 13, padding: "12px 2px" } }, "正在读取风格列表…");
			}
			if (state.status === "error") {
				return h(
					"div",
					{ style: { color: BAD, fontSize: 13, padding: "12px 2px" } },
					`风格列表加载失败：${state.message}（引擎目录 E:\\code\\DesignSeed 必须存在）`,
				);
			}
			const styles = state.styles;
			const generate = async () => {
				if (busy || form.prompt.trim().length === 0) return;
				setBusy(true);
				setError(null);
				try {
					const response = await fetch(`${API}/generate`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							prompt: form.prompt,
							style: form.style,
							mixStyle: form.mixEnabled ? form.mixStyle : undefined,
							mixRatio: form.mixEnabled ? form.mixRatio : undefined,
						}),
					});
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "生成失败");
					setResult(body);
				} catch (err) {
					setError(String(err?.message ?? err));
				} finally {
					setBusy(false);
				}
			};
			return h(
				"section",
				{
					style: {
						display: "grid",
						gap: 14,
						padding: "4px 2px 28px",
						width: "100%",
						maxWidth: "100%",
						minWidth: 0,
						boxSizing: "border-box",
					},
				},
				h(
					"div",
					{ style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", minWidth: 0 } },
					h("h2", { style: { margin: 0, fontSize: 16, color: LABEL } }, "原型设计"),
					h(
						"span",
						{ style: { color: FAINT, fontSize: 11 } },
						state.degraded ? "引擎风格列表读取失败，使用内置兜底" : `DesignSeed 引擎 · ${styles.length} 种风格`,
					),
				),
				h(
					"div",
					{ style: { padding: "12px 14px", border: `1px solid ${LINE}`, borderRadius: 10, background: PANEL, minWidth: 0 } },
					h(
						"label",
						{ style: { display: "grid", gap: 6 } },
						h("span", { style: { color: MUTED, fontSize: 12 } }, "需求描述"),
						h("textarea", {
							value: form.prompt,
							onChange: (event) => setForm((previous) => ({ ...previous, prompt: event.target.value })),
							placeholder: "例：一个记账 App 的首页，底部四个标签\n例：团队官网落地页，深色科技风，含定价表",
							rows: 3,
							style: {
								width: "100%",
								boxSizing: "border-box",
								resize: "vertical",
								padding: "8px 10px",
								border: `1px solid ${LINE}`,
								borderRadius: 8,
								background: "transparent",
								color: LABEL,
								font: "inherit",
								fontSize: 13,
							},
						}),
					),
					h("div", { style: { height: 10 } }),
					h(Picker, { styles, form, setForm, disabled: busy }),
					h("div", { style: { height: 12 } }),
					h(
						"button",
						{
							type: "button",
							onClick: () => void generate(),
							disabled: busy || form.prompt.trim().length === 0,
							style: {
								padding: "8px 16px",
								border: `1px solid ${LINE}`,
								borderRadius: 8,
								background: busy ? "transparent" : ACCENT,
								color: busy ? MUTED : "#16181c",
								font: "inherit",
								fontSize: 13,
								fontWeight: 600,
								cursor: busy || form.prompt.trim().length === 0 ? "default" : "pointer",
								opacity: busy || form.prompt.trim().length === 0 ? 0.6 : 1,
							},
						},
						busy ? "生成中…（通常几秒）" : "生成原型",
					),
					error !== null ? h("div", { style: { color: BAD, fontSize: 12, marginTop: 10, whiteSpace: "pre-wrap" } }, error) : null,
				),
				result !== null
					? h(
							"div",
							{ style: { display: "grid", gap: 8, minWidth: 0 } },
							h(
								"div",
								{ style: { color: MUTED, fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap", minWidth: 0 } },
								h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 } }, `文件：${result.file}`),
								h("span", null, `${(result.durationMs / 1000).toFixed(1)}s · ${result.style}`),
							),
							h("iframe", {
								title: "原型预览",
								srcDoc: result.html,
								sandbox: "",
								style: {
									width: "100%",
									height: 480,
									border: `1px solid ${LINE}`,
									borderRadius: 10,
									background: "#fff",
									boxSizing: "border-box",
								},
							}),
							h(
								"div",
								{ style: { color: FAINT, fontSize: 11 } },
								"HTML 已保存到 storages\\designseed，可直接双击在浏览器打开。",
							),
						)
					: null,
				h(
					"div",
					{ style: { color: FAINT, fontSize: 11 } },
					"引擎：E:\\code\\DesignSeed（本插件只调用其 CLI，不修改引擎）。生成结果为自包含 HTML，预览沙箱内不执行脚本。",
				),
			);
		}
		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "designseed",
						order: 70,
						label: () => "原型设计",
					},
					DesignSeed,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
