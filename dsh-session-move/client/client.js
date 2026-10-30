window.__ModuleLoader__.load({
	id: "@kialajin/dsh-session-move",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "@kialajin/dsh-session-move";
		const inject = ["slots", "locale"];
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1d21))";
		const HOVER = "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.1))";
		const GOOD = "var(--dsw-alias-state-success-primary, #3fa76b)";
		const WARN = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const BAD = "var(--dsw-alias-state-danger-primary, #d36268)";
		const api = (path) => new URL(`/session-move/api/${path}`, window.location.origin);
		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
			if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
			if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
			return `${bytes} B`;
		}
		function movable(session) {
			return !session.live && !session.subagent;
		}
		function tag(text, color) {
			return h(
				"span",
				{
					style: {
						padding: "1px 6px",
						borderRadius: 4,
						fontSize: 10,
						lineHeight: 1.6,
						color,
						background: HOVER,
					},
				},
				text,
			);
		}
		function button(label, onClick, options = {}) {
			return h(
				"button",
				{
					type: "button",
					onClick,
					disabled: options.disabled === true,
					style: {
						height: 28,
						padding: "0 12px",
						borderRadius: 6,
						border: `1px solid ${options.primary ? LINE : LINE}`,
						background: options.primary ? GOOD : "transparent",
						color: options.primary ? "#fff" : LABEL,
						font: "inherit",
						fontSize: 12,
						cursor: options.disabled === true ? "not-allowed" : "pointer",
						opacity: options.disabled === true ? 0.5 : 1,
					},
				},
				label,
			);
		}
		function SessionMoveSettings() {
			const [state, setState] = React.useState({ status: "loading" });
			const [selected, setSelected] = React.useState(() => new Set());
			const [target, setTarget] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [results, setResults] = React.useState([]);
			const [error, setError] = React.useState("");
			const load = React.useCallback(async () => {
				try {
					const response = await fetch(api("state"), { cache: "no-store" });
					const payload = await response.json();
					if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
					setState({ status: "ready", data: payload });
				} catch (caught) {
					setState({ status: "error", message: String(caught?.message ?? caught) });
				}
			}, []);
			React.useEffect(() => {
				void load();
			}, [load]);
			const workspaces = state.status === "ready" ? state.data.workspaces : [];
			const allSessions = workspaces.flatMap((workspace) => workspace.sessions);
			const selectable = allSessions.filter(movable);
			const toggle = (sessionId) => {
				setSelected((previous) => {
					const next = new Set(previous);
					if (next.has(sessionId)) next.delete(sessionId);
					else next.add(sessionId);
					return next;
				});
			};
			const selectGroup = (ids) => {
				setSelected((previous) => {
					const next = new Set(previous);
					for (const id of ids) next.add(id);
					return next;
				});
			};
			const clearGroup = (ids) => {
				setSelected((previous) => {
					const next = new Set(previous);
					for (const id of ids) next.delete(id);
					return next;
				});
			};
			const move = async () => {
				if (selected.size === 0 || target.length === 0 || busy) return;
				setBusy(true);
				setError("");
				setResults([]);
				try {
					const response = await fetch(api("move"), {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionIds: [...selected], targetWorkspaceId: target }),
					});
					const payload = await response.json();
					if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
					setResults(Array.isArray(payload.results) ? payload.results : []);
					setSelected(new Set());
					await load();
				} catch (caught) {
					setError(String(caught?.message ?? caught));
				} finally {
					setBusy(false);
				}
			};
			const moved = results.filter((entry) => entry.ok);
			const failed = results.filter((entry) => !entry.ok);
			return h(
				"div",
				{ style: { display: "grid", gap: 14, color: LABEL, fontSize: 13, maxWidth: 900 } },
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 } },
					h("strong", { style: { fontSize: 15 } }, "\u4f1a\u8bdd\u6574\u7406"),
					button("\u5237\u65b0", () => void load(), { disabled: busy }),
				),
				h(
					"p",
					{ style: { margin: 0, color: MUTED, lineHeight: 1.7 } },
					"\u628a\u5386\u53f2\u4f1a\u8bdd\u4ece\u4e00\u4e2a\u5de5\u4f5c\u533a\u79fb\u52a8\u5230\u53e6\u4e00\u4e2a\u5df2\u5b58\u5728\u7684\u5de5\u4f5c\u533a\u3002\u79fb\u52a8\u4f1a\u91cd\u5199\u4f1a\u8bdd\u5934\u91cc\u7684\u5de5\u4f5c\u76ee\u5f55\u3001\u642c\u8fc1\u65e5\u5fd7\u5e76\u6539\u53d8\u5f52\u5c5e\uff1b\u6bcf\u6b21\u79fb\u52a8\u524d\u90fd\u4f1a\u81ea\u52a8\u5907\u4efd\u3002",
				),
				h(
					"p",
					{ style: { margin: 0, color: FAINT, lineHeight: 1.7, fontSize: 12 } },
					"\u6b63\u5728\u8fd0\u884c\u6216\u5df2\u5728\u754c\u9762\u6253\u5f00\u7684\u4f1a\u8bdd\u4e0d\u53ef\u79fb\u52a8\uff0c\u8bf7\u5148\u5207\u6362\u5230\u5176\u4ed6\u4f1a\u8bdd\uff1b\u5b50\u4f1a\u8bdd\u4e0d\u80fd\u5355\u72ec\u79fb\u52a8\u3002\u79fb\u52a8\u540e\u5982\u4fa7\u680f\u672a\u5237\u65b0\uff0c\u624b\u52a8\u5237\u65b0\u9875\u9762\u5373\u53ef\u3002",
				),
				h(
					"div",
					{ style: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 } },
					h("span", { style: { color: MUTED, fontSize: 12 } }, "\u76ee\u6807\u5de5\u4f5c\u533a"),
					h(
						"select",
						{
							value: target,
							onChange: (event) => setTarget(event.target.value),
							disabled: busy,
							style: {
								minWidth: 260,
								height: 30,
								padding: "0 8px",
								borderRadius: 6,
								border: `1px solid ${LINE}`,
								background: PANEL,
								color: LABEL,
								font: "inherit",
								fontSize: 12,
							},
						},
						h("option", { value: "" }, "\u8bf7\u9009\u62e9\u76ee\u6807\u5de5\u4f5c\u533a"),
						workspaces.map((workspace) =>
							h("option", { key: workspace.id, value: workspace.id }, `${workspace.title} \u2014 ${workspace.path}`),
						),
					),
					button(
						busy ? "\u6b63\u5728\u79fb\u52a8\u2026" : `\u79fb\u52a8\u5230\u2026${selected.size > 0 ? `\uff08\u5df2\u9009 ${selected.size}\uff09` : ""}`,
						() => void move(),
						{ primary: true, disabled: busy || selected.size === 0 || target.length === 0 },
					),
					selectable.length > 0
						? h(
								"button",
								{
									type: "button",
									onClick: () => setSelected(new Set(selectable.map((session) => session.id))),
									disabled: busy,
									style: { border: 0, background: "transparent", color: MUTED, font: "inherit", fontSize: 12, cursor: "pointer" },
								},
								"\u5168\u9009\u53ef\u79fb\u52a8\u4f1a\u8bdd",
							)
						: null,
				),
				error.length > 0
					? h("div", { style: { padding: "8px 10px", borderRadius: 6, border: `1px solid ${BAD}`, color: BAD, fontSize: 12 } }, error)
					: null,
				state.status === "loading"
					? h("div", { style: { color: MUTED } }, "\u6b63\u5728\u8bfb\u53d6\u4f1a\u8bdd\u2026")
					: state.status === "error"
						? h("div", { style: { color: BAD } }, `\u8bfb\u53d6\u5931\u8d25\uff1a${state.message}`)
						: null,
				state.status === "ready"
					? h(
							"div",
							{ style: { display: "grid", gap: 12 } },
							workspaces.length === 0 ? h("div", { style: { color: MUTED } }, "\u6ca1\u6709\u5df2\u6ce8\u518c\u7684\u5de5\u4f5c\u533a") : null,
							workspaces.map((workspace) => {
								const ids = workspace.sessions.filter(movable).map((session) => session.id);
								return h(
									"section",
									{ key: workspace.id, style: { border: `1px solid ${LINE}`, borderRadius: 8, overflow: "hidden", background: PANEL } },
									h(
										"header",
										{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", borderBottom: `1px solid ${LINE}` } },
										h(
											"div",
											{ style: { minWidth: 0 } },
											h("strong", { style: { fontSize: 12 } }, workspace.title),
											h("div", { style: { color: FAINT, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, workspace.path),
										),
										h(
											"div",
											{ style: { display: "flex", alignItems: "center", gap: 8, flexShrink: 0 } },
											h("span", { style: { color: FAINT, fontSize: 11 } }, `${workspace.count} \u4e2a\u4f1a\u8bdd`),
											ids.length > 0
												? h(
														"button",
														{
															type: "button",
															onClick: () => selectGroup(ids),
															disabled: busy,
															style: { border: 0, background: "transparent", color: MUTED, font: "inherit", fontSize: 11, cursor: "pointer" },
														},
														"\u5168\u9009",
													)
												: null,
											ids.length > 0
												? h(
														"button",
														{
															type: "button",
															onClick: () => clearGroup(ids),
															disabled: busy,
															style: { border: 0, background: "transparent", color: MUTED, font: "inherit", fontSize: 11, cursor: "pointer" },
														},
														"\u6e05\u7a7a",
													)
												: null,
										),
									),
									workspace.sessions.length === 0
										? h("div", { style: { padding: "10px 12px", color: FAINT, fontSize: 12 } }, "\u6ca1\u6709\u4f1a\u8bdd")
										: workspace.sessions.map((session) =>
												h(
													"label",
													{
														key: session.id,
														style: {
															display: "flex",
															alignItems: "center",
															gap: 10,
															padding: "8px 12px",
															borderTop: `1px solid ${LINE}`,
															cursor: movable(session) && !busy ? "pointer" : "default",
															opacity: movable(session) ? 1 : 0.6,
														},
													},
													h("input", {
														type: "checkbox",
														checked: selected.has(session.id),
														disabled: !movable(session) || busy,
														onChange: () => toggle(session.id),
													}),
													h(
														"span",
														{ style: { flex: 1, minWidth: 0, display: "grid", gap: 2 } },
														h("span", { style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, session.title),
														h("span", { style: { color: FAINT, fontSize: 11 } }, `${session.id.slice(0, 8)}\u2026 \u00b7 ${formatBytes(session.bytes)}`),
													),
													session.live ? tag("\u8fd0\u884c\u4e2d", BAD) : null,
													session.subagent ? tag("\u5b50\u4f1a\u8bdd", WARN) : null,
													!session.live && !session.subagent ? tag("\u53ef\u79fb\u52a8", GOOD) : null,
												),
											),
								);
							}),
						)
					: null,
				results.length > 0
					? h(
							"div",
							{
								style: {
									display: "grid",
									gap: 6,
									padding: "10px 12px",
									borderRadius: 8,
									border: `1px solid ${failed.length > 0 ? BAD : LINE}`,
									background: PANEL,
								},
							},
							h(
								"strong",
								{ style: { fontSize: 12, color: failed.length > 0 ? BAD : GOOD } },
								`\u5b8c\u6210\uff1a\u6210\u529f ${moved.length}\uff0c\u5931\u8d25 ${failed.length}`,
							),
							results.map((entry) =>
								h(
									"div",
									{ key: entry.sessionId, style: { fontSize: 11, color: entry.ok ? MUTED : BAD, lineHeight: 1.6 } },
									entry.ok
										? `${entry.sessionId.slice(0, 8)}\u2026 \u5df2\u79fb\u52a8\uff1a${entry.from} \u2192 ${entry.to}`
										: `${entry.sessionId.slice(0, 8)}\u2026 \u5931\u8d25\uff1a${entry.reason}`,
								),
							),
						)
					: null,
			);
		}
		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "session-move",
						order: 60,
						label: () => "\u4f1a\u8bdd\u6574\u7406",
					},
					SessionMoveSettings,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
