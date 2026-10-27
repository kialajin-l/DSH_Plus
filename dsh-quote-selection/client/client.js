window.__ModuleLoader__.load({
	id: "dsh-quote-selection",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");
		const ReactDOM = require("react-dom");
		const h = React.createElement;
		const name = "dsh-quote-selection";
		/** Dock slot is session-scoped; uiWorkspace creates the discussion session. */
		const inject = ["slots", "uiWorkspace"];
		const BAR_BG = "var(--dsw-alias-bg-layer-2, #232428)";
		const BAR_LINE = "var(--dsw-alias-border-secondary, rgba(127,127,127,.3))";
		const BAR_TEXT = "var(--dsw-alias-label-primary, #e8eaed)";
		const BAR_MUTED = "var(--dsw-alias-label-secondary, #9aa0a6)";
		const CARD_BG = "var(--dsw-alias-bg-layer-1, rgba(127,127,127,.08))";
		const KIND_LABELS = {
			user: "\u4f60\u7684\u6d88\u606f",
			assistant: "\u52a9\u624b\u56de\u7b54",
			tool: "\u5de5\u5177\u8f93\u51fa",
			"turn-process": "\u8fc7\u7a0b",
			steering: "\u63d2\u8bdd",
			"turn-trigger": "\u89e6\u53d1",
		};

		/** Describe where the selection came from, when the chat row exposes it. */
		function describeSource(element) {
			if (element === null) return "";
			const row = element.closest("[data-chat-turn], [data-chat-flow-kind]");
			if (row === null) return "";
			const kind = row.getAttribute("data-chat-flow-kind") ?? "";
			const turn = row.getAttribute("data-chat-turn") ?? "";
			const label = KIND_LABELS[kind] ?? "";
			if (turn !== "" && label !== "") return `\u7b2c ${turn} \u8f6e \u00b7 ${label}`;
			if (turn !== "") return `\u7b2c ${turn} \u8f6e`;
			return label;
		}

		/** Read a live text selection that is neither empty nor inside an editor. */
		function readSelection() {
			const selection = document.getSelection();
			if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
			const text = selection.toString().trim();
			if (text.length < 2) return null;
			const anchor = selection.anchorNode;
			const element =
				anchor === null
					? null
					: anchor.nodeType === Node.ELEMENT_NODE
						? anchor
						: anchor.parentElement;
			if (element !== null && element.closest("input, textarea, [contenteditable='true'], [data-quote-toolbar]") !== null) {
				return null;
			}
			let rect;
			let turn = "";
			try {
				rect = selection.getRangeAt(0).getBoundingClientRect();
				const row = element?.closest("[data-chat-turn]");
				turn = row?.getAttribute("data-chat-turn") ?? "";
			} catch {
				return null;
			}
			if (rect.width === 0 && rect.height === 0) return null;
			return { text, rect, source: describeSource(element), turn };
		}

		/** Render the selection as a Markdown blockquote carrying its origin. */
		function toQuote(text, source) {
			const head = source.length > 0 ? `> \u5f15\u7528\u81ea${source}\n` : "";
			const lines = text.split(/\r?\n/u).map((line) => (line.length > 0 ? `> ${line}` : ">"));
			return `${head}${lines.join("\n")}\n\n`;
		}

		/** Prefer the shell's draft editor; fall back to typing into the composer element. */
		function insertQuote(inputActions, text) {
			try {
				if (inputActions !== undefined && typeof inputActions.captureInsertion === "function") {
					const span = inputActions.captureInsertion();
					if (inputActions.insertText(text, span) === true) return true;
				}
			} catch {
				// Fall through to the DOM path.
			}
			const editor = document.querySelector(
				"[data-dsh-composer] [contenteditable='true'], [contenteditable='true'][role='textbox'], [contenteditable='true']",
			);
			if (editor === null) return false;
			editor.focus();
			const selection = document.getSelection();
			if (selection === null) return false;
			const range = document.createRange();
			range.selectNodeContents(editor);
			range.collapse(false);
			selection.removeAllRanges();
			selection.addRange(range);
			return document.execCommand("insertText", false, text);
		}

		function copyText(text) {
			if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === "function") {
				navigator.clipboard.writeText(text).catch(() => undefined);
				return;
			}
			const holder = document.createElement("textarea");
			holder.value = text;
			holder.style.position = "fixed";
			holder.style.opacity = "0";
			document.body.appendChild(holder);
			holder.select();
			try {
				document.execCommand("copy");
			} catch {
				// Ignore: the toolbar closes either way.
			}
			holder.remove();
		}

		/** Scroll the transcript to the quoted turn and flash it. */
		function jumpToTurn(turn) {
			if (typeof turn !== "string" || turn.length === 0) return false;
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

		function titleOf(text) {
			const line = text.split(/\r?\n/u).map((part) => part.trim()).find((part) => part.length > 0) ?? text;
			return line.length > 46 ? `${line.slice(0, 46)}\u2026` : line;
		}

		function button(label, onClick) {
			return h(
				"button",
				{
					type: "button",
					onMouseDown: (event) => event.preventDefault(),
					onClick,
					style: {
						border: 0,
						background: "transparent",
						color: BAR_TEXT,
						font: "inherit",
						fontSize: 12,
						padding: "5px 9px",
						borderRadius: 6,
						cursor: "pointer",
						whiteSpace: "nowrap",
					},
					onMouseEnter: (event) => {
						event.currentTarget.style.background = "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))";
					},
					onMouseLeave: (event) => {
						event.currentTarget.style.background = "transparent";
					},
				},
				label,
			);
		}

		function QuoteCard(props) {
			const quote = props.quote;
			return h(
				"div",
				{
					"data-quote-card": quote.id,
					onDoubleClick: () => {
						if (!jumpToTurn(quote.turn)) props.onNote("\u672a\u627e\u5230\u5bf9\u5e94\u8f6e\u6b21");
					},
					title: "\u53cc\u51fb\u5b9a\u4f4d\u5230\u539f\u4f1a\u8bdd\u8f6e",
					style: {
						display: "flex",
						alignItems: "center",
						gap: 10,
						width: props.width,
						maxWidth: "100%",
						boxSizing: "border-box",
						padding: "7px 9px",
						margin: "0",
						border: `1px solid ${BAR_LINE}`,
						borderRadius: 9,
						background: CARD_BG,
						color: BAR_TEXT,
						cursor: "default",
						userSelect: "none",
					},
				},
				h(
					"span",
					{
						"aria-hidden": true,
						style: {
							width: 30,
							height: 30,
							flex: "0 0 auto",
							display: "grid",
							placeItems: "center",
							borderRadius: 8,
							background: "var(--dsw-alias-bg-layer-3, rgba(127,127,127,.16))",
							fontSize: 15,
						},
					},
					"\u275d",
				),
				h(
					"div",
					{ style: { minWidth: 0, flex: 1, display: "grid", gap: 2 } },
					h(
						"div",
						{
							style: {
								fontSize: 12,
								overflow: "hidden",
								textOverflow: "ellipsis",
								whiteSpace: "nowrap",
								color: BAR_TEXT,
							},
						},
						titleOf(quote.text),
					),
					h(
						"div",
						{ style: { fontSize: 11, color: BAR_MUTED } },
						`${quote.source.length > 0 ? quote.source : "\u5bf9\u8bdd\u5185\u5bb9"} \u00b7 ${quote.text.length} \u5b57`,
					),
				),
				h(
					"button",
					{
						type: "button",
						onMouseDown: (event) => event.preventDefault(),
						onClick: () => props.onExpand(quote),
						style: {
							flex: "0 0 auto",
							border: 0,
							background: "transparent",
							color: "var(--dsw-alias-label-link, #7aa2ff)",
							font: "inherit",
							fontSize: 12,
							padding: "4px 6px",
							borderRadius: 6,
							cursor: "pointer",
							whiteSpace: "nowrap",
						},
					},
					"\u5728\u6587\u672c\u6846\u4e2d\u663e\u793a \u203a",
				),
				h(
					"button",
					{
						type: "button",
						onMouseDown: (event) => event.preventDefault(),
						onClick: () => props.onRemove(quote),
						title: "\u79fb\u9664",
						style: {
							flex: "0 0 auto",
							width: 22,
							height: 22,
							border: 0,
							borderRadius: 6,
							background: "transparent",
							color: BAR_MUTED,
							cursor: "pointer",
							fontSize: 14,
							lineHeight: 1,
						},
					},
					"\u00d7",
				),
			);
		}

		function QuoteToolbar(props) {
			const [state, setState] = React.useState(null);
			const [quotes, setQuotes] = React.useState([]);
			const [note, setNote] = React.useState("");
			const [align, setAlign] = React.useState({ offset: 0, width: 560 });
			const wrapRef = React.useRef(null);
			const nextId = React.useRef(1);
			/** Mirror of the staged quotes so submit handlers read the latest list. */
			const pendingRef = React.useRef([]);
			React.useEffect(() => {
				const measure = () => {
					const wrap = wrapRef.current;
					// The composer is the lowest editable box on screen; other panels may
					// also be contenteditable, so pick by position instead of DOM order.
					const candidate = [...document.querySelectorAll("[contenteditable='true']")]
						.map((element) => ({ element, rect: element.getBoundingClientRect() }))
						.filter((item) => item.rect.width > 120 && item.rect.height > 0)
						.sort((left, right) => right.rect.bottom - left.rect.bottom)[0];
					if (wrap === null || candidate === undefined) return;
					const wrapRect = wrap.getBoundingClientRect();
					const editorRect = candidate.rect;
					const offset = Math.max(0, Math.round(editorRect.left - wrapRect.left));
					const width = Math.max(280, Math.min(560, Math.round(editorRect.width)));
					setAlign((current) =>
						current.offset === offset && current.width === width ? current : { offset, width },
					);
				};
				measure();
				const timer = setTimeout(measure, 300);
				window.addEventListener("resize", measure);
				return () => {
					clearTimeout(timer);
					window.removeEventListener("resize", measure);
				};
			}, [quotes.length]);
			React.useEffect(() => {
				let frame = 0;
				const schedule = () => {
					if (frame !== 0) return;
					frame = requestAnimationFrame(() => {
						frame = 0;
						setState(readSelection());
					});
				};
				document.addEventListener("selectionchange", schedule);
				document.addEventListener("pointerup", schedule, true);
				document.addEventListener("keyup", schedule, true);
				window.addEventListener("scroll", schedule, true);
				window.addEventListener("resize", schedule);
				return () => {
					document.removeEventListener("selectionchange", schedule);
					document.removeEventListener("pointerup", schedule, true);
					document.removeEventListener("keyup", schedule, true);
					window.removeEventListener("scroll", schedule, true);
					window.removeEventListener("resize", schedule);
				};
			}, []);
			React.useEffect(() => {
				if (note.length === 0) return undefined;
				const timer = setTimeout(() => setNote(""), 1600);
				return () => clearTimeout(timer);
			}, [note]);
			const clearQuotes = () => {
				pendingRef.current = [];
				setQuotes([]);
			};
			/** Fold staged quotes into the draft right before the prompt leaves. */
			const expandAtSend = () => {
				const list = pendingRef.current;
				if (list.length === 0) return;
				const text = list.map((quote) => toQuote(quote.text, quote.source)).join("");
				if (insertQuote(props.inputActions, text)) clearQuotes();
			};
			React.useEffect(() => {
				const actions = props.inputActions;
				if (actions === undefined || typeof actions.submit !== "function") return undefined;
				const original = actions.submit;
				const patched = function patchedSubmit() {
					expandAtSend();
					return original.call(actions);
				};
				actions.submit = patched;
				return () => {
					if (actions.submit === patched) actions.submit = original;
				};
			}, [props.inputActions]);
			React.useEffect(() => {
				// Keyboard and pointer paths that do not go through actions.submit.
				const onKeyDown = (event) => {
					if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
					const target = event.target;
					if (!(target instanceof Element) || target.closest("[contenteditable='true']") === null) return;
					expandAtSend();
				};
				const onClick = (event) => {
					const target = event.target;
					if (!(target instanceof Element)) return;
					const button = target.closest("button");
					if (button === null) return;
					const label = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("title") ?? ""} ${button.getAttribute("data-testid") ?? ""}`;
					if (/发送|send/i.test(label)) expandAtSend();
				};
				document.addEventListener("keydown", onKeyDown, true);
				document.addEventListener("click", onClick, true);
				return () => {
					document.removeEventListener("keydown", onKeyDown, true);
					document.removeEventListener("click", onClick, true);
				};
			}, [props.inputActions]);
			const stage = (selection) => {
				const id = nextId.current++;
				const quote = { id, text: selection.text, source: selection.source, turn: selection.turn };
				pendingRef.current = [...pendingRef.current, quote];
				setQuotes(pendingRef.current);
			};
			const dismiss = () => {
				setState(null);
				const selection = document.getSelection();
				if (selection !== null) selection.removeAllRanges();
			};
			const dropQuote = (quote) => {
				pendingRef.current = pendingRef.current.filter((item) => item.id !== quote.id);
				setQuotes(pendingRef.current);
			};
			const expand = (quote) => {
				const ok = insertQuote(props.inputActions, toQuote(quote.text, quote.source));
				if (ok) dropQuote(quote);
				else setNote("\u5bfc\u5165\u5931\u8d25");
			};
			const remove = (quote) => dropQuote(quote);
			const cards =
				quotes.length === 0
					? null
					: h(
							"div",
							{
								ref: wrapRef,
								style: {
									display: "flex",
									flexDirection: "column",
									alignItems: "flex-start",
									gap: 6,
									width: "100%",
									paddingLeft: align.offset,
									boxSizing: "border-box",
									margin: "0 0 6px",
									maxWidth: "100%",
								},
							},
							quotes.map((quote) =>
								h(QuoteCard, {
									key: quote.id,
									quote,
									width: align.width,
									onExpand: expand,
									onRemove: remove,
									onNote: setNote,
								}),
							),
						);
			let toolbar = null;
			if (state !== null) {
				const width = 292;
				const top = Math.max(8, Math.round(state.rect.top - 42));
				const left = Math.min(
					Math.max(8, Math.round(state.rect.left + state.rect.width / 2 - width / 2)),
					Math.max(8, window.innerWidth - width - 8),
				);
				const quoteText = toQuote(state.text, state.source);
				toolbar = ReactDOM.createPortal(
					h(
						"div",
						{
							"data-quote-toolbar": "true",
							style: {
								position: "fixed",
								top,
								left,
								zIndex: 1200,
								display: "inline-flex",
								alignItems: "center",
								gap: 2,
								padding: "3px",
								borderRadius: 9,
								border: `1px solid ${BAR_LINE}`,
								background: BAR_BG,
								boxShadow: "0 8px 24px rgba(0,0,0,.32)",
								userSelect: "none",
							},
						},
						button("\u6dfb\u52a0\u5230\u5bf9\u8bdd", () => {
							stage(state);
							dismiss();
						}),
						h("span", { style: { width: 1, height: 16, background: BAR_LINE, margin: "0 2px" } }),
						button("\u65b0\u5f00\u8ba8\u8bba", () => {
							try {
								props.ctx.uiWorkspace.startSession(undefined, {
									prompt: quoteText,
									whenDraftExists: "append",
								});
								dismiss();
							} catch (error) {
								setNote(`\u65b0\u5efa\u5931\u8d25\uff1a${String(error?.message ?? error)}`);
							}
						}),
						h("span", { style: { width: 1, height: 16, background: BAR_LINE, margin: "0 2px" } }),
						button("\u590d\u5236", () => {
							copyText(state.text);
							setNote("\u5df2\u590d\u5236");
							dismiss();
						}),
						note.length > 0
							? h(
									"span",
									{ style: { color: BAR_MUTED, fontSize: 11, padding: "0 6px" }, "aria-live": "polite" },
									note,
								)
							: null,
					),
					document.body,
				);
			}
			if (cards === null && toolbar === null) return null;
			return h(React.Fragment, null, cards, toolbar);
		}

		function apply(ctx) {
			ctx.slots.inject("conversation.input.dock", () =>
				ctx.slots.register(
					{
						name: "conversation.input.dock",
						id: "quote-selection",
						order: 200,
					},
					(props) => h(QuoteToolbar, { ...props, ctx }),
				),
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	},
});
