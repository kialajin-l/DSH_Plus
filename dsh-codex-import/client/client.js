window.__ModuleLoader__.load({
	id: "dsh-codex-import",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-codex-import";
		const inject = ["slots"];
		const API = "/codex-import/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1d21))";
		const CARD = "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))";
		const ACCENT = "var(--dsw-alias-label-link, #7aa2ff)";
		const GOOD = "var(--dsw-alias-state-success-primary, #3fa76b)";
		const WARN = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const BAD = "var(--dsw-alias-state-danger-primary, #d36268)";

		function bytesLabel(value) {
			const size = Number(value) || 0;
			if (size >= 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
			if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
			if (size >= 1024) return `${(size / 1024).toFixed(0)} KB`;
			return `${size} B`;
		}

		function timeLabel(value) {
			if (typeof value === "number" || (typeof value === "string" && value.length > 0)) {
				try {
					return new Date(value).toLocaleString();
				} catch {
					return String(value);
				}
			}
			return "";
		}

		async function request(path, init) {
			const response = await fetch(`${API}${path}`, init);
			let data = {};
			try {
				data = await response.json();
			} catch {
				data = {};
			}
			if (!response.ok) throw new Error(data.error ?? data.reason ?? `HTTP ${response.status}`);
			return data;
		}

		function Badge(text, tone) {
			return h(
				"span",
				{
					style: {
						padding: "1px 7px",
						borderRadius: 10,
						fontSize: 11,
						color: tone === "warn" ? WARN : tone === "good" ? GOOD : tone === "bad" ? BAD : MUTED,
						border: `1px solid ${LINE}`,
						whiteSpace: "nowrap",
					},
				},
				text,
			);
		}

		function Checkbox(props) {
			return h("input", {
				type: "checkbox",
				checked: props.checked === true,
				disabled: props.disabled === true,
				onChange: (event) => props.onChange?.(event.currentTarget.checked),
				style: { margin: 0, accentColor: ACCENT, cursor: props.disabled === true ? "not-allowed" : "pointer" },
			});
		}

		function Section(title, extra, children) {
			return h(
				"div",
				{ style: { border: `1px solid ${LINE}`, borderRadius: 10, background: PANEL, padding: 12, marginBottom: 12 } },
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8 } },
					h("strong", { style: { fontSize: 13, color: LABEL } }, title),
					extra ?? null,
				),
				children,
			);
		}

		function ImportPage() {
			const [sources, setSources] = React.useState(null);
			const [source, setSource] = React.useState("codex");
			const [scan, setScan] = React.useState(null);
			const [expanded, setExpanded] = React.useState(() => new Set());
			const [selected, setSelected] = React.useState(() => new Set());
			const [mode, setMode] = React.useState("handoff");
			const [busy, setBusy] = React.useState("");
			const [notice, setNotice] = React.useState("");
			const [preview, setPreview] = React.useState(null);
			const [results, setResults] = React.useState(null);
			const [history, setHistory] = React.useState([]);
			const [cleanup, setCleanup] = React.useState(null);

			const flash = (text) => {
				setNotice(text);
				setTimeout(() => setNotice(""), 4000);
			};

			const loadSources = async () => {
				try {
					const data = await request("/sources");
					const map = {};
					for (const entry of data.sources ?? []) map[entry.id] = entry;
					setSources(map);
				} catch (error) {
					flash(`读取来源失败：${String(error?.message ?? error)}`);
				}
			};

			const loadScan = async (id) => {
				setBusy("scan");
				try {
					setScan(await request(`/scan?source=${id}`));
				} catch (error) {
					flash(`扫描失败：${String(error?.message ?? error)}`);
				} finally {
					setBusy("");
				}
			};

			const loadHistory = async () => {
				try {
					const data = await request("/history");
					setHistory(Array.isArray(data.batches) ? data.batches : []);
				} catch {
					/* history is optional */
				}
			};

			const loadCleanup = async () => {
				try {
					const data = await request("/cleanup-workspaces");
					setCleanup(Array.isArray(data.candidates) ? data.candidates : []);
				} catch {
					/* cleanup is optional */
				}
			};

			const refreshAll = async (id) => {
				await loadSources();
				await loadScan(id);
				await loadHistory();
				await loadCleanup();
			};

			React.useEffect(() => {
				void refreshAll("codex");
				// eslint-disable-next-line react-hooks/exhaustive-deps
			}, []);

			const switchSource = async (id) => {
				if (id === source) return;
				setSource(id);
				setSelected(new Set());
				setExpanded(new Set());
				await loadScan(id);
			};

			const toggleSession = (path, checked) => {
				setSelected((current) => {
					const next = new Set(current);
					if (checked) next.add(path);
					else next.delete(path);
					return next;
				});
			};

			const toggleProject = (project, checked) => {
				setSelected((current) => {
					const next = new Set(current);
					for (const session of project.sessions) {
						if (checked) next.add(session.sourcePath);
						else next.delete(session.sourcePath);
					}
					return next;
				});
			};

			const expandProject = (cwd) => {
				setExpanded((current) => {
					const next = new Set(current);
					if (next.has(cwd)) next.delete(cwd);
					else next.add(cwd);
					return next;
				});
			};

			const projects = scan?.projects ?? [];
			const selectable = projects.flatMap((project) => project.sessions);

			const doPreview = async () => {
				const first = [...selected][0];
				if (first === undefined) {
					flash("先勾选一个会话再预览");
					return;
				}
				setBusy("preview");
				try {
					setPreview(await request(`/preview?source=${source}&sourcePath=${encodeURIComponent(first)}&mode=${mode}`));
				} catch (error) {
					flash(`预览失败：${String(error?.message ?? error)}`);
				} finally {
					setBusy("");
				}
			};

			const doImport = async () => {
				if (selected.size === 0) {
					flash("先勾选要导入的会话");
					return;
				}
				setBusy("import");
				setResults(null);
				try {
					const data = await request("/import", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ source, sourcePaths: [...selected], mode }),
					});
					setResults(data.results ?? []);
					setSelected(new Set());
					flash(`已导入 ${data.imported ?? 0} 个会话`);
					await loadScan(source);
					await loadHistory();
					await loadCleanup();
				} catch (error) {
					flash(`导入失败：${String(error?.message ?? error)}`);
				} finally {
					setBusy("");
				}
			};

			const rollbackBatch = async (batch) => {
				const ids = batch.sessions.map((session) => session.sessionId).filter((id) => typeof id === "string");
				if (ids.length === 0) return;
				setBusy(`rollback-${batch.batch}`);
				try {
					await request("/rollback", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionIds: ids }),
					});
					flash(`已回滚 ${ids.length} 个会话`);
					await loadScan(source);
					await loadHistory();
					await loadCleanup();
				} catch (error) {
					flash(`回滚失败：${String(error?.message ?? error)}`);
				} finally {
					setBusy("");
				}
			};

			const deleteWorkspaces = async (ids) => {
				if (ids.length === 0) return;
				setBusy("cleanup");
				try {
					const data = await request("/cleanup-workspaces", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ workspaceIds: ids }),
					});
					const removed = (data.results ?? []).filter((item) => item.ok).length;
					flash(`已删除 ${removed} 个空工作区条目（目录未动）`);
					await loadCleanup();
					await loadScan(source);
				} catch (error) {
					flash(`清理失败：${String(error?.message ?? error)}`);
				} finally {
					setBusy("");
				}
			};

			const sourceCards = ["codex", "claude"].map((id) => {
				const info = sources?.[id];
				const active = source === id;
				return h(
					"button",
					{
						key: id,
						type: "button",
						onClick: () => void switchSource(id),
						style: {
							flex: "1 1 240px",
							textAlign: "left",
							padding: "10px 12px",
							borderRadius: 10,
							border: `1px solid ${active ? ACCENT : LINE}`,
							background: CARD,
							color: LABEL,
							cursor: "pointer",
							font: "inherit",
						},
					},
					h("div", { style: { fontWeight: 600, fontSize: 13 } }, info?.label ?? (id === "codex" ? "Codex App" : "Claude Code")),
					h(
						"div",
						{ style: { color: MUTED, fontSize: 11, marginTop: 3 } },
						info === undefined
							? "尚未扫描"
							: `${info.sessions ?? 0} 个会话 · ${info.projects ?? 0} 个项目 · ${bytesLabel(info.bytes)}`,
					),
					h("div", { style: { color: FAINT, fontSize: 11, marginTop: 2, wordBreak: "break-all" } }, info?.root ?? ""),
					info?.lastScanAt !== undefined && info?.lastScanAt !== null
						? h("div", { style: { color: FAINT, fontSize: 10, marginTop: 2 } }, `上次扫描 ${timeLabel(info.lastScanAt)}`)
						: null,
				);
			});

			const projectRows = projects.map((project) => {
				const open = expanded.has(project.cwd);
				const matched = project.matchedWorkspace;
				const allInProject = project.sessions.length > 0 && project.sessions.every((session) => selected.has(session.sourcePath));
				const importedCount = project.sessions.filter((session) => session.imported).length;
				return h(
					"div",
					{ key: project.cwd, style: { borderTop: `1px solid ${LINE}`, padding: "8px 0" } },
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
						h(Checkbox, { checked: allInProject, onChange: (checked) => toggleProject(project, checked) }),
						h(
							"button",
							{
								type: "button",
								onClick: () => expandProject(project.cwd),
								style: { border: 0, background: "transparent", color: MUTED, cursor: "pointer", width: 18, fontSize: 12 },
								title: open ? "收起" : "展开",
							},
							open ? "▾" : "▸",
						),
						h("span", { style: { fontSize: 12, color: LABEL, wordBreak: "break-all", flex: "1 1 260px" } }, project.cwd),
						h("span", { style: { fontSize: 11, color: MUTED } }, `${project.count} 个 · ${bytesLabel(project.bytes)}`),
						importedCount > 0 ? Badge(`已导入 ${importedCount}`, "good") : null,
						matched !== null ? Badge(`并入现有工作区「${matched.title}」`, "good") : Badge("新建工作区", "plain"),
					),
					open
						? h(
								"div",
								{ style: { margin: "6px 0 0 26px", display: "grid", gap: 4 } },
								project.sessions.map((session) =>
									h(
										"div",
										{ key: session.sourcePath, style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
										h(Checkbox, {
											checked: selected.has(session.sourcePath),
											disabled: session.imported === true,
											onChange: (checked) => toggleSession(session.sourcePath, checked),
										}),
										h("span", { style: { fontSize: 12, color: session.imported ? MUTED : LABEL } }, session.title),
										h("span", { style: { fontSize: 10, color: FAINT } }, timeLabel(session.mtime)),
										h("span", { style: { fontSize: 10, color: FAINT } }, bytesLabel(session.bytes)),
										h("span", { style: { fontSize: 10, color: FAINT } }, session.turns === null ? "轮次未知" : `${session.turns} 轮`),
										session.imported ? Badge("已导入", "plain") : null,
										session.huge ? Badge("超大", "warn") : null,
									),
								),
							)
						: null,
				);
			});

			const modeRow = (value, title, hint, disabled = false) =>
				h(
					"label",
					{
						style: {
							display: "flex",
							gap: 8,
							alignItems: "flex-start",
							padding: "6px 0",
							cursor: disabled ? "not-allowed" : "pointer",
							opacity: disabled ? 0.5 : 1,
						},
					},
					h("input", {
						type: "radio",
						name: "import-mode",
						checked: mode === value,
						disabled,
						onChange: () => setMode(value),
						style: { marginTop: 2, accentColor: ACCENT },
					}),
					h(
						"span",
						null,
						h("div", { style: { fontSize: 12, color: LABEL } }, title),
						h("div", { style: { fontSize: 11, color: FAINT, marginTop: 2 } }, hint),
					),
				);

			return h(
				"div",
				{ style: { display: "grid", gap: 4 } },
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 } },
					h("h2", { style: { margin: 0, fontSize: 16, color: LABEL } }, "导入"),
					h(
						"button",
						{
							type: "button",
							disabled: busy !== "",
							onClick: () => void refreshAll(source),
							style: {
								marginLeft: "auto",
								padding: "5px 12px",
								borderRadius: 7,
								border: `1px solid ${LINE}`,
								background: "transparent",
								color: LABEL,
								fontSize: 12,
								cursor: busy === "" ? "pointer" : "default",
							},
						},
						busy === "scan" ? "检查中…" : "再次检查",
					),
				),
				h(
					"p",
					{ style: { margin: "0 0 12px", color: MUTED, fontSize: 12, lineHeight: 1.6 } },
					"把 Codex App / Claude Code 的历史会话导入为 DSH 会话。默认生成交接摘要（最近工作 + 变更记录），完整转录需手动选择；项目路径与已有工作区一致时归并到同一项目。",
				),
				h("div", { style: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 } }, sourceCards),
				Section(
					"要同步的内容",
					null,
					h(
						"div",
						{ style: { display: "grid", gap: 6 } },
						h(
							"label",
							{ style: { display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: LABEL } },
							h("input", { type: "checkbox", checked: true, readOnly: true, style: { accentColor: ACCENT } }),
							"会话（历史对话与工具调用记录）",
						),
						["设置", "技能", "插件", "MCP", "命令"].map((label) =>
							h(
								"label",
								{ key: label, style: { display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: FAINT } },
								h("input", { type: "checkbox", disabled: true }),
								`${label}（暂不支持：来源应用的配置无法可靠映射到 DSH）`,
							),
						),
					),
				),
				Section(
					"迁移方式",
					null,
					modeRow("handoff", "摘要 + 最近工作（推荐）", "只写入交接摘要：项目目标、最近 8 轮、变更与命令、下一步；token 友好。"),
					modeRow("full", "完整转录", "逐轮重建 user/assistant 消息（最多最近 200 轮，单条截断）；已验证可通过 DSH v4 校验。超大会话会显著增加上下文占用。"),
				),
				Section(
					`项目（${projects.length}）`,
					h(
						"div",
						{ style: { display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: MUTED } },
						h("span", null, `已选 ${selected.size}`),
						h(
							"button",
							{
								type: "button",
								onClick: () => setSelected(new Set(selectable.filter((session) => !session.imported).map((session) => session.sourcePath))),
								style: { border: 0, background: "transparent", color: ACCENT, cursor: "pointer", fontSize: 11 },
							},
							"全选",
						),
						h(
							"button",
							{
								type: "button",
								onClick: () => setSelected(new Set()),
								style: { border: 0, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 11 },
							},
							"清空",
						),
					),
					scan === null
						? h("div", { style: { color: FAINT, fontSize: 12 } }, "正在扫描…")
						: projects.length === 0
							? h("div", { style: { color: FAINT, fontSize: 12 } }, "没有找到会话")
							: h("div", null, projectRows),
				),
				h(
					"div",
					{ style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" } },
					h(
						"button",
						{
							type: "button",
							onClick: () => void doPreview(),
							disabled: busy !== "" || selected.size === 0,
							style: { padding: "6px 12px", borderRadius: 7, border: `1px solid ${LINE}`, background: "transparent", color: LABEL, fontSize: 12, cursor: "pointer" },
						},
						"预览交接书",
					),
					h(
						"button",
						{
							type: "button",
							onClick: () => void doImport(),
							disabled: busy !== "" || selected.size === 0,
							style: {
								padding: "6px 14px",
								borderRadius: 7,
								border: `1px solid ${ACCENT}`,
								background: ACCENT,
								color: "#fff",
								fontSize: 12,
								cursor: selected.size === 0 ? "default" : "pointer",
								opacity: selected.size === 0 ? 0.5 : 1,
							},
						},
						busy === "import" ? "导入中…" : `开始导入（${selected.size}）`,
					),
					notice.length > 0 ? h("span", { style: { fontSize: 11, color: MUTED } }, notice) : null,
				),
				preview !== null
					? Section(
							`交接书预览 · ${preview.title}`,
							h(
								"button",
								{
									type: "button",
									onClick: () => setPreview(null),
									style: { border: 0, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 12 },
								},
								"关闭",
							),
							h(
								"pre",
								{
									style: {
										margin: 0,
										maxHeight: 280,
										overflow: "auto",
										whiteSpace: "pre-wrap",
										fontSize: 11,
										lineHeight: 1.6,
										color: MUTED,
										background: CARD,
										borderRadius: 8,
										padding: 10,
									},
								},
								preview.handoff ?? "",
							),
						)
					: null,
				results !== null
					? Section(
							"导入结果",
							null,
							h(
								"div",
								{ style: { display: "grid", gap: 4 } },
								results.map((result) =>
									h(
										"div",
										{ key: `${result.sourcePath}-${result.sessionId ?? "x"}`, style: { fontSize: 11, color: result.ok ? MUTED : BAD } },
										`${result.ok ? "✓" : "✗"} ${result.title ?? result.sourcePath}${result.ok ? ` → ${result.workspace?.title ?? result.workspaceId}${result.workspace?.created ? "（新建）" : "（并入）"}` : `：${result.reason ?? ""}`}`,
									),
								),
							),
						)
					: null,
				Section(
					"导入历史",
					h(
						"button",
						{
							type: "button",
							onClick: () => void loadHistory(),
							style: { border: 0, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 11 },
						},
						"刷新",
					),
					history.length === 0
						? h("div", { style: { color: FAINT, fontSize: 12 } }, "还没有导入记录")
						: h(
								"div",
								{ style: { display: "grid", gap: 6 } },
								history.map((batch) =>
									h(
										"div",
										{ key: batch.batch, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: MUTED, flexWrap: "wrap" } },
										h("span", { style: { color: LABEL } }, timeLabel(batch.at)),
										h("span", null, `${batch.source === "claude" ? "Claude Code" : batch.source === "mixed" ? "历史记录" : "Codex App"} · ${batch.count} 个`),
										h(
											"button",
											{
												type: "button",
												disabled: busy !== "",
												onClick: () => void rollbackBatch(batch),
												style: { marginLeft: "auto", border: `1px solid ${LINE}`, background: "transparent", color: MUTED, borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" },
											},
											"回滚本批",
										),
									),
								),
							),
				),
				Section(
					"清理空工作区",
					h(
						"button",
						{
							type: "button",
							onClick: () => void loadCleanup(),
							style: { border: 0, background: "transparent", color: MUTED, cursor: "pointer", fontSize: 11 },
						},
						"刷新",
					),
					cleanup === null
						? h("div", { style: { color: FAINT, fontSize: 12 } }, "检查中…")
						: cleanup.length === 0
							? h("div", { style: { color: FAINT, fontSize: 12 } }, "没有 0 会话的空工作区")
							: h(
									"div",
									{ style: { display: "grid", gap: 6 } },
									cleanup.map((candidate) =>
										h(
											"div",
											{ key: candidate.id, style: { display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: MUTED, flexWrap: "wrap" } },
											h("span", { style: { color: LABEL } }, candidate.title),
											h("span", { style: { wordBreak: "break-all" } }, candidate.path),
											candidate.createdByImport ? Badge("导入创建", "good") : Badge("空项目", "plain"),
											h(
												"button",
												{
													type: "button",
													onClick: () => void deleteWorkspaces([candidate.id]),
													style: { marginLeft: "auto", border: `1px solid ${LINE}`, background: "transparent", color: BAD, borderRadius: 6, padding: "2px 8px", fontSize: 11, cursor: "pointer" },
												},
												"删除条目",
											),
										),
									),
								),
					h("div", { style: { color: FAINT, fontSize: 10, marginTop: 6 } }, "只删除工作区条目，不会删除磁盘目录或其中的文件。"),
				),
			);
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "codex-import",
						order: 63,
						label: () => "导入",
					},
					ImportPage,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
