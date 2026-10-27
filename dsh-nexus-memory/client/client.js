window.__ModuleLoader__.load({
	id: "dsh-nexus-memory",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");
		const h = React.createElement;
		const name = "dsh-nexus-memory";
		const inject = ["slots"];
		const API = "/nexus-memory/api";
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1d21))";
		const HOVER = "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12))";
		const ACCENT = "var(--dsw-alias-state-success-primary, #3fa76b)";
		const WARN = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const TYPE_LABELS = {
			fact: "事实",
			decision: "决策",
			preference: "偏好",
			rule: "规则",
			todo: "待办",
			pattern: "模式",
		};
		const TYPE_TONES = {
			fact: "var(--dsw-alias-label-secondary, #9aa0a6)",
			decision: "var(--dsw-alias-state-success-primary, #3fa76b)",
			preference: "var(--dsw-alias-state-warning-primary, #d49a43)",
			rule: "var(--dsw-alias-state-danger-primary, #d36268)",
			todo: "var(--dsw-alias-state-info-primary, #5b8def)",
			pattern: "var(--dsw-alias-state-info-primary, #5b8def)",
		};
		function typeLabel(type) {
			return TYPE_LABELS[type] ?? type ?? "未知";
		}
		function chip(text, tone) {
			return h(
				"span",
				{
					style: {
						display: "inline-flex",
						alignItems: "center",
						padding: "1px 7px",
						borderRadius: 9,
						border: `1px solid ${tone ?? LINE}`,
						color: tone ?? MUTED,
						fontSize: 11,
						lineHeight: "16px",
						whiteSpace: "nowrap",
					},
				},
				text,
			);
		}
		function button(label, onClick, options) {
			const opts = options ?? {};
			return h(
				"button",
				{
					type: "button",
					onClick,
					disabled: opts.disabled === true,
					title: opts.title,
					style: {
						minHeight: 30,
						padding: "0 12px",
						borderRadius: 7,
						border: `1px solid ${opts.primary ? ACCENT : LINE}`,
						background: opts.primary ? ACCENT : "transparent",
						color: opts.primary ? "#fff" : LABEL,
						font: "inherit",
						fontSize: 12,
						cursor: opts.disabled === true ? "default" : "pointer",
						opacity: opts.disabled === true ? 0.5 : 1,
						whiteSpace: "nowrap",
					},
				},
				label,
			);
		}
		function input(value, onChange, placeholder) {
			return h("input", {
				type: "text",
				value,
				placeholder,
				onChange: (event) => onChange(event.target.value),
				style: {
					flex: 1,
					minWidth: 0,
					minHeight: 32,
					padding: "0 9px",
					border: `1px solid ${LINE}`,
					borderRadius: 7,
					background: "transparent",
					color: LABEL,
					font: "inherit",
					fontSize: 12,
					outline: "none",
				},
			});
		}
		function selectField(value, onChange, options, width) {
			return h(
				"select",
				{
					value,
					onChange: (event) => onChange(event.target.value),
					style: {
						minHeight: 30,
						padding: "0 8px",
						border: `1px solid ${LINE}`,
						borderRadius: 7,
						background: PANEL,
						color: LABEL,
						font: "inherit",
						fontSize: 12,
						maxWidth: width ?? 220,
						outline: "none",
					},
				},
				options.map((option) => h("option", { key: option.value, value: option.value }, option.label)),
			);
		}
		function statText(stats) {			if (stats === undefined || stats === null) return "统计加载中…";
			const types = Object.entries(stats.byType ?? {})
				.map(([type, count]) => `${typeLabel(type)} ${Number(count).toLocaleString()}`)
				.join(" · ");
			return `共 ${Number(stats.total ?? 0).toLocaleString()} 条${types ? ` · ${types}` : ""}`;
		}
		function NexusMemorySettings() {
			const [db, setDb] = React.useState("primary");
			const [stats, setStats] = React.useState(null);
			const [statsError, setStatsError] = React.useState("");
			const [statsTick, setStatsTick] = React.useState(0);
			const [query, setQuery] = React.useState("");
			const [results, setResults] = React.useState(null);
			const [searching, setSearching] = React.useState(false);
			const [searchError, setSearchError] = React.useState("");
			const [feedback, setFeedback] = React.useState({});
			const [expanded, setExpanded] = React.useState({});
			const [autoInject, setAutoInject] = React.useState(true);
			const [toast, setToast] = React.useState("");
			const [configInfo, setConfigInfo] = React.useState(null);
			const [pathDraft, setPathDraft] = React.useState({ primaryDb: "", codeDb: "" });
			const [configBusy, setConfigBusy] = React.useState("");
			const [probeBusy, setProbeBusy] = React.useState({});
			const [extractDefaults, setExtractDefaults] = React.useState({ mode: "rules", provider: "", model: "" });
			const [modelProviders, setModelProviders] = React.useState(null);
			const aliveRef = React.useRef(true);
			React.useEffect(() => {
				aliveRef.current = true;
				return () => {
					aliveRef.current = false;
				};
			}, []);
			const loadConfigInfo = React.useCallback(async () => {
				try {
					const response = await fetch(`${API}/config`, { cache: "no-store" });
					const data = await response.json();
					if (data?.ok !== true || !aliveRef.current) return;
					setConfigInfo(data);
					setPathDraft({ primaryDb: data.config.primaryDb, codeDb: data.config.codeDb });
					if (typeof data.autoInject === "boolean") setAutoInject(data.autoInject);
					if (data?.config?.extractDefaults) setExtractDefaults(data.config.extractDefaults);
				} catch {
					/* keep the page usable without config */
				}
			}, []);
			React.useEffect(() => {
				let alive = true;
				fetch(`${API}/models`, { cache: "no-store" })
					.then((response) => response.json())
					.then((data) => {
						if (alive && data?.ok === true) setModelProviders(Array.isArray(data.providers) ? data.providers : []);
					})
					.catch(() => {
						/* model list is optional */
					});
				return () => {
					alive = false;
				};
			}, []);
			React.useEffect(() => {
				void loadConfigInfo();
			}, [loadConfigInfo]);
			React.useEffect(() => {
				let alive = true;
				setStats(null);
				setStatsError("");
				fetch(`${API}/stats?db=${db}`, { cache: "no-store" })
					.then((response) => response.json())
					.then((data) => {
						if (!alive) return;
						if (data?.ok === true) setStats(data);
						else setStatsError(String(data?.error ?? "统计读取失败"));
					})
					.catch((error) => {
						if (alive) setStatsError(String(error?.message ?? error));
					});
				return () => {
					alive = false;
				};
			}, [db, statsTick]);
			React.useEffect(() => {
				if (toast.length === 0) return undefined;
				const timer = setTimeout(() => setToast(""), 2600);
				return () => clearTimeout(timer);
			}, [toast]);
			const statusOf = (which) => configInfo?.status?.[which];
			const isUninitialized = (which) => {
				const status = statusOf(which);
				return status !== undefined && status.valid !== true;
			};
			const bothUninitialized =
				configInfo !== null && isUninitialized("primary") && isUninitialized("code");
			const pathFor = (which) => (which === "code" ? "codeDb" : "primaryDb");
			const runSearch = async () => {
				const text = query.trim();
				if (text.length === 0 || searching) return;
				if (isUninitialized(db)) {
					setResults([]);
					setSearchError("记忆库尚未初始化，可在下方「数据库位置」里创建空库。");
					return;
				}
				setSearching(true);
				setSearchError("");
				try {
					const response = await fetch(`${API}/search`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ db, query: text, topK: 8 }),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "搜索失败"));
					setResults(Array.isArray(data.results) ? data.results : []);
					if (data.uninitialized === true) setSearchError("记忆库尚未初始化，可在下方创建空库。");
				} catch (error) {
					setSearchError(String(error?.message ?? error));
					setResults([]);
				} finally {
					setSearching(false);
				}
			};
			const sendFeedback = async (id, action) => {
				setFeedback((state) => ({ ...state, [id]: "sending" }));
				try {
					const response = await fetch(`${API}/feedback`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ db, id, action }),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "反馈失败"));
					setFeedback((state) => ({ ...state, [id]: action }));
					setToast(action === "accepted" ? "已记为有用" : "已记为没用");
				} catch (error) {
					setFeedback((state) => ({ ...state, [id]: "error" }));
					setToast(String(error?.message ?? error));
				}
			};
			const savePaths = async (payload) => {
				setConfigBusy("save");
				try {
					const response = await fetch(`${API}/config`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "保存失败"));
					setConfigInfo(data);
					setPathDraft({ primaryDb: data.config.primaryDb, codeDb: data.config.codeDb });
					setStatsTick((value) => value + 1);
					setToast("已保存");
				} catch (error) {
					setToast(String(error?.message ?? error));
				} finally {
					setConfigBusy("");
				}
			};
			const probePath = async (which) => {
				const key = pathFor(which);
				setProbeBusy((state) => ({ ...state, [which]: true }));
				try {
					const response = await fetch(`${API}/config/probe?path=${encodeURIComponent(pathDraft[key])}`, {
						cache: "no-store",
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "探测失败"));
					if (!aliveRef.current) return;
					setConfigInfo((previous) =>
						previous === null
							? previous
							: {
									...previous,
									status: {
										...previous.status,
										[which]: {
											exists: data.exists === true,
											valid: data.valid === true,
											total: Number(data.total ?? 0),
											...(typeof data.error === "string" ? { error: data.error } : {}),
										},
									},
								},
					);
					setToast(data.valid === true ? `路径可读 · ${Number(data.total ?? 0).toLocaleString()} 条` : data.exists ? "路径存在但不是有效记忆库" : "路径不存在");
				} catch (error) {
					setToast(String(error?.message ?? error));
				} finally {
					setProbeBusy((state) => ({ ...state, [which]: false }));
				}
			};
			const createDb = async (which) => {
				setConfigBusy(`create-${which}`);
				try {
					const response = await fetch(`${API}/config/create`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ db: which }),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "创建失败"));
					setToast("已创建空记忆库");
					await loadConfigInfo();
					setStatsTick((value) => value + 1);
				} catch (error) {
					setToast(String(error?.message ?? error));
				} finally {
					setConfigBusy("");
				}
			};
			const header = h(
				"header",
				{ style: { display: "grid", gap: 6, marginBottom: 14 } },
				h("h2", { style: { margin: 0, fontSize: 18 } }, "长期记忆"),
				h(
					"p",
					{ style: { margin: 0, color: MUTED, fontSize: 12, lineHeight: 1.7 } },
					"接通你自己的 Nexus 记忆库（只读）。搜索历史事实、决策与偏好；「有用 / 没用」会写入一条反馈记录，不会修改正文内容。",
				),
			);
			const dbSwitch = h(
				"div",
				{ style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
				["primary", "code"].map((value) =>
					button(
						value === "primary" ? "主库 primary" : "代码库 code",
						() => {
							if (value === db) return;
							setDb(value);
							setResults(null);
							setSearchError("");
						},
						{ primary: value === db },
					),
				),
				h("span", { style: { color: FAINT, fontSize: 11, marginLeft: 4 } }, statsError.length > 0 ? statsError : statText(stats)),
			);
			const statusBadge = (which) => {
				const status = statusOf(which);
				if (status === undefined) return chip("检测中…", MUTED);
				if (status.valid === true) return chip(`可读 · ${Number(status.total ?? 0).toLocaleString()} 条`, ACCENT);
				if (status.exists === true) return chip(`无效：${status.error ?? "无法读取"}`, WARN);
				return chip("不存在", MUTED);
			};
			const pathRow = (which, titleText) => {
				const key = pathFor(which);
				return h(
					"div",
					{ style: { display: "grid", gap: 6, padding: "10px 0", borderTop: `1px solid ${LINE}` } },
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
						h("strong", { style: { fontSize: 12 } }, titleText),
						statusBadge(which),
						statusOf(which)?.valid === true ? null : button(
							configBusy === `create-${which}` ? "创建中…" : "创建空库",
							() => void createDb(which),
							{ disabled: configBusy.length > 0 },
						),
					),
					h(
						"div",
						{ style: { display: "flex", gap: 8, alignItems: "center" } },
						input(pathDraft[key], (value) => setPathDraft((state) => ({ ...state, [key]: value })), "绝对路径，例如 D:\\knowledge\\nexus.db"),
						button(probeBusy[which] === true ? "检测中…" : "检测", () => void probePath(which), {
							disabled: probeBusy[which] === true,
						}),
					),
				);
			};
			const dbLocation = h(
				"section",
				{
					style: {
						display: "grid",
						gap: 4,
						padding: "10px 12px",
						border: `1px solid ${LINE}`,
						borderRadius: 9,
						background: PANEL,
						marginBottom: 12,
					},
				},
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" } },
					h("strong", { style: { fontSize: 12 } }, "数据库位置"),
					h("span", { style: { color: FAINT, fontSize: 11 } }, configInfo?.configPath ?? "配置读取中…"),
					h("span", { style: { flex: 1 } }),
					button("恢复默认", () => void savePaths({
						primaryDb: configInfo?.defaults?.primaryDb,
						codeDb: configInfo?.defaults?.codeDb,
					}), { disabled: configInfo === null || configBusy.length > 0 }),
					button(configBusy === "save" ? "保存中…" : "保存路径", () => void savePaths({
						primaryDb: pathDraft.primaryDb,
						codeDb: pathDraft.codeDb,
					}), { primary: true, disabled: configInfo === null || configBusy.length > 0 }),
				),
				pathRow("primary", "主库 primary"),
				pathRow("code", "代码库 code"),
				h(
					"p",
					{ style: { margin: "6px 0 0", color: FAINT, fontSize: 11, lineHeight: 1.6 } },
					"路径保存在 DSH home 的 storages/nexus-memory.json。指向不存在的位置是允许的，可点「创建空库」生成一个与 Nexus 技能兼容的空库。",
				),
			);
			const uninitializedBanner = bothUninitialized
				? h(
						"div",
						{
							style: {
								display: "flex",
								alignItems: "center",
								gap: 10,
								flexWrap: "wrap",
								padding: "10px 12px",
								marginBottom: 12,
								border: `1px solid ${WARN}`,
								borderRadius: 9,
								background: "transparent",
								color: MUTED,
								fontSize: 12,
							},
						},
						h("span", null, "记忆库尚未初始化。可以指到你已有的 Nexus 库，或直接创建一个空库开始积累。"),
						button(configBusy === "create-primary" ? "创建中…" : "创建主库", () => void createDb("primary"), {
							primary: true,
							disabled: configBusy.length > 0,
						}),
					)
				: null;
			const toggle = h(
				"label",
				{
					style: {
						display: "flex",
						alignItems: "center",
						gap: 10,
						padding: "10px 12px",
						border: `1px solid ${LINE}`,
						borderRadius: 8,
						background: PANEL,
						cursor: "pointer",
					},
				},
				h("input", {
					type: "checkbox",
					checked: autoInject,
					onChange: (event) => setAutoInject(event.target.checked),
					style: { width: 16, height: 16, accentColor: ACCENT },
				}),
				h(
					"span",
					{ style: { display: "grid", gap: 2 } },
					h("strong", { style: { fontSize: 12 } }, "新会话自动注入项目记忆"),
					h(
						"small",
						{ style: { color: FAINT, fontSize: 11 } },
						"默认开启：按工作区匹配 Nexus project，每次最多注入 4 条、约 500 tokens。此处开关仅影响本页面显示，实际注入由插件配置 autoInject 控制。",
					),
				),
			);
			const providerOptions = (modelProviders ?? [])
				.filter((entry) => Array.isArray(entry.models) && entry.models.length > 0)
				.map((entry) => ({ value: entry.id, label: entry.displayName }));
			const defaultsProvider = (modelProviders ?? []).find((entry) => entry.id === extractDefaults.provider);
			const modelOptions = (defaultsProvider?.models ?? []).map((entry) => ({ value: entry.id, label: entry.name }));
			const extractDefaultsBlock = h(
				"div",
				{
					style: {
						display: "grid",
						gap: 8,
						padding: "10px 12px",
						border: `1px solid ${LINE}`,
						borderRadius: 8,
						background: PANEL,
						marginTop: 10,
					},
				},
				h(
					"div",
					{ style: { display: "grid", gap: 2 } },
					h("strong", { style: { fontSize: 12 } }, "提取默认设置"),
					h(
						"small",
						{ style: { color: FAINT, fontSize: 11 } },
						"「记忆」面板打开时的默认模式与模型；规则提取不消耗 token。",
					),
				),
				h(
					"div",
					{ style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } },
					selectField(
						extractDefaults.mode,
						(value) => setExtractDefaults((state) => ({ ...state, mode: value })),
						[
							{ value: "rules", label: "轻量规则提取（默认）" },
							{ value: "model", label: "模型提取" },
						],
						180,
					),
					extractDefaults.mode === "model"
						? selectField(
								extractDefaults.provider,
								(value) => setExtractDefaults((state) => ({ ...state, provider: value, model: "" })),
								[{ value: "", label: "选择提供方" }, ...providerOptions],
								160,
							)
						: null,
					extractDefaults.mode === "model"
						? selectField(
								extractDefaults.model,
								(value) => setExtractDefaults((state) => ({ ...state, model: value })),
								[{ value: "", label: "选择模型" }, ...modelOptions],
								180,
							)
						: null,
					button(
						"保存默认",
						() => {
							void savePaths({ extractDefaults });
						},
						{ disabled: configBusy === "save" },
					),
				),
			);
			const searchBox = h(				"div",
				{ style: { display: "flex", gap: 8, margin: "14px 0" } },
				h("input", {
					type: "search",
					value: query,
					placeholder: "搜索记忆，例如：插件架构、会话管理、长期记忆…",
					onChange: (event) => setQuery(event.target.value),
					onKeyDown: (event) => {
						if (event.key === "Enter") void runSearch();
					},
					style: {
						flex: 1,
						minHeight: 34,
						padding: "0 10px",
						border: `1px solid ${LINE}`,
						borderRadius: 7,
						background: "transparent",
						color: LABEL,
						font: "inherit",
						fontSize: 13,
						outline: "none",
					},
				}),
				button(searching ? "搜索中…" : "搜索", () => void runSearch(), { primary: true, disabled: searching }),
			);
			const body = [];
			if (searchError.length > 0) {
				body.push(
					h("div", { key: "search-error", style: { color: WARN, fontSize: 12, marginBottom: 10 } }, searchError),
				);
			}
			if (results === null) {
				body.push(
					h("div", { key: "hint", style: { color: FAINT, fontSize: 12, lineHeight: 1.8 } }, "输入关键词回车搜索。结果来自本机的 Nexus 数据库，不会上传。"),
				);
			} else if (results.length === 0 && searchError.length === 0) {
				body.push(h("div", { key: "empty", style: { color: FAINT, fontSize: 12 } }, "没有匹配的记忆。"));
			}
			for (const item of results ?? []) {
				const state = feedback[item.id];
				const long = (item.content ?? "").length > 360;
				const open = expanded[item.id] === true;
				body.push(
					h(
						"article",
						{
							key: item.id,
							style: {
								border: `1px solid ${LINE}`,
								borderRadius: 9,
								padding: 12,
								marginBottom: 10,
								background: PANEL,
							},
						},
						h(
							"div",
							{ style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 } },
							chip(typeLabel(item.type), TYPE_TONES[item.type]),
							chip(item.status === "stable" ? "稳定" : item.status ?? "—"),
							chip(`score ${Number(item.score ?? 0).toFixed(3)}`),
							item.project ? chip(item.project) : null,
							h("span", { style: { flex: 1 } }),
							h(
								"span",
								{ style: { display: "flex", gap: 6 } },
								button(
									state === "accepted" ? "已有用" : "有用",
									() => void sendFeedback(item.id, "accepted"),
									{ disabled: state === "sending" || state === "accepted" },
								),
								button(
									state === "ignored" ? "已忽略" : "没用",
									() => void sendFeedback(item.id, "ignored"),
									{ disabled: state === "sending" || state === "ignored" },
								),
							),
						),
						h(
							"div",
							{
								style: {
									color: LABEL,
									fontSize: 12,
									lineHeight: 1.75,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word",
									display: "-webkit-box",
									WebkitBoxOrient: "vertical",
									WebkitLineClamp: open ? "unset" : 6,
									overflow: "hidden",
								},
							},
							item.content,
						),
						long
							? h(
									"button",
									{
										type: "button",
										onClick: () =>
											setExpanded((state2) => ({ ...state2, [item.id]: state2[item.id] !== true })),
										style: {
											marginTop: 6,
											padding: 0,
											border: 0,
											background: "transparent",
											color: MUTED,
											fontSize: 11,
											cursor: "pointer",
										},
									},
									open ? "收起" : "展开全文",
								)
							: null,
					),
				);
			}
			return h(
				"div",
				{ style: { display: "grid", gap: 0, maxWidth: 760, color: LABEL, padding: "4px 0 24px" } },
				header,
				dbSwitch,
				h("div", { style: { height: 12 } }),
				uninitializedBanner,
				dbLocation,
				extractDefaultsBlock,
				toggle,
				searchBox,
				...body,
				toast.length > 0
					? h(
							"div",
							{
								style: {
									position: "fixed",
									right: 24,
									bottom: 24,
									padding: "8px 14px",
									borderRadius: 8,
									border: `1px solid ${LINE}`,
									background: PANEL,
									color: LABEL,
									fontSize: 12,
									boxShadow: "0 10px 28px rgba(0,0,0,.28)",
								},
							},
							toast,
						)
					: null,
			);
		}
		function NexusMemoryExtract(props) {
			const sessionId =
				typeof props.sessionId === "string" && props.sessionId.length > 0
					? props.sessionId
					: typeof props.session?.id === "string"
						? props.session.id
						: "";
			const [open, setOpen] = React.useState(false);
			const [db, setDb] = React.useState("primary");
			const [mode, setMode] = React.useState("rules");
			const [provider, setProvider] = React.useState("");
			const [model, setModel] = React.useState("");
			const [providers, setProviders] = React.useState(null);
			const [config, setConfig] = React.useState(null);
			const [source, setSource] = React.useState(null);
			const [sourceError, setSourceError] = React.useState("");
			const [showSource, setShowSource] = React.useState(false);
			const [candidates, setCandidates] = React.useState([]);
			const [busy, setBusy] = React.useState("");
			const [error, setError] = React.useState("");
			const [toast, setToast] = React.useState("");
			const aliveRef = React.useRef(true);
			React.useEffect(() => {
				aliveRef.current = true;
				return () => {
					aliveRef.current = false;
				};
			}, []);
			React.useEffect(() => {
				if (toast.length === 0) return undefined;
				const timer = setTimeout(() => setToast(""), 2800);
				return () => clearTimeout(timer);
			}, [toast]);
			const refreshConfig = React.useCallback(async () => {
				try {
					const response = await fetch(`${API}/config`, { cache: "no-store" });
					const data = await response.json();
					if (!aliveRef.current || data?.ok !== true) return;
					setConfig(data);
					const defaults = data.config?.extractDefaults;
					if (defaults) {
						setMode(defaults.mode === "model" ? "model" : "rules");
						if (defaults.provider) setProvider(defaults.provider);
						if (defaults.model) setModel(defaults.model);
					}
				} catch {
					/* keep the panel usable without config */
				}
			}, []);
			const refreshModels = React.useCallback(async () => {
				try {
					const response = await fetch(`${API}/models`, { cache: "no-store" });
					const data = await response.json();
					if (!aliveRef.current || data?.ok !== true) return;
					const list = Array.isArray(data.providers) ? data.providers : [];
					setProviders(list);
					setProvider((current) => {
						if (current.length > 0) return current;
						const first = list.find((entry) => Array.isArray(entry.models) && entry.models.length > 0);
						return first?.id ?? current;
					});
				} catch {
					/* model list is optional */
				}
			}, []);
			React.useEffect(() => {
				if (!open) return;
				void refreshConfig();
				void refreshModels();
			}, [open, refreshConfig, refreshModels]);
			React.useEffect(() => {
				if (!open) return undefined;
				if (sessionId.length === 0) {
					setSourceError("当前会话还没有可提取的内容");
					return undefined;
				}
				let alive = true;
				setSourceError("");
				fetch(`${API}/extract/source?sessionId=${encodeURIComponent(sessionId)}&turns=10`, { cache: "no-store" })
					.then((response) => response.json())
					.then((data) => {
						if (!alive) return;
						if (data?.ok === true) setSource(data);
						else setSourceError(String(data?.error ?? "读取会话失败"));
					})
					.catch((failure) => {
						if (alive) setSourceError(String(failure?.message ?? failure));
					});
				return () => {
					alive = false;
				};
			}, [open, sessionId]);
			React.useEffect(() => {
				if (!open) return undefined;
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [open]);
			const modelsOf = (pid) => (providers ?? []).find((entry) => entry.id === pid)?.models ?? [];
			React.useEffect(() => {
				if (mode !== "model") return;
				const list = modelsOf(provider);
				if (list.length > 0 && !list.some((entry) => entry.id === model)) setModel(list[0].id);
			}, [mode, provider, providers]);
			const targetStatus = config?.status?.[db];
			const uninitialized = targetStatus !== undefined && targetStatus.valid !== true;
			const runExtract = async () => {
				if (busy.length > 0) return;
				setBusy("extract");
				setError("");
				try {
					const body = { db, mode, sessionId, turns: 10, maxItems: 12 };
					if (mode === "model") body.model = { provider, model };
					const response = await fetch(`${API}/extract`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "提取失败"));
					const items = (Array.isArray(data.candidates) ? data.candidates : []).map((item) => ({
						...item,
						checked: true,
					}));
					setCandidates(items);
					setToast(items.length === 0 ? "没有可提取的内容" : `已生成 ${items.length} 条候选`);
				} catch (failure) {
					setError(String(failure?.message ?? failure));
				} finally {
					if (aliveRef.current) setBusy("");
				}
			};
			const saveSelected = async () => {
				const items = candidates.filter((item) => item.checked === true);
				if (items.length === 0 || busy.length > 0) return;
				setBusy("save");
				setError("");
				try {
					const response = await fetch(`${API}/remember`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							db,
							sessionId,
							items: items.map((item) => ({
								type: item.type,
								topic: item.topic,
								content: item.content,
								summary: item.summary,
								importance: item.importance,
							})),
						}),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "保存失败"));
					const inserted = Array.isArray(data.inserted) ? data.inserted.length : 0;
					setToast(`已写入 ${inserted} 条记忆`);
					setCandidates((list) => list.filter((item) => item.checked !== true));
					void refreshConfig();
				} catch (failure) {
					setError(String(failure?.message ?? failure));
				} finally {
					if (aliveRef.current) setBusy("");
				}
			};
			const createDb = async () => {
				if (busy.length > 0) return;
				setBusy("create");
				setError("");
				try {
					const response = await fetch(`${API}/config/create`, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ db }),
					});
					const data = await response.json();
					if (data?.ok !== true) throw new Error(String(data?.error ?? "创建失败"));
					setToast("空库已创建");
					void refreshConfig();
				} catch (failure) {
					setError(String(failure?.message ?? failure));
				} finally {
					if (aliveRef.current) setBusy("");
				}
			};
			const updateCandidate = (index, patch) => {
				setCandidates((list) => list.map((item, position) => (position === index ? { ...item, ...patch } : item)));
			};
			const setAll = (checked) => {
				setCandidates((list) => list.map((item) => ({ ...item, checked })));
			};
			const checkedCount = candidates.filter((item) => item.checked === true).length;
			const trigger = h(
				"button",
				{
					type: "button",
					title: "从当前会话提取记忆",
					onClick: () => setOpen((value) => !value),
					style: {
						minHeight: 26,
						padding: "0 10px",
						borderRadius: 7,
						border: `1px solid ${LINE}`,
						background: open ? HOVER : "transparent",
						color: MUTED,
						font: "inherit",
						fontSize: 12,
						cursor: "pointer",
						whiteSpace: "nowrap",
					},
				},
				"记忆",
			);
			if (!open) return trigger;
			const panel = ReactDOM.createPortal(
				h(
					"div",
					{
						style: {
							position: "fixed",
							top: 64,
							right: 16,
							bottom: 24,
							width: 380,
							zIndex: 1300,
							display: "flex",
							flexDirection: "column",
							gap: 10,
							padding: "12px 14px",
							border: `1px solid ${LINE}`,
							borderRadius: 10,
							background: PANEL,
							boxShadow: "0 18px 48px rgba(0,0,0,.35)",
							overflow: "auto",
							color: LABEL,
						},
					},
					h(
						"div",
						{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
						h("strong", { style: { fontSize: 13 } }, "记忆提取"),
						h(
							"div",
							{ style: { display: "flex", gap: 6, alignItems: "center" } },
							selectField(
								db,
								setDb,
								[
									{ value: "primary", label: "主库" },
									{ value: "code", label: "代码库" },
								],
								110,
							),
							h(
								"button",
								{
									type: "button",
									onClick: () => setOpen(false),
									style: {
										width: 24,
										height: 24,
										border: 0,
										borderRadius: 6,
										background: "transparent",
										color: MUTED,
										fontSize: 16,
										cursor: "pointer",
									},
								},
								"×",
							),
						),
					),
					uninitialized
						? h(
								"div",
								{
									style: {
										display: "flex",
										alignItems: "center",
										justifyContent: "space-between",
										gap: 8,
										padding: "8px 10px",
										borderRadius: 7,
										border: `1px solid ${WARN}`,
										color: WARN,
										fontSize: 11,
									},
								},
								"目标库尚未初始化",
								button("创建空库", () => void createDb(), { primary: true, disabled: busy.length > 0 }),
							)
						: null,
					h(
						"div",
						{ style: { display: "grid", gap: 4, fontSize: 11, color: FAINT } },
						h(
							"span",
							null,
							source !== null
								? `来源：${source.title ?? "当前会话"} · 最近 ${source.turns} 轮`
								: sourceError.length > 0
									? sourceError
									: "读取会话中…",
						),
						source !== null && typeof source.text === "string" && source.text.length > 0
							? h(
									"div",
									null,
									h(
										"button",
										{
											type: "button",
											onClick: () => setShowSource((value) => !value),
											style: {
												padding: 0,
												border: 0,
												background: "transparent",
												color: MUTED,
												fontSize: 11,
												cursor: "pointer",
											},
										},
										showSource ? "收起原文" : "查看原文",
									),
									showSource
										? h(
												"pre",
												{
													style: {
														maxHeight: 150,
														overflow: "auto",
														margin: "6px 0 0",
														padding: 8,
														borderRadius: 6,
														background: "rgba(127,127,127,.08)",
														color: MUTED,
														fontSize: 11,
														whiteSpace: "pre-wrap",
														wordBreak: "break-word",
													},
												},
												source.text,
											)
										: null,
								)
							: null,
					),
					h(
						"div",
						{ style: { display: "flex", gap: 12, alignItems: "center", fontSize: 12 } },
						h(
							"label",
							{ style: { display: "flex", gap: 5, alignItems: "center", cursor: "pointer" } },
							h("input", {
								type: "radio",
								name: "nexus-extract-mode",
								checked: mode === "rules",
								onChange: () => setMode("rules"),
								style: { accentColor: ACCENT },
							}),
							"轻量提取（规则）",
						),
						h(
							"label",
							{ style: { display: "flex", gap: 5, alignItems: "center", cursor: "pointer" } },
							h("input", {
								type: "radio",
								name: "nexus-extract-mode",
								checked: mode === "model",
								onChange: () => setMode("model"),
								style: { accentColor: ACCENT },
							}),
							"模型提取",
						),
					),
					mode === "model"
						? h(
								"div",
								{ style: { display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" } },
								selectField(
									provider,
									setProvider,
									[
										{ value: "", label: "提供方" },
										...(providers ?? []).map((entry) => ({ value: entry.id, label: entry.displayName })),
									],
									150,
								),
								selectField(
									model,
									setModel,
									[
										{ value: "", label: "模型" },
										...modelsOf(provider).map((entry) => ({ value: entry.id, label: entry.name })),
									],
									170,
								),
							)
						: null,
					mode === "model"
						? h("div", { style: { fontSize: 11, color: WARN } }, "将消耗该模型的 token。")
						: null,
					uninitialized
						? null
						: button(busy === "extract" ? "提取中…" : "提取候选", () => void runExtract(), {
								primary: true,
								disabled: busy.length > 0 || sourceError.length > 0,
							}),
					error.length > 0 ? h("div", { style: { color: WARN, fontSize: 11 } }, error) : null,
					candidates.length > 0
						? h(
								"div",
								{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
								h("span", { style: { fontSize: 11, color: FAINT } }, `候选 ${candidates.length} 条`),
								h(
									"div",
									{ style: { display: "flex", gap: 8 } },
									h(
										"button",
										{
											type: "button",
											onClick: () => setAll(true),
											style: {
												border: 0,
												background: "transparent",
												color: MUTED,
												fontSize: 11,
												cursor: "pointer",
											},
										},
										"全选",
									),
									h(
										"button",
										{
											type: "button",
											onClick: () => setAll(false),
											style: {
												border: 0,
												background: "transparent",
												color: MUTED,
												fontSize: 11,
												cursor: "pointer",
											},
										},
										"清空",
									),
								),
							)
						: null,
					...candidates.map((item, index) =>
						h(
							"div",
							{
								key: `candidate-${index}`,
								style: { display: "grid", gap: 5, padding: "8px 0", borderTop: `1px solid ${LINE}` },
							},
							h(
								"div",
								{ style: { display: "flex", alignItems: "center", gap: 6 } },
								h("input", {
									type: "checkbox",
									checked: item.checked === true,
									onChange: (event) => updateCandidate(index, { checked: event.target.checked }),
									style: { accentColor: ACCENT },
								}),
								chip(typeLabel(item.type), TYPE_TONES[item.type]),
								h(
									"span",
									{ style: { fontSize: 11, color: FAINT } },
									`重要度 ${Number(item.importance ?? 0.5).toFixed(1)}`,
								),
							),
							h("textarea", {
								value: item.content,
								rows: 3,
								onChange: (event) => updateCandidate(index, { content: event.target.value }),
								style: {
									width: "100%",
									boxSizing: "border-box",
									padding: 7,
									border: `1px solid ${LINE}`,
									borderRadius: 6,
									background: "transparent",
									color: LABEL,
									font: "inherit",
									fontSize: 12,
									resize: "vertical",
									outline: "none",
								},
							}),
							h("input", {
								type: "range",
								min: "0",
								max: "1",
								step: "0.1",
								value: Number(item.importance ?? 0.5),
								onChange: (event) => updateCandidate(index, { importance: Number(event.target.value) }),
								style: { accentColor: ACCENT },
							}),
						),
					),
					h(
						"div",
						{
							style: {
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								gap: 8,
								marginTop: "auto",
								paddingTop: 8,
								borderTop: `1px solid ${LINE}`,
							},
						},
						h("span", { style: { fontSize: 11, color: FAINT } }, `已选 ${checkedCount} / ${candidates.length}`),
						button(`保存选中（${checkedCount}）`, () => void saveSelected(), {
							primary: true,
							disabled: checkedCount === 0 || busy.length > 0,
						}),
					),
					toast.length > 0
						? h(
								"div",
								{
									style: {
										position: "fixed",
										right: 32,
										bottom: 40,
										padding: "8px 14px",
										borderRadius: 8,
										border: `1px solid ${LINE}`,
										background: PANEL,
										color: LABEL,
										fontSize: 12,
										boxShadow: "0 10px 28px rgba(0,0,0,.28)",
									},
								},
								toast,
							)
						: null,
				),
				document.body,
			);
			return h(React.Fragment, null, trigger, panel);
		}
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "nexus-memory-extract",
						order: 70,
					},
					(props) => h(NexusMemoryExtract, { ...props, ctx }),
				),
			);
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "nexus-memory",
						order: 65,
						label: () => "长期记忆",
					},
					NexusMemorySettings,
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
