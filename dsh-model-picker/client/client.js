window.__ModuleLoader__.load({
	id: "@kialajin/dsh-model-picker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const reactDom = require("react-dom");

		const h = react.createElement;

		/* ------------------------------------------------------------------ */
		/* styles                                                              */
		/* ------------------------------------------------------------------ */

		const STYLE_ID = "dsh-model-picker-style";
		const CSS = `
.dmp-trigger{display:inline-flex;align-items:center;gap:6px;height:26px;max-width:220px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-border,#34343a);background:var(--dsw-surface,#1f1f24);color:var(--dsw-text,#e6e6ea);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background 120ms ease,border-color 120ms ease;user-select:none}
.dmp-trigger:hover:not(:disabled){background:var(--dsw-surface-hover,#28282e);border-color:#43434c}
.dmp-trigger:disabled{opacity:.5;cursor:not-allowed}
.dmp-model{max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmp-dot{color:var(--dsw-text-faint,#7d7d86)}
.dmp-effort{color:var(--dsw-text-dim,#a0a0aa)}
.dmp-caret{color:var(--dsw-text-faint,#7d7d86);font-size:10px;transition:transform 120ms ease}
.dmp-caret-open{transform:rotate(180deg)}
.dmp-spin{display:inline-block;animation:dmp-rotate 900ms linear infinite}
.dmp-menu{position:fixed;z-index:1200;width:300px;box-sizing:border-box;background:var(--dsw-menu-bg,#1b1b20);border:1px solid var(--dsw-border,#34343a);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.45);padding:6px;color:var(--dsw-text,#e6e6ea);font-size:12px;animation:dmp-in 120ms ease-out}
.dmp-menu-head{display:flex;align-items:center;justify-content:space-between;padding:5px 8px;color:var(--dsw-text-faint,#7d7d86);font-size:11px}
.dmp-menu-title{font-weight:600;color:var(--dsw-text-dim,#a0a0aa)}
.dmp-group-title{padding:6px 8px 2px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-text-faint,#7d7d86)}
.dmp-rows{max-height:240px;overflow-y:auto}
.dmp-row{display:flex;align-items:center;justify-content:space-between;gap:8px;height:30px;padding:0 8px;border-radius:6px;cursor:pointer}
.dmp-row:hover{background:var(--dsw-menu-hover,#26262c)}
.dmp-row-active{background:var(--dsw-menu-active,#2a2a31)}
.dmp-row-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dmp-check{color:#5ad07a;flex:none}
.dmp-effort-block{padding:4px 8px 8px;border-top:1px solid var(--dsw-border,#34343a);margin-top:4px}
.dmp-effort-title{padding:6px 0 6px;font-size:11px;color:var(--dsw-text-faint,#7d7d86)}
.dmp-efforts{display:flex;gap:4px}
.dmp-effort-btn{flex:1;height:24px;border-radius:6px;border:1px solid var(--dsw-border,#34343a);background:transparent;color:var(--dsw-text-dim,#a0a0aa);font:inherit;font-size:11px;cursor:pointer;transition:background 120ms ease}
.dmp-effort-btn:hover{background:var(--dsw-menu-hover,#26262c)}
.dmp-effort-btn-active{background:var(--dsw-menu-active,#3a3a44);color:var(--dsw-text,#fff);border-color:#4a4a55}
.dmp-error{padding:6px 8px;color:#ff6b6b;font-size:11px}
.dmp-fallback{display:inline-flex;align-items:center;height:26px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-border,#34343a);color:#ffb4b4;font-size:11px}
@keyframes dmp-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes dmp-rotate{to{transform:rotate(360deg)}}
`;

		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.getElementById(STYLE_ID) !== null) return;
			const element = document.createElement("style");
			element.id = STYLE_ID;
			element.textContent = CSS;
			document.head.appendChild(element);
		}

		/* ------------------------------------------------------------------ */
		/* helpers                                                             */
		/* ------------------------------------------------------------------ */

		const EFFORT_LABELS = {
			off: "关闭",
			none: "关闭",
			offline: "关闭",
			minimal: "最低",
			low: "低",
			medium: "中",
			high: "高",
			max: "最高",
			maximum: "最高",
		};

		function effortLabel(effort) {
			const id = String(effort?.id ?? "").toLowerCase();
			return EFFORT_LABELS[id] ?? (typeof effort?.name === "string" && effort.name.length > 0 ? effort.name : String(effort?.id ?? ""));
		}

		function noopSubscribe() {
			return () => {};
		}

		function findModel(catalog, selection) {
			if (catalog === null || catalog === undefined || selection === null || selection === undefined) return undefined;
			for (const group of catalog.groups ?? []) {
				if (group.id !== selection.provider) continue;
				return (group.models ?? []).find((model) => model.id === selection.model);
			}
			return undefined;
		}

		function findGroup(catalog, provider) {
			return (catalog?.groups ?? []).find((group) => group.id === provider);
		}

		/* ------------------------------------------------------------------ */
		/* picker                                                              */
		/* ------------------------------------------------------------------ */

		function useProjectedSelection(store) {
			const subscribe = react.useMemo(
				() => (store !== undefined && typeof store.subscribe === "function" ? store.subscribe.bind(store) : noopSubscribe),
				[store],
			);
			const read = react.useMemo(
				() => (store !== undefined && typeof store.getSnapshot === "function" ? () => store.getSnapshot() : () => undefined),
				[store],
			);
			return react.useSyncExternalStore(subscribe, read, () => undefined);
		}

		function Picker(props) {
			const locked = props.locked === true || props.available === false;
			const projected = useProjectedSelection(props.projectStore);
			const [catalog, setCatalog] = react.useState(null);
			const [catalogError, setCatalogError] = react.useState(null);
			const [open, setOpen] = react.useState(false);
			const [switching, setSwitching] = react.useState(false);
			const [actionError, setActionError] = react.useState(null);
			const [position, setPosition] = react.useState(null);
			const triggerRef = react.useRef(null);
			const menuRef = react.useRef(null);
			const errorTimer = react.useRef(null);

			// The slot injects a fresh face object per render, so keep the verbs in
			// refs: the loader effect must run once per mount, not per render.
			const faceRef = react.useRef(props);
			faceRef.current = props;

			const loadCatalog = react.useCallback(async () => {
				setCatalogError(null);
				try {
					const response = await faceRef.current.loadCatalog();
					if (response === undefined || response.ok !== true) {
						throw new Error(
							response?.error !== undefined ? `${response.error.code}: ${response.error.message}` : "模型目录加载失败",
						);
					}
					setCatalog(response.value);
					return response.value;
				} catch (error) {
					setCatalogError(String(error?.message ?? error));
					return null;
				}
			}, []);

			react.useEffect(() => {
				loadCatalog();
			}, [loadCatalog]);

			const projectedSelection = projected?.next ?? projected?.current ?? undefined;
			const current = projectedSelection ?? catalog?.default ?? null;
			const currentModel = findModel(catalog, current);
			const currentGroup = findGroup(catalog, current?.provider);
			const reasoning = currentModel?.reasoning;
			const efforts = Array.isArray(reasoning?.efforts) ? reasoning.efforts : [];
			const activeEffort = current?.reasoningEffort ?? reasoning?.defaultEffort ?? undefined;

			const showError = (message) => {
				setActionError(message);
				if (errorTimer.current !== null) clearTimeout(errorTimer.current);
				errorTimer.current = setTimeout(() => setActionError(null), 3000);
			};

			const choose = async (selection, close) => {
				if (switching) return;
				setSwitching(true);
				try {
					const result = await faceRef.current.select(selection);
					if (result !== undefined && result.ok === false) {
						throw new Error(result.error !== undefined ? `${result.error.code}: ${result.error.message}` : "模型切换失败");
					}
					if (close) setOpen(false);
				} catch (error) {
					showError(String(error?.message ?? error));
				} finally {
					setSwitching(false);
				}
			};

			const placeMenu = react.useCallback(() => {
				const trigger = triggerRef.current;
				if (trigger === null) return;
				const rect = trigger.getBoundingClientRect();
				const width = 300;
				const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8));
				const bottom = Math.max(8, window.innerHeight - rect.top + 6);
				setPosition({ left, bottom });
			}, []);

			react.useEffect(() => {
				if (!open) return;
				placeMenu();
				const onPointerDown = (event) => {
					const target = event.target;
					if (triggerRef.current !== null && triggerRef.current.contains(target)) return;
					if (menuRef.current !== null && menuRef.current.contains(target)) return;
					setOpen(false);
				};
				const onKeyDown = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				const onViewport = (event) => {
					// Scrolling inside the menu (wheel or scrollbar drag) must not close it.
					const target = event?.target;
					if (menuRef.current !== null && target instanceof Node && menuRef.current.contains(target)) return;
					if (triggerRef.current !== null && target instanceof Node && triggerRef.current.contains(target)) return;
					setOpen(false);
				};
				document.addEventListener("mousedown", onPointerDown);
				document.addEventListener("keydown", onKeyDown);
				window.addEventListener("resize", onViewport);
				window.addEventListener("scroll", onViewport, true);
				return () => {
					document.removeEventListener("mousedown", onPointerDown);
					document.removeEventListener("keydown", onKeyDown);
					window.removeEventListener("resize", onViewport);
					window.removeEventListener("scroll", onViewport, true);
				};
			}, [open, placeMenu]);

			react.useEffect(() => () => {
				if (errorTimer.current !== null) clearTimeout(errorTimer.current);
			}, []);

			const toggle = () => {
				if (locked) return;
				if (open) {
					setOpen(false);
					return;
				}
				setOpen(true);
				loadCatalog();
			};

			const modelName = currentModel?.name ?? current?.model ?? "选择模型";
			const effortName = efforts.length > 0 && activeEffort !== undefined
				? effortLabel(efforts.find((effort) => effort.id === activeEffort) ?? { id: activeEffort })
				: undefined;

			const trigger = h(
				"button",
				{
					type: "button",
					ref: triggerRef,
					className: "dmp-trigger",
					disabled: locked,
					title: `${currentGroup?.name ?? current?.provider ?? "模型"} · ${modelName}${effortName !== undefined ? ` · ${effortName}` : ""}`,
					onClick: toggle,
				},
				h("span", { className: "dmp-model" }, modelName),
				effortName !== undefined ? h("span", { className: "dmp-dot" }, "·") : null,
				effortName !== undefined ? h("span", { className: "dmp-effort" }, effortName) : null,
				switching ? h("span", { className: "dmp-spin" }, "⟳") : h("span", { className: `dmp-caret${open ? " dmp-caret-open" : ""}` }, "▾"),
			);

			let menu = null;
			if (open && position !== null) {
				const groups = catalog?.groups ?? [];
				menu = reactDom.createPortal(
					h(
						"div",
						{
							ref: menuRef,
							className: "dmp-menu",
							style: { left: position.left, bottom: position.bottom, overscrollBehavior: "contain" },
							role: "dialog",
							onPointerDown: (event) => event.stopPropagation(),
							onWheel: (event) => event.stopPropagation(),
						},
						h(
							"div",
							{ className: "dmp-menu-head" },
							h("span", { className: "dmp-menu-title" }, "模型"),
							h("span", null, currentGroup?.name ?? current?.provider ?? ""),
						),
						catalogError !== null
							? h("div", { className: "dmp-error" }, "模型加载失败，请在 设置 → 模型 里修改")
							: null,
						h(
							"div",
							{ className: "dmp-rows" },
							groups.map((group) =>
								h(
									"div",
									{ key: `group:${group.id}` },
									h("div", { className: "dmp-group-title" }, group.name ?? group.id),
									(group.models ?? []).map((model) => {
										const active = current?.provider === group.id && current?.model === model.id;
										return h(
											"div",
											{
												key: `model:${group.id}:${model.id}`,
												className: `dmp-row${active ? " dmp-row-active" : ""}`,
												onClick: () => choose({ provider: group.id, model: model.id }, true),
											},
											h("span", { className: "dmp-row-name" }, model.name ?? model.id),
											active ? h("span", { className: "dmp-check" }, "✓") : null,
										);
									}),
								),
							),
						),
						!catalogError && efforts.length > 0
							? h(
								"div",
								{ className: "dmp-effort-block" },
								h("div", { className: "dmp-effort-title" }, "推理等级"),
								h(
									"div",
									{ className: "dmp-efforts" },
									efforts.map((effort) =>
										h(
											"button",
											{
												key: `effort:${effort.id}`,
												type: "button",
												className: `dmp-effort-btn${effort.id === activeEffort ? " dmp-effort-btn-active" : ""}`,
												onClick: () => {
													if (current === null) return;
													choose({ provider: current.provider, model: current.model, reasoningEffort: effort.id }, false);
												},
											},
											effortLabel(effort),
										),
									),
								),
							)
							: null,
						actionError !== null ? h("div", { className: "dmp-error" }, actionError) : null,
					),
					document.body,
				);
			}

			return h(react.Fragment, null, trigger, menu);
		}

		class PickerBoundary extends react.Component {
			constructor(props) {
				super(props);
				this.state = { failed: false };
			}
			static getDerivedStateFromError() {
				return { failed: true };
			}
			componentDidCatch(error) {
				// Keep the composer usable even when the catalog or slot contract breaks.
				if (typeof console !== "undefined") console.warn("dsh-model-picker:", error);
			}
			render() {
				if (this.state.failed) return h("span", { className: "dmp-fallback" }, "模型选择不可用");
				return this.props.children;
			}
		}

		function Boundary(props) {
			return h(PickerBoundary, null, h(Picker, props));
		}

		/* ------------------------------------------------------------------ */
		/* plugin                                                              */
		/* ------------------------------------------------------------------ */

		const inject = [
			"slots",
			"sessions",
			"remote",
			"remote.session",
		];

		function apply(ctx) {
			ensureStyles();
			ctx.slots.inject("conversation.input.model", () =>
				ctx.slots.register(
					{
						name: "conversation.input.model",
						inject: (sessionId) => {
							const sessions = ctx.sessions;
							let projectStore;
							try {
								const binding = sessions?.binding?.(sessionId);
								projectStore = binding?.session?.projections?.faceOf("modelSelection");
							} catch {
								projectStore = undefined;
							}
							return {
								available: sessions?.subagentAddress?.(sessionId) === undefined,
								projectStore,
								loadCatalog: () => ctx.remote.session.modelCatalog(),
								// The session wire face owns selectModel; ctx.sessions is the UI store.
								select: (selection) => ctx.remote.session.selectModel({ sessionId, ...selection }),
							};
						},
					},
					Boundary,
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
