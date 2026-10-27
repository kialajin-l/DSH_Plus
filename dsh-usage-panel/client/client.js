window.__ModuleLoader__.load({
	id: "dsh-usage-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-usage-panel";
		const inject = ["slots", "locale"];
		const API = "/usage-panel/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))";
		const HOVER = "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12))";
		const ACCENT = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const GOOD = "var(--dsw-alias-state-success-primary, #3fa76b)";
		const BAD = "var(--dsw-alias-state-danger-primary, #d36268)";

		function money(cost) {
			if (cost === null || cost === undefined) return "—";
			const value = Number(cost);
			if (!Number.isFinite(value)) return "—";
			return `\u00a5${value >= 0.01 ? value.toFixed(2) : value.toFixed(4)}`;
		}
		function tokenText(count) {
			const value = Number(count ?? 0);
			if (!Number.isFinite(value) || value <= 0) return "0";
			if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
			if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
			return String(Math.round(value));
		}
		function clock(ms) {
			if (!Number.isFinite(ms)) return "—";
			try {
				return new Date(ms).toLocaleString(undefined, {
					month: "2-digit",
					day: "2-digit",
					hour: "2-digit",
					minute: "2-digit",
				});
			} catch {
				return "—";
			}
		}
		function dayLabel(date) {
			return typeof date === "string" ? date.slice(5) : "";
		}
		function card(label, value, hint) {
			return h(
				"div",
				{
					style: {
						flex: "1 1 160px",
						minWidth: 0,
						boxSizing: "border-box",
						overflow: "hidden",
						padding: "12px 14px",
						border: `1px solid ${LINE}`,
						borderRadius: 10,
						background: PANEL,
					},
				},
				h("div", { style: { color: MUTED, fontSize: 12 } }, label),
				h(
					"div",
					{ style: { color: LABEL, fontSize: 24, fontWeight: 600, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" } },
					value,
				),
				hint === undefined ? null : h("div", { style: { color: FAINT, fontSize: 11 } }, hint),
			);
		}
		function useSummary() {
			const [state, setState] = React.useState({ status: "loading" });
			const load = React.useCallback(async () => {
				setState((previous) => (previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" }));
				try {
					const response = await fetch(`${API}/summary?days=7`, { cache: "no-store" });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "请求失败");
					setState({ status: "ready", data: body });
				} catch (error) {
					setState({ status: "error", message: String(error?.message ?? error) });
				}
			}, []);
			React.useEffect(() => {
				void load();
				const timer = setInterval(() => void load(), 60000);
				return () => clearInterval(timer);
			}, [load]);
			return { state, load };
		}
		function BarChart({ days }) {
			const max = Math.max(0.0001, ...days.map((day) => Number(day.cost ?? 0)));
			const today = days.length > 0 ? days[days.length - 1].date : "";
			// A compact ranked list fits the fixed-width settings pane; a horizontal
			// bar chart used to overflow the dialog and clip the right-hand columns.
			return h(
				"div",
				{ style: { display: "grid", gap: 7, paddingTop: 4, minWidth: 0 } },
				days.map((day) => {
					const cost = Number(day.cost ?? 0);
					const width = cost === 0 ? 0 : Math.max(3, Math.round((cost / max) * 100));
					const isToday = day.date === today;
					const peak = Number(day.peakCost ?? 0) > Number(day.offPeakCost ?? 0);
					return h(
						"div",
						{ key: day.date, style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
						h("span", { style: { flex: "0 0 40px", color: isToday ? LABEL : FAINT, fontSize: 11 } }, dayLabel(day.date)),
						h(
							"div",
							{ style: { flex: "1 1 auto", minWidth: 0, height: 8, borderRadius: 4, background: LINE, overflow: "hidden" } },
							h("div", {
								style: {
									width: `${width}%`,
									height: "100%",
									borderRadius: 4,
									background: isToday ? ACCENT : peak ? BAD : GOOD,
									opacity: cost === 0 ? 0 : 0.9,
								},
							}),
						),
						h(
							"span",
							{
								style: {
									flex: "0 0 62px",
									textAlign: "right",
									color: isToday ? ACCENT : MUTED,
									fontSize: 11,
									fontVariantNumeric: "tabular-nums",
								},
								title: `${day.date} · 高峰 ${money(day.peakCost)} / 闲时 ${money(day.offPeakCost)}`,
							},
							money(cost),
						),
					);
				}),
			);
		}
		function ModelTable({ rows }) {
			const total = rows.reduce((sum, row) => sum + row.cost, 0);
			return h(
				"table",
				{ style: { width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" } },
				h(
					"thead",
					null,
					h(
						"tr",
						{ style: { color: FAINT, textAlign: "left" } },
						["模型", "Tokens", "花费", "占比"].map((label) =>
							h(
								"th",
								{
									key: label,
									style: {
										padding: "6px 8px",
										fontWeight: 500,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
										textAlign: label === "模型" ? "left" : "right",
									},
								},
								label,
							),
						),
					),
				),
				h(
					"tbody",
					null,
					rows.map((row) =>
						h(
							"tr",
							{ key: row.model, style: { borderTop: `1px solid ${LINE}` } },
							h("td", { style: { padding: "7px 8px", color: LABEL, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, row.model),
							h(
								"td",
								{ style: { padding: "7px 8px", color: MUTED, fontVariantNumeric: "tabular-nums", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								tokenText(row.tokens.total),
							),
							h(
								"td",
								{ style: { padding: "7px 8px", color: row.priced ? LABEL : BAD, fontVariantNumeric: "tabular-nums", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								row.priced ? money(row.cost) : "未定价",
							),
							h(
								"td",
								{ style: { padding: "7px 8px", color: MUTED, fontVariantNumeric: "tabular-nums", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								total > 0 ? `${((row.cost / total) * 100).toFixed(1)}%` : "—",
							),
						),
					),
				),
			);
		}
		function SessionTable({ sessions }) {
			const [expanded, setExpanded] = React.useState(null);
			return h(
				"div",
				{ style: { minWidth: 0, width: "100%", maxWidth: "100%", overflowX: "auto", overflowY: "hidden" } },
				h(
					"div",
					{ style: { display: "flex", color: FAINT, fontSize: 11, padding: "6px 8px", gap: 8 } },
					h("span", { style: { flex: "2 1 0", minWidth: 0 } }, "会话"),
					h("span", { style: { flex: "0 0 66px", textAlign: "right" } }, "Tokens"),
					h("span", { style: { flex: "0 0 56px", textAlign: "right" } }, "花费"),
					h("span", { style: { flex: "0 0 66px", textAlign: "right" } }, "最后活动"),
				),
				sessions.map((session) => {
					const open = expanded === session.id;
					return h(
						"div",
						{ key: session.id, style: { borderTop: `1px solid ${LINE}` } },
						h(
							"button",
							{
								type: "button",
								onClick: () => setExpanded(open ? null : session.id),
								style: {
									display: "flex",
									alignItems: "center",
									width: "100%",
									boxSizing: "border-box",
									minWidth: 0,
									gap: 8,
									padding: "8px",
									border: 0,
									background: open ? HOVER : "transparent",
									color: LABEL,
									font: "inherit",
									fontSize: 12,
									textAlign: "left",
									cursor: "pointer",
									borderRadius: 6,
								},
							},
							h(
								"span",
								{ style: { flex: "2 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								session.title,
								h("span", { style: { color: FAINT, marginLeft: 6, fontSize: 11 } }, session.id.slice(0, 8)),
							),
							h("span", { style: { flex: "0 0 66px", textAlign: "right", color: MUTED, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, tokenText(session.tokens.total)),
							h("span", { style: { flex: "0 0 56px", textAlign: "right", color: LABEL, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, money(session.cost)),
							h("span", { style: { flex: "0 0 66px", textAlign: "right", color: FAINT, fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, clock(session.lastTime)),
						),
						open
							? h(
									"div",
									{ style: { padding: "2px 10px 10px 22px", display: "grid", gap: 4 } },
									session.models.map((model) =>
										h(
											"div",
											{ key: model.model, style: { display: "flex", gap: 10, color: MUTED, fontSize: 11 } },
											h("span", { style: { minWidth: 160 } }, model.model),
											h("span", { style: { minWidth: 80 } }, tokenText(model.tokens.total)),
											h("span", { style: { color: model.priced ? LABEL : BAD } }, model.priced ? money(model.cost) : "未定价"),
										),
									),
								)
							: null,
					);
				}),
			);
		}
		function UsagePanel() {
			const { state, load } = useSummary();
			if (state.status === "loading") {
				return h("section", { style: { padding: 20, color: MUTED } }, "正在统计会话用量…");
			}
			if (state.status === "error") {
				return h(
					"section",
					{ style: { padding: 20, color: BAD } },
					`统计失败：${state.message}`,
					h(
						"button",
						{ type: "button", onClick: () => void load(), style: { marginLeft: 10, cursor: "pointer" } },
						"重试",
					),
				);
			}
			const data = state.data;
			const days = Array.isArray(data.days) ? data.days : [];
			const sessions = Array.isArray(data.sessions) ? data.sessions : [];
			const today = days.length > 0 ? days[days.length - 1] : { cost: 0, tokens: { total: 0 } };
			const weekCost = days.reduce((sum, day) => sum + Number(day.cost ?? 0), 0);
			const byModel = new Map();
			for (const day of days) {
				for (const [model, row] of Object.entries(day.byModel ?? {})) {
					const aggregate = byModel.get(model) ?? { model, cost: 0, tokens: { total: 0 }, priced: true };
					aggregate.cost += Number(row.cost ?? 0);
					aggregate.tokens.total += Number(row.tokens?.total ?? 0);
					aggregate.priced = aggregate.priced && row.priced !== false;
					byModel.set(model, aggregate);
				}
			}
			const modelRows = [...byModel.values()].sort((a, b) => b.cost - a.cost);
			return h(
				"section",
				{
					style: {
						display: "grid",
						gap: 16,
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
					h("div", null, h("h2", { style: { margin: 0, fontSize: 16, color: LABEL } }, "用量与花费")),
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 10 } },
						h("span", { style: { color: FAINT, fontSize: 11 } }, `更新于 ${clock(data.generatedAt)}`),
						h(
							"button",
							{
								type: "button",
								onClick: () => void load(),
								style: {
									padding: "4px 10px",
									border: `1px solid ${LINE}`,
									borderRadius: 6,
									background: "transparent",
									color: MUTED,
									font: "inherit",
									fontSize: 12,
									cursor: "pointer",
								},
							},
							state.refreshing ? "刷新中…" : "刷新",
						),
					),
				),
				data.totals?.unpricedModels !== undefined && data.totals.unpricedModels.length > 0
					? h(
							"div",
							{ style: { padding: "8px 12px", border: `1px solid ${LINE}`, borderRadius: 8, background: "transparent", color: MUTED, fontSize: 12 } },
							`以下模型没有公开价目，只统计 tokens：${data.totals.unpricedModels.join("、")}`,
						)
					: null,
				h(
					"div",
					{ style: { display: "flex", gap: 12, flexWrap: "wrap" } },
					card("今日花费", money(today.cost), "官方峰谷价 + TokenBom 积分价估算"),
					card("近 7 天花费", money(weekCost), `${days.length} 天`),
					card("今日 tokens", tokenText(today.tokens?.total ?? 0), `输入 ${tokenText(today.tokens?.input ?? 0)} · 输出 ${tokenText(today.tokens?.output ?? 0)}`),
				),
				h(
					"div",
					{ style: { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", overflow: "hidden", padding: "10px 12px", border: `1px solid ${LINE}`, borderRadius: 10, background: PANEL } },
					h("div", { style: { color: MUTED, fontSize: 12, marginBottom: 4 } }, "近 7 天每日花费"),
					h(BarChart, { days }),
					h(
						"div",
						{ style: { color: FAINT, fontSize: 11, marginTop: 6 } },
						"柱色：绿=闲时为主，红=高峰为主；今日高亮。",
					),
				),
				h(
					"div",
					{ style: { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", overflow: "hidden", padding: "10px 12px", border: `1px solid ${LINE}`, borderRadius: 10, background: PANEL } },
					h("div", { style: { color: MUTED, fontSize: 12, marginBottom: 6 } }, "模型拆分"),
					modelRows.length === 0
						? h("div", { style: { color: FAINT, fontSize: 12 } }, "近 7 天没有模型用量")
						: h(ModelTable, { rows: modelRows }),
				),
				h(
					"div",
					{ style: { minWidth: 0, overflow: "hidden", boxSizing: "border-box", padding: "10px 12px", border: `1px solid ${LINE}`, borderRadius: 10, background: PANEL } },
					h("div", { style: { color: MUTED, fontSize: 12, marginBottom: 6 } }, `会话排行（近 7 天，共 ${data.sessions?.length ?? 0} 个）`),
					sessions.length === 0
						? h("div", { style: { color: FAINT, fontSize: 12 } }, "近 7 天没有带用量的会话")
						: h(SessionTable, { sessions }),
				),
				h(
					"div",
					{ style: { color: FAINT, fontSize: 11, lineHeight: 1.6 } },
					"金额估算口径：DeepSeek 官方按 2026-08-17 起的峰谷价（闲时为高峰一半，周末全天闲时）；TokenBom 按积分价换算（¥10 = 5,000 积分，即 1 积分 = ¥0.002，无峰谷）。仅供参考，实际以各家账单为准。数据读取自本地会话日志，不产生任何模型调用。",
				),
			);
		}
		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "usage-panel",
						order: 66,
						label: () => "用量与花费",
					},
					UsagePanel,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});


