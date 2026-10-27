window.__ModuleLoader__.load({
	id: "dsh-agent-checkup",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-agent-checkup";
		const inject = ["slots", "locale"];
		const API = "/agent-checkup";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const GOOD = "var(--dsw-alias-state-success-primary, #3fa76b)";
		const BAD = "var(--dsw-alias-state-warning-primary, #d49a43)";

		function clock(ms) {
			if (!Number.isFinite(ms)) return "—";
			try {
				return new Date(ms).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
			} catch {
				return "—";
			}
		}

		function AgentCheckup() {
			const [state, setState] = React.useState({ status: "idle" });
			const [running, setRunning] = React.useState(false);
			const [message, setMessage] = React.useState(null);

			const loadReport = React.useCallback(async () => {
				try {
					const response = await fetch(`${API}/api/report`, { cache: "no-store" });
					const body = await response.json();
					if (body.ok) setState({ status: "ready", data: body });
				} catch {
					// offline host: keep idle
				}
			}, []);

			React.useEffect(() => {
				void loadReport();
			}, [loadReport]);

			const run = React.useCallback(async () => {
				setRunning(true);
				setMessage(null);
				try {
					const response = await fetch(`${API}/api/run`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ days: 30, maxSessions: 50 }),
					});
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "体检失败");
					setState({ status: "ready", data: body });
				} catch (error) {
					setMessage(String(error?.message ?? error));
				} finally {
					setRunning(false);
				}
			}, []);

			const exportReport = React.useCallback(async () => {
				try {
					const response = await fetch(`${API}/api/report/export`, { cache: "no-store" });
					const body = await response.json();
					setMessage(body.ok ? `已导出：${body.path}` : body.error ?? "导出失败");
				} catch (error) {
					setMessage(String(error?.message ?? error));
				}
			}, []);

			const data = state.status === "ready" ? state.data : null;
			// Reports cached before 0.1.1 have no summary; ask for a re-run instead of
			// rendering the old per-session tables.
			const stale = data !== null && (data.summary === undefined || data.summary === null);

			const buttonStyle = {
				padding: "3px 10px",
				border: `1px solid ${LINE}`,
				borderRadius: 6,
				background: "transparent",
				color: MUTED,
				font: "inherit",
				fontSize: 11,
				cursor: "pointer",
			};

			return h(
				"section",
				{
					style: {
						display: "grid",
						gap: 12,
						padding: "4px 2px 28px",
						width: "100%",
						maxWidth: "100%",
						minWidth: 0,
						boxSizing: "border-box",
					},
				},
				h("div", null, h("h2", { style: { margin: 0, fontSize: 16, color: LABEL } }, "Agent 体检")),
				data === null && !running
					? h("div", { style: { color: FAINT, fontSize: 12 } }, "尚未运行体检。对最近 30 天的本地会话日志跑 4 个只读探针，不联网、不上传。")
					: null,
				running ? h("div", { style: { color: MUTED, fontSize: 12 } }, "正在扫描本地会话日志（最多 20 秒）…") : null,
				message ? h("div", { style: { color: MUTED, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" } }, message) : null,
				data && data.sessionsScanned === 0
					? h("div", { style: { color: FAINT, fontSize: 12 } }, "窗口内没有可扫描的会话。")
					: null,
				data && !stale ? overviewLine(data) : null,
				data && stale
					? h("div", { style: { color: FAINT, fontSize: 12 } }, "报告为旧格式，请重新运行体检以查看简化结果。")
					: null,
				data && !stale ? problemList(data.summary) : null,
				data
					? h(
							"div",
							{
								style: {
									display: "flex",
									alignItems: "center",
									gap: 10,
									flexWrap: "wrap",
									minWidth: 0,
									color: FAINT,
									fontSize: 11,
								},
							},
							h("span", { style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								`candidate 结果 · 仅本地有限探针 · ${clock(data.generatedAt)}`),
							h("button", { type: "button", onClick: () => void exportReport(), style: buttonStyle }, "导出报告"),
							h(
								"button",
								{ type: "button", onClick: () => void run(), disabled: running, style: { ...buttonStyle, cursor: running ? "wait" : "pointer" } },
								running ? "体检中…" : "运行体检",
							),
						)
					: null,
			);
		}

		function overviewLine(data) {
			const overview =
				data.summary?.overview ??
				`扫描 ${data.sessionsScanned ?? 0} 个会话 · 发现 ${data.sessionsWarned ?? 0} 处问题 · 探针 ${data.completedProbes ?? 0}/${data.requestedProbes ?? 4}`;
			return h(
				"div",
				{
					style: {
						padding: "10px 12px",
						border: `1px solid ${LINE}`,
						borderRadius: 10,
						background: "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))",
						color: LABEL,
						fontSize: 13,
						minWidth: 0,
						boxSizing: "border-box",
					},
				},
				overview,
			);
		}

		function problemList(summary) {
			const groups = Array.isArray(summary?.groups) ? summary.groups : [];
			return h(
				"div",
				{ style: { display: "grid", gap: 8, minWidth: 0 } },
				groups.map((group) => {
					const ok = group.severity === "info" || group.key === "ok";
					return h(
						"div",
						{
							key: group.key,
							style: {
								minWidth: 0,
								boxSizing: "border-box",
								padding: "8px 12px",
								border: `1px solid ${LINE}`,
								borderRadius: 8,
								display: "grid",
								gap: 2,
							},
						},
						h(
							"div",
							{ style: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 } },
							h(
								"span",
								{
									style: {
										flex: "0 0 auto",
										color: ok ? GOOD : BAD,
										fontSize: 11,
										border: `1px solid ${ok ? GOOD : BAD}`,
										borderRadius: 4,
										padding: "0 6px",
									},
								},
								ok ? "正常" : "注意",
							),
							h(
								"span",
								{ style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: LABEL, fontSize: 12 } },
								group.title,
							),
							group.detail
								? h(
										"span",
										{ style: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: MUTED, fontSize: 12 } },
										group.detail,
									)
								: null,
						),
						group.suggestion
							? h("div", { style: { color: FAINT, fontSize: 11, paddingLeft: 2, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
								`建议：${group.suggestion}`)
							: null,
					);
				}),
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "agent-checkup",
						order: 68,
						label: () => "Agent 体检",
					},
					AgentCheckup,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
