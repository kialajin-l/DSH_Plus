window.__ModuleLoader__.load({
	id: "dsh-balance-badge",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const h = React.createElement;
		const name = "dsh-balance-badge";
		/** Services: header slot, session bindings for token usage, Account Remote for balance. */
		const inject = ["slots", "sessions", "locale", "remote", "remote.account"];
		const REFRESH_MS = 5 * 60 * 1000;
		const CLIENT_VERSION = "0.2.1-rc.3";
		const LOW_BALANCE = 5;
		/** DeepSeek API peak windows in Beijing time; everything else bills off-peak. */
		const PEAK_WINDOWS = [
			[9 * 60, 12 * 60],
			[14 * 60, 18 * 60],
		];
		const MINUTE = 60 * 1000;
		const LABEL = "var(--dsw-alias-label-primary, #e8eaed)";
		const MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const FAINT = "var(--dsw-alias-label-tertiary, #74797f)";
		const LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.24))";
		const PANEL = "var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #1c1d21))";
		const HOVER = "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12))";
		const WARN = "var(--dsw-alias-state-warning-primary, #d49a43)";
		const GOOD = "var(--dsw-alias-state-success-primary, #3fa76b)";
		/** Locale/timezone metadata carried by Account Remote calls. */
		function accountMeta(ctx) {
			let locale = "zh-CN";
			try {
				locale = ctx.locale.getSnapshot().active;
			} catch {}
			return {
				version: CLIENT_VERSION,
				locale,
				timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
			};
		}
		/** Fold a wallet array into per-currency sums. */
		function toWallets(list) {
			const out = {};
			for (const wallet of Array.isArray(list) ? list : []) {
				const currency = typeof wallet?.currency === "string" ? wallet.currency : "CNY";
				const value = Number(wallet?.balance);
				if (!Number.isFinite(value)) continue;
				out[currency] = (out[currency] ?? 0) + value;
			}
			return out;
		}
		function symbolOf(currency) {
			if (currency === "CNY") return "\u00a5";
			if (currency === "USD") return "$";
			return `${currency} `;
		}
		function formatMoney(value, currency) {
			return `${symbolOf(currency)}${Number(value).toFixed(2)}`;
		}
		function formatTokens(value) {
			if (!Number.isFinite(value)) return "\u2014";
			if (value >= 1e7) return `${(value / 1e6).toFixed(1)}M`;
			if (value >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
			return String(Math.round(value));
		}
		function formatClock(at) {
			try {
				return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
			} catch {
				return "";
			}
		}
		/** Wall-clock parts of one instant rendered in Beijing time (UTC+8). */
		function beijingParts(ms) {
			const local = new Date(ms);
			const shifted = new Date(ms + (local.getTimezoneOffset() + 480) * MINUTE);
			return { day: shifted.getDay(), minutes: shifted.getHours() * 60 + shifted.getMinutes() };
		}
		/** Peak billing applies on weekdays inside the published windows only. */
		function isPeak(ms) {
			const { day, minutes } = beijingParts(ms);
			if (day === 0 || day === 6) return false;
			return PEAK_WINDOWS.some(([start, end]) => minutes >= start && minutes < end);
		}
		/** First minute boundary (up to four days ahead) whose price period differs. */
		function nextPeriodChange(ms) {
			const peak = isPeak(ms);
			const start = Math.floor(ms / MINUTE) * MINUTE + MINUTE;
			for (let index = 0; index < 4 * 1440; index += 1) {
				const candidate = start + index * MINUTE;
				if (isPeak(candidate) !== peak) return candidate;
			}
			return undefined;
		}
		function formatRemain(ms) {
			if (!Number.isFinite(ms) || ms <= 0) return "\u5373\u5c06\u5207\u6362";
			const total = Math.ceil(ms / MINUTE);
			const hours = Math.floor(total / 60);
			const minutes = total % 60;
			if (hours === 0) return `${minutes} \u5206\u949f`;
			if (minutes === 0) return `${hours} \u5c0f\u65f6`;
			return `${hours} \u5c0f\u65f6 ${minutes} \u5206\u949f`;
		}
		/** Current price period, refreshed every thirty seconds. */
		function usePricingClock() {
			const read = React.useCallback(() => {
				const now = Date.now();
				const peak = isPeak(now);
				const changeAt = nextPeriodChange(now);
				return {
					peak,
					discount: peak ? "\u539f\u4ef7" : "5 \u6298",
					remain: changeAt === undefined ? undefined : changeAt - now,
				};
			}, []);
			const [snapshot, setSnapshot] = React.useState(read);
			React.useEffect(() => {
				const timer = setInterval(() => setSnapshot(read()), 30000);
				return () => clearInterval(timer);
			}, [read]);
			return snapshot;
		}
		/** Read the account wallet through the Account Remote; polls while mounted. */
		function useBalance(ctx) {
			const [state, setState] = React.useState({ status: "loading" });
			const alive = React.useRef(true);
			const load = React.useCallback(async () => {
				try {
					const result = await ctx.remote.account.getBalance(accountMeta(ctx));
					if (!alive.current) return;
					if (!result || result.ok !== true || !result.value || result.value.status !== "ready") {
						setState({ status: "signed-out" });
						return;
					}
					setState({
						status: "ready",
						normal: toWallets(result.value.value),
						bonus: toWallets(result.value.bonusWallets),
						at: Date.now(),
					});
				} catch (error) {
					if (alive.current) setState({ status: "error", message: String(error?.message ?? error) });
				}
			}, [ctx]);
			React.useEffect(() => {
				alive.current = true;
				void load();
				const timer = setInterval(() => void load(), REFRESH_MS);
				const onFocus = () => void load();
				window.addEventListener("focus", onFocus);
				return () => {
					alive.current = false;
					clearInterval(timer);
					window.removeEventListener("focus", onFocus);
				};
			}, [load]);
			return { state, load };
		}
		/** Live session token totals from the tokenUsage projection. */
		function useTokenUsage(ctx, sessionId) {
			const face = React.useMemo(() => {
				if (typeof sessionId !== "string" || sessionId.length === 0) return undefined;
				try {
					const binding = ctx.sessions.binding(sessionId);
					return binding?.session.projections.faceOf("tokenUsage");
				} catch {
					return undefined;
				}
			}, [ctx, sessionId]);
			const subscribe = React.useCallback(
				(notify) => (face === undefined ? () => undefined : face.subscribe(notify)),
				[face],
			);
			const snapshot = React.useCallback(
				() => (face === undefined ? undefined : face.getSnapshot()),
				[face],
			);
			return React.useSyncExternalStore(subscribe, snapshot, snapshot);
		}
		/** Today's estimated spend, read from the usage panel when the popover opens. */
		function useTodayCost(open, tick) {
			const [state, setState] = React.useState({ status: "idle" });
			React.useEffect(() => {
				if (!open) return undefined;
				let alive = true;
				setState((current) => (current.status === "ready" ? current : { status: "loading" }));
				(async () => {
					try {
						const response = await fetch("/usage-panel/api/summary?days=1", { cache: "no-store" });
						if (!response.ok) throw new Error(String(response.status));
						const data = await response.json();
						if (!alive) return;
						const day = Array.isArray(data.days) ? data.days[data.days.length - 1] : undefined;
						setState({
							status: "ready",
							cost: typeof day?.cost === "number" ? day.cost : 0,
							tokens: day?.tokens?.total ?? 0,
						});
					} catch {
						if (alive) setState({ status: "unavailable" });
					}
				})();
				return () => {
					alive = false;
				};
			}, [open, tick]);
			return state;
		}
		function row(label, value, muted) {
			return h(
				"div",
				{ style: { display: "flex", justifyContent: "space-between", gap: 16, padding: "3px 0" } },
				h("span", { style: { color: MUTED, fontSize: 12 } }, label),
				h("span", { style: { color: muted ? FAINT : LABEL, fontSize: 12, fontVariantNumeric: "tabular-nums" } }, value),
			);
		}
		function divider() {
			return h("div", { style: { height: 1, background: LINE, margin: "10px 0" } });
		}
		function PriceSection(price) {
			const tone = price.peak ? WARN : GOOD;
			return h(
				React.Fragment,
				null,
				h(
					"div",
					{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } },
					h(
						"span",
						{ style: { display: "inline-flex", alignItems: "center", gap: 6, color: tone, fontWeight: 600 } },
						h("span", { "aria-hidden": true }, price.peak ? "\u26a1" : "\u{1F319}"),
						price.peak ? "\u9ad8\u5cf0\u65f6\u6bb5" : "\u95f2\u65f6\u65f6\u6bb5",
					),
					h("span", { style: { color: tone, fontSize: 12, fontVariantNumeric: "tabular-nums" } }, price.discount),
				),
				h(
					"div",
					{ style: { color: MUTED, fontSize: 11, marginTop: 3 } },
					price.remain === undefined
						? ""
						: `${price.peak ? "\u8ddd\u95f2\u65f6" : "\u8ddd\u9ad8\u5cf0"}\u8fd8\u6709 ${formatRemain(price.remain)}`,
				),
				h(
					"div",
					{ style: { color: FAINT, fontSize: 11, lineHeight: 1.6, marginTop: 3 } },
					"\u5de5\u4f5c\u65e5\u9ad8\u5cf0 9:00\u201312:00\u300114:00\u201318:00\uff1b\u5176\u4f59\u65f6\u6bb5\u4e0e\u5468\u672b\u5168\u5929\u6309\u95f2\u65f6\u4ef7\u8ba1\u8d39\uff08\u5317\u4eac\u65f6\u95f4\uff09\u3002",
				),
			);
		}
		function BalanceBadge(props) {
			const ctx = props.ctx;
			const { state, load } = useBalance(ctx);
			const usage = useTokenUsage(ctx, props.sessionId);
			const price = usePricingClock();
			const [open, setOpen] = React.useState(false);
			const [anchor, setAnchor] = React.useState({ top: 0, right: 16 });
			const [tick, setTick] = React.useState(0);
			const today = useTodayCost(open, tick);
			const buttonRef = React.useRef(null);
			const panelRef = React.useRef(null);
			React.useEffect(() => {
				if (!open) return undefined;
				const onPointer = (event) => {
					if (buttonRef.current?.contains(event.target)) return;
					if (panelRef.current?.contains(event.target)) return;
					setOpen(false);
				};
				const onKey = (event) => {
					if (event.key === "Escape") setOpen(false);
				};
				document.addEventListener("pointerdown", onPointer, true);
				document.addEventListener("keydown", onKey);
				return () => {
					document.removeEventListener("pointerdown", onPointer, true);
					document.removeEventListener("keydown", onKey);
				};
			}, [open]);
			const currency =
				state.status === "ready" ? (Object.keys({ ...state.normal, ...state.bonus })[0] ?? "CNY") : "CNY";
			const topped = state.status === "ready" ? (state.normal[currency] ?? 0) : 0;
			const bonus = state.status === "ready" ? (state.bonus[currency] ?? 0) : 0;
			const total = topped + bonus;
			const low = state.status === "ready" && total < LOW_BALANCE;
			let label;
			if (state.status === "ready") label = formatMoney(total, currency);
			else if (state.status === "loading") label = `${symbolOf(currency)} \u2014`;
			else if (state.status === "signed-out") label = "\u672a\u767b\u5f55";
			else label = "\u4f59\u989d\u672a\u77e5";
			const totals = usage?.totals;
			const todayText =
				today.status === "ready"
					? formatMoney(today.cost, "CNY")
					: today.status === "loading"
						? "\u8ba1\u7b97\u4e2d\u2026"
						: "\u2014";
			const todayHint =
				today.status === "ready"
					? `\u4eca\u65e5 ${formatTokens(today.tokens)} tokens \u00b7 \u6309\u4ef7\u76ee\u8868\u4f30\u7b97`
					: today.status === "loading"
						? "\u6b63\u5728\u7edf\u8ba1\u672c\u5730\u4f1a\u8bdd\u7528\u91cf\u2026"
						: "\u7528\u91cf\u9762\u677f\u4e0d\u53ef\u7528";
			const input = totals
				? (totals.uncachedInputTokens ?? 0) + (totals.cacheReadTokens ?? 0) + (totals.cacheWriteTokens ?? 0)
				: undefined;
			const output = totals?.outputTokens;
			const all = input === undefined || output === undefined ? undefined : input + output;
			const toggle = () => {
				if (!open && buttonRef.current) {
					const rect = buttonRef.current.getBoundingClientRect();
					setAnchor({ top: Math.round(rect.bottom + 6), right: Math.round(window.innerWidth - rect.right) });
				}
				setOpen((value) => !value);
			};
			const periodTitle = price.peak ? "\u9ad8\u5cf0\u65f6\u6bb5 \u00b7 \u539f\u4ef7" : "\u95f2\u65f6\u65f6\u6bb5 \u00b7 5 \u6298";
			return h(
				React.Fragment,
				null,
				h(
					"button",
					{
						ref: buttonRef,
						type: "button",
						"aria-haspopup": "dialog",
						"aria-expanded": open,
						title:
							state.status === "ready"
								? `DeepSeek \u4f59\u989d ${formatMoney(total, currency)} \u00b7 ${periodTitle}`
								: `DeepSeek \u4f59\u989d \u00b7 ${periodTitle}`,
						onClick: toggle,
						style: {
							display: "inline-flex",
							alignItems: "center",
							gap: 6,
							height: 28,
							padding: "0 10px",
							borderRadius: 14,
							border: `1px solid ${LINE}`,
							background: open ? HOVER : "transparent",
							color: low ? WARN : state.status === "ready" ? LABEL : MUTED,
							font: "inherit",
							fontSize: 12,
							fontVariantNumeric: "tabular-nums",
							cursor: "pointer",
							whiteSpace: "nowrap",
						},
					},
					h(
						"span",
						{
							"aria-hidden": true,
							style: { fontSize: 12, lineHeight: 1, color: price.peak ? WARN : GOOD },
						},
						price.peak ? "\u26a1" : "\u{1F319}",
					),
					h("span", null, label),
				),
				open
					? h(
							"div",
							{
								ref: panelRef,
								role: "dialog",
								"aria-label": "DeepSeek \u4f59\u989d\u4e0e\u7528\u91cf",
								style: {
									position: "fixed",
									top: anchor.top,
									right: anchor.right,
									zIndex: 900,
									width: 264,
									padding: 14,
									borderRadius: 10,
									border: `1px solid ${LINE}`,
									background: PANEL,
									color: LABEL,
									boxShadow: "0 12px 32px rgba(0,0,0,.28)",
									fontSize: 12,
								},
							},
							h(
								"div",
								{ style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 } },
								h("strong", { style: { fontSize: 12 } }, "DeepSeek \u4f59\u989d"),
								h(
									"button",
									{
										type: "button",
										onClick: () => {
											setTick((value) => value + 1);
											void load();
										},
										title: "\u5237\u65b0",
										style: {
											border: `1px solid ${LINE}`,
											background: "transparent",
											color: MUTED,
											borderRadius: 6,
											padding: "2px 8px",
											fontSize: 11,
											cursor: "pointer",
										},
									},
									"\u5237\u65b0",
								),
							),
							PriceSection(price),
							divider(),
							state.status === "ready"
								? h(
										React.Fragment,
										null,
										h(
											"div",
											{
												style: {
													fontSize: 22,
													fontWeight: 600,
													margin: "2px 0 8px",
													color: low ? WARN : LABEL,
													fontVariantNumeric: "tabular-nums",
												},
											},
											formatMoney(total, currency),
										),
										row("\u5145\u503c\u4f59\u989d", formatMoney(topped, currency)),
										row("\u8d60\u91d1\u4f59\u989d", formatMoney(bonus, currency), bonus === 0),
									)
								: h(
										"div",
										{ style: { color: MUTED, lineHeight: 1.6 } },
										state.status === "signed-out"
											? "\u672a\u767b\u5f55 DeepSeek \u8d26\u53f7\uff0c\u65e0\u6cd5\u8bfb\u53d6\u4f59\u989d\u3002\u5728 \u8bbe\u7f6e \u2192 \u8d26\u53f7\u4e0e\u4f59\u989d \u767b\u5f55\u540e\u5373\u53ef\u663e\u793a\u3002"
											: state.status === "loading"
												? "\u6b63\u5728\u8bfb\u53d6\u4f59\u989d\u2026"
												: `\u4f59\u989d\u8bfb\u53d6\u5931\u8d25\uff1a${state.message ?? ""}`,
									),
							divider(),
							h(
								"div",
								{ style: { display: "flex", justifyContent: "space-between", gap: 16 } },
								h("span", { style: { color: MUTED, fontSize: 12 } }, "\u4eca\u65e5\u82b1\u8d39"),
								h(
									"span",
									{ style: { color: LABEL, fontSize: 12, fontVariantNumeric: "tabular-nums" } },
									todayText,
								),
							),
							h("div", { style: { color: FAINT, fontSize: 11, marginTop: 2 } }, todayHint),
							divider(),
							h("div", { style: { color: MUTED, marginBottom: 4 } }, "\u672c\u4f1a\u8bdd tokens"),
							row("\u8f93\u5165", formatTokens(input), input === undefined),
							row("\u8f93\u51fa", formatTokens(output), output === undefined),
							row("\u5408\u8ba1", formatTokens(all), all === undefined),
							h(
								"div",
								{ style: { marginTop: 10, color: FAINT, lineHeight: 1.5 } },
								`\u66f4\u65b0\u4e8e ${
									state.status === "ready" ? formatClock(state.at) : "\u2014"
								} \u00b7 \u8bbe\u7f6e \u2192 \u8d26\u53f7\u4e0e\u4f59\u989d\u53ef\u5145\u503c`,
							),
						)
					: null,
			);
		}
		function apply(ctx) {
			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "balance-badge",
						order: 95,
					},
					(props) => h(BalanceBadge, { ...props, ctx }),
				),
			);
		}
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
