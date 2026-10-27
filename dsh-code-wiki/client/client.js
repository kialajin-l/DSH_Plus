window.__ModuleLoader__.load({
	id: "dsh-code-wiki",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-code-wiki";
		const inject = ["slots", "locale"];
		const API = "/code-wiki/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))";
		const ACCENT = "#4f8cff";

		function money0(n) {
			return String(n);
		}
		function tokenText(n) {
			const value = Number(n) || 0;
			if (value >= 1e8) return `${(value / 1e8).toFixed(2)}亿`;
			if (value >= 1e4) return `${(value / 1e4).toFixed(1)}万`;
			return String(value);
		}
		function clock(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "—";
			try {
				return new Date(ms).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
			} catch {
				return "—";
			}
		}
		function cardStyle() {
			return {
				width: "100%",
				maxWidth: "100%",
				minWidth: 0,
				boxSizing: "border-box",
				overflow: "hidden",
				padding: "10px 12px",
				border: `1px solid ${LINE}`,
				borderRadius: 10,
				background: PANEL,
			};
		}

		function useWiki() {
			const [state, setState] = React.useState({ status: "idle", items: [] });
			const loadList = React.useCallback(async () => {
				try {
					const response = await fetch(`${API}/list`, { cache: "no-store" });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "请求失败");
					setState((previous) => ({ ...previous, status: "ready", items: body.items ?? [] }));
				} catch (error) {
					setState((previous) => ({ ...previous, status: "error", message: String(error?.message ?? error) }));
				}
			}, []);
			const build = React.useCallback(async () => {
				setState((previous) => ({ ...previous, status: "building" }));
				try {
					const response = await fetch(`${API}/build`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "构建失败");
					await loadList();
					setState((previous) => ({
						...previous,
						status: "ready",
						lastBuild: { built: body.built?.length ?? 0, skipped: body.skipped?.length ?? 0, durationMs: body.durationMs ?? 0 },
					}));
				} catch (error) {
					setState((previous) => ({ ...previous, status: "error", message: String(error?.message ?? error) }));
				}
			}, [loadList]);
			return { state, loadList, build };
		}

		function LangBadges({ languages }) {
			return h(
				"span",
				{ style: { display: "inline-flex", gap: 4, flexWrap: "wrap", minWidth: 0 } },
				(languages ?? []).slice(0, 4).map((lang) =>
					h(
						"span",
						{
							key: lang.language,
							style: {
								padding: "1px 7px",
								borderRadius: 8,
								border: `1px solid ${LINE}`,
								color: MUTED,
								fontSize: 10,
								whiteSpace: "nowrap",
							},
						},
						`${lang.language} ${lang.files}`,
					),
				),
			);
		}

		function WikiDetail({ path }) {
			const [wiki, setWiki] = React.useState({ status: "loading" });
			const [exportPath, setExportPath] = React.useState(null);
			React.useEffect(() => {
				let cancelled = false;
				(async () => {
					try {
						const response = await fetch(`${API}/wiki?path=${encodeURIComponent(path)}`, { cache: "no-store" });
						const body = await response.json();
						if (!body.ok) throw new Error(body.error ?? "尚未构建");
						if (!cancelled) setWiki({ status: "ready", wiki: body.wiki });
					} catch (error) {
						if (!cancelled) setWiki({ status: "error", message: String(error?.message ?? error) });
					}
				})();
				return () => {
					cancelled = true;
				};
			}, [path]);
			const doExport = async () => {
				try {
					const response = await fetch(`${API}/export`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ path }),
					});
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "导出失败");
					setExportPath(body.path);
				} catch (error) {
					setExportPath(`导出失败：${String(error?.message ?? error)}`);
				}
			};
			if (wiki.status === "loading") return h("div", { style: { color: FAINT, fontSize: 12, padding: "4px 0" } }, "加载中…");
			if (wiki.status === "error") return h("div", { style: { color: "#d36268", fontSize: 12, padding: "4px 0" } }, wiki.message);
			const w = wiki.wiki;
			const cell = { padding: "4px 0", color: MUTED, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
			return h(
				"div",
				{ style: { display: "grid", gap: 10, paddingTop: 6, minWidth: 0 } },
				w.summary ? h("div", { style: { color: MUTED, fontSize: 12, lineHeight: 1.6 } }, w.summary) : null,
				h(
					"div",
					{ style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", minWidth: 0 } },
					h(LangBadges, { languages: w.languages }),
					w.manager ? h("span", { style: { color: FAINT, fontSize: 11 } }, w.manager) : null,
					w.lastCommitAt ? h("span", { style: { color: FAINT, fontSize: 11 } }, `最近提交 ${clock(w.lastCommitAt)} · ${w.commits ?? 0} 次`) : null,
				),
				w.scripts?.length > 0
					? h(
							"div",
							{ style: { display: "grid", gap: 2, minWidth: 0 } },
							w.scripts.map((s) =>
								h(
									"div",
									{ key: s.script, style: { ...cell, fontFamily: "monospace", fontSize: 11 } },
									`${s.script}: ${s.command}`,
								),
							),
						)
					: null,
				w.topDirs?.length > 0
					? h(
							"div",
							{ style: { display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 } },
							w.topDirs.map((d) =>
								h(
									"span",
									{ key: d.name, style: { padding: "1px 7px", borderRadius: 8, background: PANEL, color: MUTED, fontSize: 11 } },
									`${d.name}/ ${d.files}`,
								),
							),
						)
					: null,
				w.docs?.length > 0
					? h(
							"div",
							{ style: { display: "grid", gap: 2, minWidth: 0, maxHeight: 180, overflowY: "auto" } },
							w.docs.map((doc) =>
								h(
									"div",
									{ key: doc.relPath, style: cell },
									h("span", { style: { color: LABEL } }, doc.title),
									h("span", { style: { color: FAINT, marginLeft: 6, fontSize: 11 } }, doc.relPath),
								),
							),
						)
					: null,
				h(
					"button",
					{
						type: "button",
						onClick: doExport,
						style: {
							alignSelf: "flex-start",
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
					"导出 Markdown",
				),
				exportPath !== null ? h("div", { style: { color: FAINT, fontSize: 11, wordBreak: "break-all" } }, exportPath) : null,
			);
		}

		function ProjectRow({ item }) {
			const [open, setOpen] = React.useState(false);
			return h(
				"div",
				{ style: { borderTop: `1px solid ${LINE}`, minWidth: 0 } },
				h(
					"button",
					{
						type: "button",
						onClick: () => setOpen(!open),
						style: {
							display: "flex",
							alignItems: "center",
							width: "100%",
							boxSizing: "border-box",
							minWidth: 0,
							gap: 8,
							padding: "8px",
							border: 0,
							background: open ? PANEL : "transparent",
							color: LABEL,
							font: "inherit",
							fontSize: 12,
							textAlign: "left",
							cursor: "pointer",
						},
					},
					h(
						"span",
						{ style: { flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
						item.displayName ?? item.name,
						item.description
							? h("span", { style: { color: FAINT, marginLeft: 8, fontSize: 11 } }, item.description.slice(0, 40))
							: null,
					),
					h(LangBadges, { languages: item.languages }),
					h("span", { style: { flex: "0 0 84px", textAlign: "right", color: FAINT, fontSize: 11 } }, clock(item.lastCommitAt)),
					h("span", { style: { flex: "0 0 14px", textAlign: "center", color: FAINT } }, open ? "▾" : "▸"),
				),
				open ? h("div", { style: { padding: "0 10px 10px" } }, h(WikiDetail, { path: item.path })) : null,
			);
		}

		function ProjectWiki(props) {
			const { state, loadList, build } = useWiki();
			React.useEffect(() => {
				void loadList();
			}, [loadList]);
			if (state.status === "error") {
				return h(
					"section",
					{ style: { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "grid", gap: 12, padding: "4px 2px 28px" } },
					h("div", { style: { color: "#d36268", fontSize: 12 } }, state.message),
				);
			}
			const items = state.items ?? [];
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
					h("div", null, h("h2", { style: { margin: 0, fontSize: 16, color: LABEL } }, "项目 Wiki")),
					h(
						"button",
						{
							type: "button",
							onClick: () => void build(),
							disabled: state.status === "building",
							style: {
								padding: "4px 10px",
								border: `1px solid ${LINE}`,
								borderRadius: 6,
								background: "transparent",
								color: MUTED,
								font: "inherit",
								fontSize: 12,
								cursor: state.status === "building" ? "wait" : "pointer",
							},
						},
						state.status === "building" ? "正在扫描…" : "构建 / 刷新 Wiki",
					),
				),
				state.lastBuild
					? h(
							"div",
							{ style: { color: FAINT, fontSize: 11 } },
							`上次构建：${state.lastBuild.built} 个项目，跳过 ${state.lastBuild.skipped}，耗时 ${(state.lastBuild.durationMs / 1000).toFixed(1)}s`,
						)
					: null,
				h(
					"div",
					{ style: { ...cardStyle(), display: "grid", gap: 2 } },
					items.length === 0
						? h("div", { style: { color: FAINT, fontSize: 12, padding: "6px 0" } }, "还没有构建过的项目，点击右上角「构建 / 刷新 Wiki」。")
						: items.map((item) => h(ProjectRow, { key: item.path, item })),
				),
				props.children,
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "code-wiki",
						order: 69,
						label: () => "项目 Wiki",
					},
					ProjectWiki,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
