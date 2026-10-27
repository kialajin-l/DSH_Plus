window.__ModuleLoader__.load({
	id: "dsh-session-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");
		const h = React.createElement;
		const name = "dsh-session-tools";
		const inject = ["slots"];
		const API = "/session-tools/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1d21))";
		const HOVER = "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12))";
		const ACCENT = "var(--dsw-alias-label-link, #7aa2ff)";
		const DANGER = "var(--dsw-alias-state-danger-primary, #d36268)";
		const primitives = (() => {
			try {
				return require("@deepseek-ai/dsh-client-ui-primitives");
			} catch {
				return undefined;
			}
		})();
		const MenuItemButton = primitives?.MenuItemButton;
		/** Session-row menu actions talk to the overlay through this process-wide bus. */
		const bus = new Set();
		function publish(event) {
			for (const listener of [...bus]) {
				try {
					listener(event);
				} catch {
					/* one broken listener must not break the menu */
				}
			}
		}
		function toast(text, tone) {
			publish({ kind: "toast", text, tone: tone ?? "info" });
		}

		function formatBytes(bytes) {
			if (!Number.isFinite(bytes) || bytes <= 0) return "\u2014";
			if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
			if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
			return `${bytes} B`;
		}

		function formatTime(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "\u2014";
			const date = new Date(ms);
			const pad = (value) => String(value).padStart(2, "0");
			return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
				date.getMinutes(),
			)}`;
		}

		function shortId(id) {
			return id.replace(/^session-/u, "").slice(0, 8);
		}

		async function saveBlob(response, fallbackName) {
			const blob = await response.blob();
			const disposition = response.headers.get("content-disposition") ?? "";
			const match = /filename="?([^";]+)"?/iu.exec(disposition);
			const fileName = match === null ? fallbackName : decodeURIComponent(match[1]);
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement("a");
			anchor.href = url;
			anchor.download = fileName;
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 5000);
		}

		async function exportMarkdown(sessionId) {
			const response = await fetch(`${API}/markdown?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
			if (!response.ok) throw new Error(`\u5bfc\u51fa\u5931\u8d25\uff08${response.status}\uff09`);
			await saveBlob(response, `${sessionId}.md`);
		}

		async function exportZip(sessionIds) {
			const response = await fetch(`${API}/export`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ sessionIds }),
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => "");
				throw new Error(`\u6253\u5305\u5931\u8d25\uff08${response.status}\uff09${detail.slice(0, 120)}`);
			}
			await saveBlob(response, "dsh-sessions.zip");
		}

		function button(label, onClick, options) {
			const opts = options ?? {};
			return h(
				"button",
				{
					type: "button",
					disabled: opts.disabled === true,
					onClick,
					style: {
						padding: "5px 11px",
						border: `1px solid ${opts.danger === true ? DANGER : LINE}`,
						borderRadius: 7,
						background: opts.primary === true ? "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))" : "transparent",
						color: opts.danger === true ? DANGER : opts.disabled === true ? FAINT : LABEL,
						font: "inherit",
						fontSize: 12,
						cursor: opts.disabled === true ? "not-allowed" : "pointer",
						opacity: opts.disabled === true ? 0.55 : 1,
					},
				},
				label,
			);
		}

		function SessionToolsSettings() {
			const [data, setData] = React.useState({ status: "loading" });
			const [selected, setSelected] = React.useState(() => new Set());
			const [busy, setBusy] = React.useState("");
			const [note, setNote] = React.useState("");
			const [results, setResults] = React.useState([]);

			const load = React.useCallback(async () => {
				setData((current) => (current.status === "ready" ? current : { status: "loading" }));
				try {
					const response = await fetch(`${API}/list`, { cache: "no-store" });
					const payload = await response.json();
					if (payload?.ok !== true) throw new Error(payload?.error ?? "\u5217\u8868\u8bfb\u53d6\u5931\u8d25");
					setData({ status: "ready", workspaces: payload.workspaces ?? [] });
				} catch (error) {
					setData({ status: "error", message: String(error?.message ?? error) });
				}
			}, []);

			React.useEffect(() => {
				void load();
			}, [load]);
			React.useEffect(() => {
				if (note.length === 0) return undefined;
				const timer = setTimeout(() => setNote(""), 2600);
				return () => clearTimeout(timer);
			}, [note]);

			const workspaces = data.status === "ready" ? data.workspaces : [];
			const allSessions = workspaces.flatMap((workspace) => workspace.sessions);
			const toggle = (id) => {
				setSelected((current) => {
					const next = new Set(current);
					if (next.has(id)) next.delete(id);
					else next.add(id);
					return next;
				});
			};
			const selectAll = () => setSelected(new Set(allSessions.map((session) => session.id)));
			const clearAll = () => setSelected(new Set());
			const doExportOne = async (id) => {
				setBusy(id);
				try {
					await exportMarkdown(id);
					setNote("\u5df2\u5bfc\u51fa Markdown");
				} catch (error) {
					setNote(String(error?.message ?? error));
				} finally {
					setBusy("");
				}
			};
			const doExportZip = async () => {
				if (selected.size === 0) return;
				setBusy("zip");
				try {
					await exportZip([...selected]);
					setNote(`\u5df2\u6253\u5305 ${selected.size} \u4e2a\u4f1a\u8bdd`);
				} catch (error) {
					setNote(String(error?.message ?? error));
				} finally {
					setBusy("");
				}
			};
			const doArchive = async () => {
				if (selected.size === 0) return;
				if (!window.confirm(`\u786e\u8ba4\u5f52\u6863\u9009\u4e2d\u7684 ${selected.size} \u4e2a\u4f1a\u8bdd\uff1f\u5f52\u6863\u540e\u4f1a\u4ece\u5f53\u524d\u5217\u8868\u6d88\u5931\u3002`)) return;
				setBusy("archive");
				try {
					const response = await fetch(`${API}/archive`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionIds: [...selected] }),
					});
					const payload = await response.json();
					setResults(payload?.results ?? []);
					if (payload?.ok !== true) throw new Error(payload?.error ?? "\u5f52\u6863\u5931\u8d25");
					setSelected(new Set());
					await load();
				} catch (error) {
					setNote(String(error?.message ?? error));
				} finally {
					setBusy("");
				}
			};
			const rowStyle = {
				display: "flex",
				alignItems: "center",
				gap: 10,
				padding: "6px 8px",
				borderRadius: 7,
			};
			return h(
				"div",
				{ style: { display: "grid", gap: 12, color: LABEL, fontSize: 13 } },
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" } },
					h("div", { style: { fontWeight: 600, fontSize: 14 } }, "\u4f1a\u8bdd\u5de5\u5177"),
					h("span", { style: { color: MUTED, fontSize: 12 } }, "\u5bfc\u51fa Markdown\u3001\u65f6\u95f4\u7ebf\u3001\u6279\u91cf\u5f52\u6863"),
					h("div", { style: { flex: 1 } }),
					button("\u5237\u65b0", () => void load(), { disabled: busy.length > 0 }),
				),
				note.length > 0 ? h("div", { style: { color: ACCENT, fontSize: 12 } }, note) : null,
				h(
					"div",
					{ style: { display: "flex", gap: 8, flexWrap: "wrap" } },
					button("\u5bfc\u51fa Markdown", () => {
						const id = [...selected][0];
						if (id !== undefined) void doExportOne(id);
					}, { disabled: selected.size !== 1 || busy.length > 0 }),
					button("\u6279\u91cf\u5bfc\u51fa ZIP", () => void doExportZip(), { disabled: selected.size === 0 || busy.length > 0, primary: true }),
					button("\u5f52\u6863\u9009\u4e2d", () => void doArchive(), { disabled: selected.size === 0 || busy.length > 0, danger: true }),
					h("div", { style: { flex: 1 } }),
					button("\u5168\u9009", selectAll),
					button("\u6e05\u7a7a", clearAll),
					h("span", { style: { color: MUTED, fontSize: 12, alignSelf: "center" } }, `\u5df2\u9009 ${selected.size}`),
				),
				data.status === "error"
					? h("div", { style: { color: DANGER, fontSize: 12 } }, data.message)
					: null,
				data.status === "loading"
					? h("div", { style: { color: MUTED, fontSize: 12 } }, "\u6b63\u5728\u8bfb\u53d6\u4f1a\u8bdd\u2026")
					: null,
				workspaces.map((workspace) =>
					h(
						"div",
						{ key: workspace.id, style: { border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, background: PANEL } },
						h(
							"div",
							{ style: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 } },
							h("strong", { style: { fontSize: 13 } }, workspace.title),
							h("span", { style: { color: FAINT, fontSize: 11 } }, workspace.path),
							h("div", { style: { flex: 1 } }),
							h("span", { style: { color: MUTED, fontSize: 11 } }, `${workspace.sessions.length} \u4e2a\u4f1a\u8bdd`),
						),
						workspace.sessions.length === 0
							? h("div", { style: { color: FAINT, fontSize: 12, padding: "4px 8px" } }, "\u6ca1\u6709\u4f1a\u8bdd")
							: workspace.sessions.map((session) =>
									h(
										"div",
										{
											key: session.id,
											style: rowStyle,
											onMouseEnter: (event) => {
												event.currentTarget.style.background = HOVER;
											},
											onMouseLeave: (event) => {
												event.currentTarget.style.background = "transparent";
											},
										},
										h("input", {
											type: "checkbox",
											checked: selected.has(session.id),
											onChange: () => toggle(session.id),
										}),
										h(
											"div",
											{ style: { minWidth: 0, flex: 1, display: "grid", gap: 2 } },
											h(
												"div",
												{ style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
												session.title.length > 0 ? session.title : session.id,
											),
											h(
												"div",
												{ style: { color: FAINT, fontSize: 11 } },
												`${shortId(session.id)} \u00b7 ${formatBytes(session.bytes)} \u00b7 ${
													session.turns === null ? "\u2014" : `${session.turns} \u8f6e`
												} \u00b7 ${formatTime(session.lastTime)}`,
											),
										),
										button(busy === session.id ? "\u5bfc\u51fa\u4e2d\u2026" : "\u5bfc\u51fa MD", () => void doExportOne(session.id), {
											disabled: busy.length > 0,
										}),
									),
								),
					),
				),
				results.length > 0
					? h(
							"div",
							{ style: { border: `1px solid ${LINE}`, borderRadius: 10, padding: 10, display: "grid", gap: 4 } },
							h("strong", { style: { fontSize: 12 } }, "\u5f52\u6863\u7ed3\u679c"),
							results.map((entry) =>
								h(
									"div",
									{ key: entry.sessionId, style: { fontSize: 12, color: entry.ok ? LABEL : DANGER } },
									`${shortId(entry.sessionId)} \u00b7 ${entry.ok ? "\u5df2\u5f52\u6863" : entry.reason ?? "\u5931\u8d25"}`,
								),
							),
						)
					: null,
				h(
					"div",
					{ style: { color: FAINT, fontSize: 11, lineHeight: 1.6 } },
					"\u5bfc\u51fa\u4e3a\u53ea\u8bfb\u64cd\u4f5c\uff1b\u5f52\u6863\u8d70 DSH workspace registry\uff0c\u8fd0\u884c\u4e2d\u7684\u4f1a\u8bdd\u4f1a\u88ab\u62d2\u7edd\u3002\u65f6\u95f4\u7ebf\u53ef\u5728\u4f1a\u8bdd\u6807\u9898\u680f\u7684\u300c\u65f6\u95f4\u7ebf\u300d\u6309\u94ae\u6253\u5f00\u3002",
				),
			);
		}

		function jumpToTurn(turn) {
			const row = document.querySelector(`[data-chat-turn="${turn}"]`);
			if (row === null) return false;
			row.scrollIntoView({ behavior: "smooth", block: "center" });
			const previous = row.style.outline;
			row.style.outline = "2px solid var(--dsw-alias-state-warning-primary, #d49a43)";
			row.style.outlineOffset = "2px";
			setTimeout(() => {
				row.style.outline = previous;
				row.style.outlineOffset = "";
			}, 1400);
			return true;
		}

		function TimelinePanel(props) {
			const [state, setState] = React.useState({ status: "loading", turns: [] });
			const load = React.useCallback(async () => {
				if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
					setState({ status: "error", message: "\u6ca1\u6709\u6d3b\u52a8\u4f1a\u8bdd", turns: [] });
					return;
				}
				setState((current) => ({ ...current, status: "loading" }));
				try {
					const response = await fetch(`${API}/timeline?sessionId=${encodeURIComponent(props.sessionId)}`, { cache: "no-store" });
					const payload = await response.json();
					if (payload?.ok !== true) throw new Error(payload?.error ?? "\u65f6\u95f4\u7ebf\u8bfb\u53d6\u5931\u8d25");
					setState({ status: "ready", turns: payload.turns ?? [] });
				} catch (error) {
					setState({ status: "error", message: String(error?.message ?? error), turns: [] });
				}
			}, [props.sessionId]);
			React.useEffect(() => {
				void load();
			}, [load]);
			React.useEffect(() => {
				const onKey = (event) => {
					if (event.key === "Escape") props.onClose();
				};
				document.addEventListener("keydown", onKey);
				return () => document.removeEventListener("keydown", onKey);
			}, [props.onClose]);
			const turns = state.turns;
			const panel = h(
				"div",
				{
					role: "dialog",
					"aria-label": "\u4f1a\u8bdd\u65f6\u95f4\u7ebf",
					style: {
						position: "fixed",
						top: 78,
						right: 18,
						bottom: 110,
						width: 330,
						display: "flex",
						flexDirection: "column",
						border: `1px solid ${LINE}`,
						borderRadius: 12,
						background: PANEL,
						color: LABEL,
						boxShadow: "0 18px 44px rgba(0,0,0,.36)",
						zIndex: 1100,
						overflow: "hidden",
					},
				},
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${LINE}` } },
					h("strong", { style: { fontSize: 13 } }, "\u4f1a\u8bdd\u65f6\u95f4\u7ebf"),
					h("div", { style: { flex: 1 } }),
					button("\u5237\u65b0", () => void load()),
					h(
						"button",
						{
							type: "button",
							onClick: props.onClose,
							title: "\u5173\u95ed",
							style: { border: 0, background: "transparent", color: MUTED, fontSize: 16, cursor: "pointer", padding: "0 2px" },
						},
						"\u00d7",
					),
				),
				state.status === "loading" ? h("div", { style: { padding: 12, color: MUTED, fontSize: 12 } }, "\u6b63\u5728\u8bfb\u53d6\u2026") : null,
				state.status === "error" ? h("div", { style: { padding: 12, color: DANGER, fontSize: 12 } }, state.message) : null,
				h(
					"div",
					{ style: { flex: 1, overflow: "auto", padding: 8 } },
					turns.length === 0 && state.status === "ready"
						? h("div", { style: { padding: 6, color: FAINT, fontSize: 12 } }, "\u6ca1\u6709\u53ef\u5c55\u793a\u7684\u8f6e\u6b21")
						: turns.map((entry) =>
								h(
									"button",
									{
										key: `${entry.turn}-${entry.time}`,
										type: "button",
										onClick: () => void jumpToTurn(entry.turn),
										title: entry.answer.length > 0 ? entry.answer : entry.prompt,
										style: {
											display: "grid",
											gap: 3,
											width: "100%",
											textAlign: "left",
											padding: "8px 9px",
											marginBottom: 4,
											border: `1px solid transparent`,
											borderRadius: 8,
											background: "transparent",
											color: LABEL,
											font: "inherit",
											cursor: "pointer",
										},
										onMouseEnter: (event) => {
											event.currentTarget.style.background = HOVER;
										},
										onMouseLeave: (event) => {
											event.currentTarget.style.background = "transparent";
										},
									},
									h(
										"div",
										{ style: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
										`\u7b2c ${entry.turn} \u8f6e \u00b7 ${entry.prompt.length > 0 ? entry.prompt : "\uff08\u65e0\u6587\u672c\uff09"}`,
									),
									h(
										"div",
										{ style: { fontSize: 11, color: FAINT } },
										`${formatTime(entry.time)} \u00b7 ${entry.tokens > 0 ? `${entry.tokens.toLocaleString()} tokens` : "\u2014"}`,
									),
								),
							),
				),
			);
			return ReactDOM.createPortal(panel, document.body);
		}

		function TimelineButton(props) {
			const [open, setOpen] = React.useState(false);
			return h(
				React.Fragment,
				null,
				h(
					"button",
					{
						type: "button",
						title: "\u4f1a\u8bdd\u65f6\u95f4\u7ebf",
						onClick: () => setOpen((value) => !value),
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 5,
							height: 28,
							padding: "0 10px",
							borderRadius: 14,
							border: `1px solid ${LINE}`,
							background: open ? HOVER : "transparent",
							color: LABEL,
							font: "inherit",
							fontSize: 12,
							cursor: "pointer",
							whiteSpace: "nowrap",
						},
					},
					h("span", { "aria-hidden": true }, "\u2630"),
					h("span", null, "\u65f6\u95f4\u7ebf"),
				),
				open ? h(TimelinePanel, { sessionId: props.sessionId, onClose: () => setOpen(false) }) : null,
			);
		}

		async function duplicateSessionCopy(sessionId) {
			try {
				const response = await fetch(`${API}/duplicate`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ sessionId }),
				});
				const payload = await response.json();
				if (payload?.ok === true && typeof payload.sessionId === "string") {
					toast(`已创建副本 ${shortId(payload.sessionId)}，重启应用后可在列表中看到`);
					return;
				}
				toast(payload?.error ?? payload?.reason ?? "复制失败", "error");
			} catch (error) {
				toast(`复制失败：${String(error?.message ?? error)}`, "error");
			}
		}

		function useCloseMenu(props) {
			const [, setMenuOpen] = props.useMenuOpenState();
			return () => setMenuOpen(false);
		}

		function menuRow(label, onSelect, separator) {
			if (MenuItemButton !== undefined) {
				return h(MenuItemButton, { separatorBefore: separator === true, onSelect }, label);
			}
			return h(
				"button",
				{
					type: "button",
					onClick: onSelect,
					style: {
						display: "block",
						width: "100%",
						padding: "7px 12px",
						border: 0,
						background: "transparent",
						color: LABEL,
						font: "inherit",
						fontSize: 12,
						textAlign: "left",
						cursor: "pointer",
					},
				},
				label,
			);
		}

		function ExportMarkdownRow(props) {
			const close = useCloseMenu(props);
			return menuRow(
				"导出 Markdown",
				() => {
					close();
					exportMarkdown(props.sessionId).catch((error) => toast(`导出失败：${String(error?.message ?? error)}`, "error"));
				},
				true,
			);
		}

		function ExportZipRow(props) {
			const close = useCloseMenu(props);
			return menuRow(
				"导出会话 ZIP",
				() => {
					close();
					exportZip([props.sessionId]).catch((error) => toast(`打包失败：${String(error?.message ?? error)}`, "error"));
				},
				false,
			);
		}

		function DuplicateRow(props) {
			const close = useCloseMenu(props);
			return menuRow(
				"复制会话",
				() => {
					close();
					void duplicateSessionCopy(props.sessionId);
				},
				false,
			);
		}

		function MoveRow(props) {
			const close = useCloseMenu(props);
			return menuRow(
				"移动到工作区…",
				() => {
					close();
					publish({ kind: "move", sessionId: props.sessionId });
				},
				false,
			);
		}

		function SessionToolsOverlay() {
			const [move, setMove] = React.useState(null);
			const [toastState, setToastState] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			React.useEffect(() => {
				const listener = (event) => {
					if (event.kind === "move") void openMove(event.sessionId);
					else if (event.kind === "toast") setToastState({ text: event.text, tone: event.tone ?? "info" });
				};
				bus.add(listener);
				return () => bus.delete(listener);
			}, []);
			React.useEffect(() => {
				if (toastState === null) return undefined;
				const timer = setTimeout(() => setToastState(null), 3400);
				return () => clearTimeout(timer);
			}, [toastState]);
			const openMove = async (sessionId) => {
				try {
					const response = await fetch("/session-move/api/state", { cache: "no-store" });
					const payload = await response.json();
					const list = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
					const current = list.find(
						(workspace) => Array.isArray(workspace.sessions) && workspace.sessions.some((entry) => entry.id === sessionId),
					);
					setMove({
						sessionId,
						workspaces: list.filter((workspace) => workspace.id !== current?.id),
						target: "",
					});
				} catch (error) {
					setToastState({ text: `读取工作区失败：${String(error?.message ?? error)}`, tone: "error" });
				}
			};
			const confirmMove = async () => {
				if (move === null || move.target.length === 0) return;
				setBusy(true);
				try {
					const response = await fetch("/session-move/api/move", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionIds: [move.sessionId], targetWorkspaceId: move.target }),
					});
					const payload = await response.json();
					const moved = Array.isArray(payload?.moved) && payload.moved.includes(move.sessionId);
					const reason = Array.isArray(payload?.results)
						? payload.results.find((entry) => entry.ok !== true)?.reason
						: undefined;
					setMove(null);
					setToastState({
						text: moved
							? "已移动，重启应用后在目标工作区可见"
							: `移动失败：${reason ?? payload?.error ?? "未知原因"}`,
						tone: moved ? "info" : "error",
					});
				} catch (error) {
					setToastState({ text: `移动失败：${String(error?.message ?? error)}`, tone: "error" });
				} finally {
					setBusy(false);
				}
			};
			const toastElement =
				toastState === null
					? null
					: h(
							"div",
							{
								style: {
									position: "fixed",
									left: "50%",
									bottom: 96,
									transform: "translateX(-50%)",
									zIndex: 1300,
									padding: "9px 16px",
									borderRadius: 9,
									border: `1px solid ${toastState.tone === "error" ? DANGER : LINE}`,
									background: PANEL,
									color: toastState.tone === "error" ? DANGER : LABEL,
									fontSize: 12,
									boxShadow: "0 10px 28px rgba(0,0,0,.35)",
									maxWidth: "70vw",
								},
							},
							toastState.text,
						);
			const moveElement =
				move === null
					? null
					: h(
							"div",
							{
								style: {
									position: "fixed",
									inset: 0,
									zIndex: 1300,
									display: "grid",
									placeItems: "center",
									background: "rgba(0,0,0,.45)",
								},
								onClick: () => {
									if (!busy) setMove(null);
								},
							},
							h(
								"div",
								{
									onClick: (event) => event.stopPropagation(),
									style: {
										width: 360,
										maxWidth: "90vw",
										padding: 16,
										borderRadius: 12,
										border: `1px solid ${LINE}`,
										background: PANEL,
										color: LABEL,
										boxShadow: "0 18px 48px rgba(0,0,0,.4)",
										display: "grid",
										gap: 10,
									},
								},
								h("div", { style: { fontSize: 14, fontWeight: 600 } }, "移动到工作区"),
								h(
									"div",
									{ style: { fontSize: 11, color: FAINT } },
									`会话 ${shortId(move.sessionId)} · 运行中的会话会被拒绝`,
								),
								h(
									"div",
									{ style: { display: "grid", gap: 4, maxHeight: "45vh", overflow: "auto" } },
									move.workspaces.length === 0
										? h("div", { style: { fontSize: 12, color: FAINT } }, "没有可用的目标工作区")
										: move.workspaces.map((workspace) =>
												h(
													"button",
													{
														key: workspace.id,
														type: "button",
														onClick: () => setMove((current) => ({ ...current, target: workspace.id })),
														style: {
															display: "grid",
															gap: 2,
															textAlign: "left",
															padding: "8px 10px",
															borderRadius: 8,
															border: `1px solid ${move.target === workspace.id ? ACCENT : LINE}`,
															background:
																move.target === workspace.id
																	? "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))"
																	: "transparent",
															color: LABEL,
															font: "inherit",
															cursor: "pointer",
														},
													},
													h("span", { style: { fontSize: 12 } }, workspace.title),
													h("span", { style: { fontSize: 10, color: FAINT } }, workspace.path),
												),
											),
								),
								h(
									"div",
									{ style: { display: "flex", justifyContent: "flex-end", gap: 8 } },
									button("取消", () => setMove(null), { disabled: busy }),
									button("移动", () => void confirmMove(), { primary: true, disabled: busy || move.target.length === 0 }),
								),
							),
						);
			return h(
				React.Fragment,
				null,
				toastElement === null ? null : ReactDOM.createPortal(toastElement, document.body),
				moveElement === null ? null : ReactDOM.createPortal(moveElement, document.body),
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "session-tools",
						order: 62,
						label: () => "\u4f1a\u8bdd\u5de5\u5177",
					},
					SessionToolsSettings,
				),
			);
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "session-tools-timeline",
						order: 60,
					},
					TimelineButton,
				),
			);
			for (const [id, order, Component] of [
				["session-tools.export-markdown", 500, ExportMarkdownRow],
				["session-tools.export-zip", 510, ExportZipRow],
				["session-tools.duplicate", 520, DuplicateRow],
				["session-tools.move", 530, MoveRow],
			]) {
				ctx.slots.inject("sidebar.workspaces.session.menu.item", () =>
					ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id, order }, Component),
				);
			}
			ctx.slots.inject("shell.overlay", () =>
				ctx.slots.register({ name: "shell.overlay", id: "session-tools-overlay", order: 55 }, SessionToolsOverlay),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
