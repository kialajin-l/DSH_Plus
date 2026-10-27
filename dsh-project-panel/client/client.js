window.__ModuleLoader__.load({
	id: "dsh-project-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-project-panel";
		const inject = ["slots", "locale"];
		const API = "/project-panel/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.06))";
		const GOOD = "var(--dsw-alias-state-success-primary, #3fa76b)";
		const BAD = "var(--dsw-alias-state-danger-primary, #d36268)";
		const WARN = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const INFO = "#5b8def";

		const STATUS_META = {
			active: { label: "推进中", color: GOOD },
			slowing: { label: "放缓", color: WARN },
			idle: { label: "沉寂", color: FAINT },
			blocked: { label: "阻塞", color: BAD },
			paused: { label: "暂缓", color: MUTED },
			done: { label: "达成", color: INFO },
			unknown: { label: "未知", color: FAINT },
		};

		function statusMeta(status) {
			return STATUS_META[status] ?? { label: status ?? "未知", color: FAINT };
		}

		function clock(ms) {
			if (!Number.isFinite(ms)) return "—";
			try {
				return new Date(ms).toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
			} catch {
				return "—";
			}
		}

		function useScan() {
			const [state, setState] = React.useState({ status: "loading" });
			const load = React.useCallback(async () => {
				setState((previous) => (previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" }));
				try {
					const response = await fetch(`${API}/scan`, { cache: "no-store" });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "请求失败");
					setState({ status: "ready", data: body });
				} catch (error) {
					setState({ status: "error", message: String(error?.message ?? error) });
				}
			}, []);
			React.useEffect(() => {
				void load();
			}, [load]);
			return { state, load };
		}

		function StatCard({ label, value, color }) {
			return h(
				"div",
				{
					style: {
						flex: "1 1 100px",
						minWidth: 0,
						boxSizing: "border-box",
						overflow: "hidden",
						padding: "10px 12px",
						border: `1px solid ${LINE}`,
						borderRadius: 10,
						background: PANEL,
					},
				},
				h("div", { style: { color: MUTED, fontSize: 12 } }, label),
				h(
					"div",
					{ style: { color: color ?? LABEL, fontSize: 22, fontWeight: 600, marginTop: 4, fontVariantNumeric: "tabular-nums" } },
					value,
				),
			);
		}

		function StatusBadge({ status }) {
			const meta = statusMeta(status);
			return h(
				"span",
				{
					style: {
						flex: "0 0 auto",
						padding: "1px 8px",
						borderRadius: 999,
						fontSize: 11,
						color: meta.color,
						border: `1px solid ${meta.color}`,
						whiteSpace: "nowrap",
					},
				},
				meta.label,
			);
		}

		function SourceBadge({ source }) {
			const isAnchor = source === "anchor";
			return h(
				"span",
				{
					style: {
						flex: "0 0 auto",
						padding: "1px 7px",
						borderRadius: 4,
						fontSize: 11,
						color: isAnchor ? INFO : FAINT,
						border: `1px solid ${isAnchor ? INFO : LINE}`,
						whiteSpace: "nowrap",
					},
				},
				isAnchor ? "锚点" : "推断",
			);
		}

		function Field({ label, value, color }) {
			if (value === null || value === undefined || String(value).length === 0) return null;
			return h(
				"div",
				{ style: { display: "flex", gap: 6, minWidth: 0 } },
				h("span", { style: { flex: "0 0 auto", color: FAINT, fontSize: 11 } }, label),
				h(
					"span",
					{ style: { flex: "1 1 auto", minWidth: 0, color: color ?? MUTED, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
					String(value),
				),
			);
		}

		function ProjectCard({ project }) {
			const meta = statusMeta(project.status);
			return h(
				"div",
				{
					style: {
						width: "100%",
						maxWidth: "100%",
						minWidth: 0,
						boxSizing: "border-box",
						overflow: "hidden",
						padding: "10px 12px",
						border: `1px solid ${LINE}`,
						borderRadius: 10,
						background: PANEL,
						display: "grid",
						gap: 5,
					},
				},
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } },
					h(
						"span",
						{ style: { flex: "1 1 auto", minWidth: 0, color: LABEL, fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
						project.name,
					),
					h(StatusBadge, { status: project.status }),
					h(SourceBadge, { source: project.source }),
				),
				project.phase ? h(Field, { label: "阶段", value: project.phase, color: LABEL }) : null,
				project.currentTask ? h(Field, { label: "在办", value: project.currentTask }) : null,
				project.nextStep ? h(Field, { label: "下一步", value: project.nextStep }) : null,
				project.description ? h(Field, { label: "简介", value: project.description, color: FAINT }) : null,
				project.blockers.length > 0
					? h(
							"div",
							{ style: { display: "grid", gap: 2, minWidth: 0 } },
							project.blockers.map((blocker, index) =>
								h(Field, { key: index, label: "阻塞", value: blocker, color: BAD }),
							),
						)
					: null,
				h(
					"div",
					{ style: { display: "flex", gap: 10, flexWrap: "wrap", minWidth: 0, color: FAINT, fontSize: 11 } },
					h("span", null, `更新${project.daysSince === null ? "：未知" : `：${project.daysSince} 天前`}`),
					project.lastCommit ? h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 } }, `提交：${project.lastCommit}`) : null,
					project.anchorError ? h("span", { style: { color: BAD } }, `锚点错误：${project.anchorError}`) : null,
				),
			);
		}

		function ProjectPanel({ load, state }) {
			// Hooks must run on every render: keep filter state above the early returns.
			const [filter, setFilter] = React.useState("all");
			const [exportMsg, setExportMsg] = React.useState(null);
			const exportHtml = React.useCallback(async () => {
				setExportMsg({ kind: "muted", text: "导出中…" });
				try {
					const response = await fetch(`${API}/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
					const body = await response.json();
					if (!body.ok) throw new Error(body.error ?? "导出失败");
					setExportMsg({ kind: "ok", text: `已导出: ${body.file}` });
				} catch (error) {
					setExportMsg({ kind: "bad", text: String(error?.message ?? error) });
				}
			}, []);
			if (state.status === "loading") {
				return h("div", { style: { color: MUTED, fontSize: 12, padding: "12px 0" } }, "扫描中…");
			}
			if (state.status === "error") {
				return h(
					"div",
					{ style: { display: "grid", gap: 8, padding: "12px 0" } },
					h("div", { style: { color: BAD, fontSize: 12 } }, `扫描失败：${state.message}`),
					h(
						"button",
						{
							type: "button",
							onClick: () => void load(),
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
						"重试",
					),
				);
			}
			const data = state.data;
			const projects = Array.isArray(data.projects) ? data.projects : [];
			const counts = data.counts ?? {};
			const order = ["active", "slowing", "idle", "blocked", "paused", "done", "unknown"];
			const visible = filter === "all" ? projects : projects.filter((project) => project.status === filter);
			const chips = [
				{ key: "all", label: `全部 ${projects.length}` },
				...order.filter((status) => (counts[status] ?? 0) > 0).map((status) => ({ key: status, label: `${statusMeta(status).label} ${counts[status]}` })),
			];
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
					h("div", null, h("h2", { style: { margin: 0, fontSize: 16, color: LABEL } }, "项目进度")),
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 } },
						h("span", { style: { color: FAINT, fontSize: 11 } }, `更新于 ${clock(data.generatedAt)}${data.cached ? "（缓存）" : ""}`),
						exportMsg !== null
							? h(
									"span",
									{ style: { color: exportMsg.kind === "bad" ? BAD : exportMsg.kind === "ok" ? GOOD : FAINT, fontSize: 11, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: exportMsg.text },
									exportMsg.text,
								)
							: null,
						h(
							"button",
							{
								type: "button",
								onClick: () => void exportHtml(),
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
							"导出 HTML",
						),
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
				h(
					"div",
					{ style: { display: "flex", gap: 12, flexWrap: "wrap" } },
					h(StatCard, { label: "项目总数", value: projects.length }),
					h(StatCard, { label: "推进中", value: counts.active ?? 0, color: GOOD }),
					h(StatCard, { label: "放缓", value: counts.slowing ?? 0, color: WARN }),
					h(StatCard, { label: "沉寂", value: counts.idle ?? 0, color: FAINT }),
					h(StatCard, { label: "阻塞", value: counts.blocked ?? 0, color: BAD }),
				),
				h(
					"div",
					{ style: { display: "flex", gap: 6, flexWrap: "wrap", minWidth: 0 } },
					chips.map((chip) =>
						h(
							"button",
							{
								key: chip.key,
								type: "button",
								onClick: () => setFilter(chip.key),
								style: {
									padding: "3px 10px",
									borderRadius: 999,
									border: `1px solid ${filter === chip.key ? WARN : LINE}`,
									background: filter === chip.key ? "rgba(212,154,67,.12)" : "transparent",
									color: filter === chip.key ? WARN : MUTED,
									font: "inherit",
									fontSize: 11,
									cursor: "pointer",
									whiteSpace: "nowrap",
								},
							},
							chip.label,
						),
					),
				),
				visible.length === 0
					? h("div", { style: { color: FAINT, fontSize: 12 } }, "没有匹配的项目")
					: h(
							"div",
							{ style: { display: "grid", gap: 10, minWidth: 0 } },
							visible.map((project) => h(ProjectCard, { key: `${project.path}`, project })),
						),
				h(
					"div",
					{ style: { color: FAINT, fontSize: 11, lineHeight: 1.6 } },
					`扫描根：${(data.roots ?? []).join("、")}。锚点=项目根 status.json（最高优先级）；推断=git 最近提交 / 证据文件 / 进度文档启发式（≤14 天活跃，≤45 天放缓）。agent 收口时更新项目根 status.json 即可让面板永远指向最新事实。数据只读本地磁盘，不产生模型调用。`,
				),
			);
		}

		function Panel(props) {
			const { state, load } = useScan();
			return h(ProjectPanel, { ...props, state, load });
		}

		function apply(ctx) {
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "project-panel",
						order: 67,
						label: () => "项目进度",
					},
					Panel,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
