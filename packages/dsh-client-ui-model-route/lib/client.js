window.__ModuleLoader__.load({
	id: "@jiangshilong/dsh-client-ui-model-route",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		//#region lib/client/constants.js
		/**
		 * ModelRoute 智能模型路由的可视化配置面板（浏览器半边）。
		 *
		 * 挂载点：Models 设置页 provider 卡片扩展区（keyed slot
		 * `settings.models.provider-card`，key = 网关条目的 settingsNs）。
		 * 读写通道：共享 settings 文档（configForms 服务）——只编辑网关 Config 的
		 * volatile 字段（tiers / enableRouter / router / auxiliary），保存即写入 profile
		 * 的 cordis.patch 并热更新生效；判定模型 API Key 通过凭据服务存储，值不过回传。
		 * 判定端点按家族固定（JEV 走 System One，StartLux 走 decisions），面板不暴露线协议；
		 * 代理不常用，收在卡片底部并可折叠。
		 */
		const NS = "llm-model-route";
		const ROUTE = "model-route";
		const TIERS = ["opus", "sonnet", "haiku"];
		/** Host route that runs one real judge call for the staged form values. */
		const JUDGE_TEST_PATH = "/model-route/judge-test";
		const JUDGE_KINDS = ["jev", "startlux"];
		const JUDGE_KIND_LABELS = { jev: "JEV（TypeSafe System One）", startlux: "StartLux（结构化判定）" };
		const JUDGE_KEY_ENVS = { jev: "JEV_API_KEY", startlux: "BAMBOO_API_KEY" };
		/** Each family has exactly one endpoint shape; no wire protocol choice. */
		const JUDGE_ENDPOINT_HINTS = {
			jev: "自动补 /v1/systemone",
			startlux: "自动补 /v1/decisions",
		};
		const JUDGE_MODEL_PLACEHOLDERS = { jev: "jev-latest", startlux: "startlux-decision-27b-autothink" };
		const TIER_LABELS = {
			opus: "Opus 档",
			sonnet: "Sonnet 档",
			haiku: "Haiku 档",
		};
		const TIER_HINTS = {
			opus: "复杂推理 / 长任务",
			sonnet: "日常编码 / 默认",
			haiku: "轻量快速任务",
		};
		const AUX_PURPOSES = [
			["compaction", "会话压缩"],
			["session-title", "会话标题"],
		];
		//#endregion
		//#region lib/client/styles.js
		const card = {
			borderTop: "0.5px solid var(--dsw-alias-border-l3)",
			marginTop: 2,
			paddingTop: 12,
			display: "flex",
			flexDirection: "column",
			gap: 12,
		};
		const sectionTitle = {
			margin: 0,
			fontSize: 13,
			fontWeight: 500,
			lineHeight: "20px",
			color: "var(--dsw-alias-label-primary)",
		};
		const hint = {
			margin: 0,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-label-tertiary)",
		};
		const hintWarn = {
			...hint,
			color: "var(--dsw-alias-state-warn-label)",
		};
		const tierGrid = {
			display: "grid",
			gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
			gap: 8,
		};
		const tierCard = {
			border: "0.5px solid var(--dsw-alias-border-l3)",
			borderRadius: 10,
			padding: "10px 12px",
			display: "flex",
			flexDirection: "column",
			gap: 8,
			minWidth: 0,
		};
		const field = {
			display: "flex",
			flexDirection: "column",
			gap: 4,
			minWidth: 0,
		};
		const label = {
			fontSize: 12,
			lineHeight: "17px",
			color: "var(--dsw-alias-label-secondary)",
		};
		const input = {
			boxSizing: "border-box",
			width: "100%",
			height: 30,
			padding: "0 8px",
			fontSize: 13,
			fontFamily: "inherit",
			color: "var(--dsw-alias-label-primary)",
			background: "var(--dsw-alias-interactive-bg)",
			border: "0.5px solid var(--dsw-alias-border-l3)",
			borderRadius: 8,
		};
		const rowInline = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			flexWrap: "wrap",
		};
		const footer = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			flexWrap: "wrap",
		};
		const noticeOk = {
			margin: 0,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-state-success-primary)",
		};
		const noticeBad = {
			margin: 0,
			fontSize: 12,
			lineHeight: "18px",
			color: "var(--dsw-alias-state-error-primary)",
		};
		const grid2 = {
			display: "grid",
			gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
			gap: 8,
		};
		const proxySection = {
			borderTop: "0.5px solid var(--dsw-alias-border-l3)",
			paddingTop: 10,
			display: "flex",
			flexDirection: "column",
			gap: 8,
		};
		const proxyHead = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			flexWrap: "wrap",
		};
		//#endregion
		//#region lib/client/util.js
		/** Read a nested path from a plain object; absence yields undefined. */
		function getPath(value, path) {
			let current = value;
			for (const key of path) {
				if (current === null || typeof current !== "object") return undefined;
				current = current[key];
			}
			return current;
		}
		/** Treat blank strings as absent so cleared drafts unset the field. */
		function textAt(value, path) {
			const raw = getPath(value, path);
			return typeof raw === "string" ? raw : "";
		}
		/**
		 * A safe one-line summary of a proxy value: scheme and host only. The
		 * userinfo (which may carry a password) is never echoed back to the page.
		 * A bare `host:port` is summarized as HTTP, matching how the host parses it.
		 */
		function proxySummary(raw) {
			const text = String(raw ?? "").trim();
			if (text === "") return "";
			try {
				const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
				const url = new URL(scheme);
				return `${url.protocol}//${url.host}`;
			} catch {
				return "已配置";
			}
		}
		//#endregion
		//#region lib/client/hooks.js
		/** Subscribe one config form controller's snapshot into component state. */
		function useFormSnapshot(form) {
			const [snapshot, setSnapshot] = react.useState(() => (form ? form.getSnapshot() : null));
			react.useEffect(() => {
				if (!form) return undefined;
				setSnapshot(form.getSnapshot());
				return form.subscribe(() => {
					setSnapshot(form.getSnapshot());
				});
			}, [form]);
			return snapshot;
		}
		/**
		 * Unwrap one `session/modelCatalog` answer. Host remotes answer with a
		 * `{ok, value}` envelope (never the bare catalog), and a failed read carries
		 * `{ok: false, error}`; a bare catalog is still tolerated so an older or
		 * plain transport cannot blank the panel.
		 * @param response - the remote answer.
		 * @returns the catalog's groups and isolated provider failures.
		 */
		function catalogOf(response) {
			if (response !== null && typeof response === "object" && response.ok === false) {
				const error = response.error ?? {};
				throw new Error(`${error.code ?? "REMOTE"}: ${error.message ?? "模型目录读取失败"}`);
			}
			const value = response !== null && typeof response === "object" && response.ok === true
				? response.value ?? {}
				: response ?? {};
			return {
				groups: Array.isArray(value.groups) ? value.groups : [],
				failures: Array.isArray(value.failures) ? value.failures : [],
			};
		}
		/**
		 * Load the Host-generation model catalog (provider → models) and keep it
		 * fresh. Provider routes and their model lists register asynchronously
		 * after boot and change whenever settings or credentials do, so the panel
		 * must reload on the Host's invalidations — a one-shot read can capture an
		 * empty catalog and leave every select showing only the configured value.
		 * @param remote - the client remote namespace.
		 * @param watch - subscription helper: calls the callback on catalog invalidations and returns a disposer.
		 * @returns catalog state; groups survive reloads so the selects do not flicker.
		 */
		function useCatalog(remote, watch) {
			const [state, setState] = react.useState({ status: "idle", groups: [], failures: [] });
			const [tick, setTick] = react.useState(0);
			react.useEffect(() => {
				if (typeof watch !== "function") return undefined;
				return watch(() => {
					setTick((value) => value + 1);
				});
			}, [watch]);
			react.useEffect(() => {
				let alive = true;
				setState((previous) => (previous.status === "ready"
					? previous
					: { status: "loading", groups: previous.groups, failures: previous.failures }));
				remote.session.modelCatalog().then((response) => {
					if (!alive) return;
					const catalog = catalogOf(response);
					setState({
						status: "ready",
						groups: catalog.groups,
						failures: catalog.failures,
					});
				}).catch((error) => {
					if (!alive) return;
					setState((previous) => ({
						status: "error",
						groups: previous.groups,
						failures: previous.failures,
						error,
					}));
				});
				return () => {
					alive = false;
				};
			}, [remote, tick]);
			return state;
		}
		/** Track one credential reference's configured state (presence only). */
		function useCredential(remote, ref, revision) {
			const [state, setState] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				if (!ref) {
					setState(null);
					return undefined;
				}
				remote.credentials.describe([ref]).then((response) => {
					if (!alive) return;
					setState(response.ok ? response.value?.[ref] ?? null : null);
				}).catch(() => {
					if (alive) setState(null);
				});
				return () => {
					alive = false;
				};
			}, [remote, ref, revision]);
			return state;
		}
		//#endregion
		//#region lib/client/controls.js
		/** One labelled text input. */
		function TextField(props) {
			return react_jsx_runtime.jsxs("label", {
				style: field,
				children: [
					react_jsx_runtime.jsx("span", { style: label, children: props.label }),
					react_jsx_runtime.jsx("input", {
						style: input,
						type: "text",
						value: props.value,
						placeholder: props.placeholder ?? "",
						disabled: props.disabled === true,
						onChange: (event) => props.onChange(event.target.value),
					}),
					props.hint ? react_jsx_runtime.jsx("span", { style: hint, children: props.hint }) : null,
				],
			});
		}
		/** One labelled password input (write-only secret draft). */
		function SecretField(props) {
			return react_jsx_runtime.jsxs("label", {
				style: field,
				children: [
					react_jsx_runtime.jsxs("span", {
						style: rowInline,
						children: [
							react_jsx_runtime.jsx("span", { style: label, children: props.label }),
							props.configured === true ? react_jsx_runtime.jsx(primitives.Tag, { tone: "neutral", children: "已配置" }) : react_jsx_runtime.jsx(primitives.Tag, { tone: "quiet", children: "未配置" }),
						],
					}),
					react_jsx_runtime.jsx("input", {
						style: input,
						type: "password",
						autoComplete: "new-password",
						value: props.value,
						placeholder: props.configured === true ? "输入新值以替换" : "粘贴 API Key",
						disabled: props.disabled === true,
						onChange: (event) => props.onChange(event.target.value),
					}),
					props.hint ? react_jsx_runtime.jsx("span", { style: hint, children: props.hint }) : null,
				],
			});
		}
		/** One labelled select. `options` is a list of {value, label}. */
		function SelectField(props) {
			return react_jsx_runtime.jsxs("label", {
				style: field,
				children: [
					react_jsx_runtime.jsx("span", { style: label, children: props.label }),
					react_jsx_runtime.jsx("select", {
						style: input,
						value: props.value,
						disabled: props.disabled === true,
						onChange: (event) => props.onChange(event.target.value),
						children: props.options.map((option) => react_jsx_runtime.jsx("option", {
							value: option.value,
							disabled: option.disabled === true,
							children: option.label,
						}, option.value)),
					}),
					props.hint ? react_jsx_runtime.jsx("span", { style: hint, children: props.hint }) : null,
				],
			});
		}
		/**
		 * Provider choices for one tier slot. The gateway's own route is excluded:
		 * upstream must be another provider, or the gateway would route to itself.
		 * A configured value the catalog no longer offers still displays.
		 */
		function providerChoices(groups, current) {
			const options = groups
				.filter((group) => group.id !== ROUTE)
				.map((group) => ({ value: group.id, label: group.name }));
			if (current !== "" && !options.some((option) => option.value === current)) {
				options.push({ value: current, label: `${current}（配置文件指定）` });
			}
			if (options.length === 0) options.push({ value: "", label: "（模型目录未就绪）" });
			return options;
		}

		/** Provider select + model select fed by the detected catalog. Values the
		 * catalog does not know (set in the config file) still display. */
		function ModelPicker(props) {
			const { disabled, providerValue, modelValue, groups, onProvider, onModel } = props;
			const providerOptions = providerChoices(groups, providerValue);
			const group = groups.find((candidate) => candidate.id === providerValue);
			const modelOptions = (group?.models ?? []).map((model) => ({
				value: model.id,
				label: model.name && model.name !== model.id ? `${model.name}（${model.id}）` : model.id,
			}));
			if (modelValue !== "" && !modelOptions.some((option) => option.value === modelValue)) {
				modelOptions.push({ value: modelValue, label: `${modelValue}（配置文件指定）` });
			}
			if (providerValue !== "" && modelOptions.length === 0) {
				modelOptions.push({ value: "", label: "（该提供商暂无目录模型）" });
			}
			return react_jsx_runtime.jsxs(react.Fragment, {
				children: [
					react_jsx_runtime.jsx(SelectField, {
						label: props.providerLabel ?? "提供商",
						value: providerValue,
						options: providerOptions,
						disabled,
						onChange: onProvider,
					}),
					react_jsx_runtime.jsx(SelectField, {
						label: props.modelLabel ?? "模型",
						value: modelValue,
						options: modelOptions,
						disabled: disabled || providerValue === "",
						onChange: onModel,
					}),
				],
			});
		}
		//#endregion
		//#region lib/client/sections.js
		/** One tier slot: provider + model, nothing else. */
		function TierCard(props) {
			const { tier, draft, current, groups, disabled, setDraft } = props;
			const base = ["tiers", tier];
			const providerValue = draft[`${base.join(".")}.provider`] ?? textAt(current, [...base, "provider"]);
			const modelValue = draft[`${base.join(".")}.model`] ?? textAt(current, [...base, "model"]);
			return react_jsx_runtime.jsxs("div", {
				style: tierCard,
				children: [
					react_jsx_runtime.jsx("span", { style: sectionTitle, children: TIER_LABELS[tier] ?? tier }),
					react_jsx_runtime.jsx("span", { style: hint, children: TIER_HINTS[tier] ?? "" }),
					react_jsx_runtime.jsx(ModelPicker, {
						disabled,
						groups,
						providerValue,
						modelValue,
						onProvider: (next) => setDraft(`${base.join(".")}.provider`, next),
						onModel: (next) => setDraft(`${base.join(".")}.model`, next),
					}),
				],
			});
		}
		const TEST_ROUTER_FIELDS = [
			"baseURL", "model", "proxy", "provider", "prompt",
			"temperature", "timeoutMs", "maxRequestChars", "thinkMode", "thinkBudget",
			"gate", "mix", "noneThreshold",
		];

		/**
		 * The family the form is editing: the staged selector, else the saved one.
		 * Each family's endpoint lives in its own `router.<family>` entry, so a
		 * switch simply displays the other entry — nothing is banked or restored.
		 */
		function judgeKindOfDraft(current, draft) {
			// `enableRouter` is a TOP-LEVEL config field (not inside `router`).
			// The legacy `router.enableRouter` draft key is only read so a panel
			// that was mid-edit when this fix loaded keeps rendering the family
			// it had staged; buildPlan never writes that path.
			const raw = draft["enableRouter"] ?? draft["router.enableRouter"]
				?? getPath(current, ["enableRouter"]) ?? getPath(current, ["router", "enableRouter"]);
			return raw === "startlux" ? "startlux" : "jev";
		}

		/** The router the form currently describes: the edited family's saved
		 *  entry plus staged edits. The host's test route accepts this flat draft. */
		function routerForTest(current, draft) {
			const kind = judgeKindOfDraft(current, draft);
			const saved = getPath(current, ["router", kind]);
			const router = { kind };
			for (const field of TEST_ROUTER_FIELDS) {
				const path = `router.${kind}.${field}`;
				router[field] = path in draft ? draft[path] : saved?.[field];
			}
			return router;
		}

		/** Judge section: the family select names the entry being edited and,
		 *  once saved, the enabled one; the fields below show that entry. */
		function JudgeSection(props) {
			const { draft, current, disabled, setDraft, keyState } = props;
			const kind = judgeKindOfDraft(current, draft);
			const read = (key) => draft[`router.${kind}.${key}`] ?? getPath(current, ["router", kind, key]);
			const text = (key) => {
				const raw = read(key);
				return typeof raw === "string" ? raw : "";
			};
			return react_jsx_runtime.jsxs("div", {
				style: { display: "flex", flexDirection: "column", gap: 10 },
				children: [
					react_jsx_runtime.jsx(SelectField, {
						label: "判定家族",
						value: kind,
						options: JUDGE_KINDS.map((value) => ({ value, label: JUDGE_KIND_LABELS[value] })),
						disabled,
						onChange: (next) => {
							setDraft("enableRouter", next);
							// the staged key draft belongs to the family being left
							setDraft("@key", "");
						},
					}),
					react_jsx_runtime.jsx(TextField, {
						label: "API 地址",
						value: text("baseURL"),
						placeholder: kind === "jev" ? "https://api.typesafe.ai/v1" : "https://api.bamboonode.dev/v1",
						disabled,
						hint: JUDGE_ENDPOINT_HINTS[kind],
						onChange: (next) => setDraft(`router.${kind}.baseURL`, next),
					}),
					react_jsx_runtime.jsx(TextField, {
						label: "模型 ID",
						value: text("model"),
						placeholder: JUDGE_MODEL_PLACEHOLDERS[kind],
						disabled,
						onChange: (next) => setDraft(`router.${kind}.model`, next),
					}),
					react_jsx_runtime.jsx(SecretField, {
						label: "判定模型 API Key",
						hint: "存进 Harness 凭据服务，不回显；每个判定家族各存一份。",
						value: draft["@key"] ?? "",
						configured: keyState?.configured === true,
						disabled,
						onChange: (next) => setDraft("@key", next),
					}),
				],
			});
		}

		/**
		 * Proxy settings for the edited family's judge endpoint. Uncommon enough
		 * to stay collapsed at the bottom of the card; the summary shows the
		 * target host (never credentials) so a configured proxy stays visible.
		 */
		function ProxySection(props) {
			const { value, disabled, onChange } = props;
			const [open, setOpen] = react.useState(false);
			const summary = proxySummary(value);
			return react_jsx_runtime.jsxs("section", {
				style: proxySection,
				children: [
					react_jsx_runtime.jsxs("div", {
						style: proxyHead,
						children: [
							react_jsx_runtime.jsx("h3", { style: sectionTitle, children: "代理（可选）" }),
							summary !== "" ? react_jsx_runtime.jsx(primitives.Tag, { tone: "neutral", children: summary }) : null,
							react_jsx_runtime.jsx("span", { style: { flex: 1 } }),
							react_jsx_runtime.jsx(primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled,
								"aria-expanded": open,
								onClick: () => setOpen((previous) => !previous),
								children: open ? "收起" : summary !== "" ? "修改" : "设置",
							}),
						],
					}),
					open ? react_jsx_runtime.jsx(TextField, {
						label: "HTTP(S) 代理地址",
						value,
						placeholder: "http://127.0.0.1:7897",
						disabled,
						hint: "仅判定请求；不支持 SOCKS。",
						onChange,
					}) : null,
				],
			});
		}
		/** Auxiliary-purpose tier picks (compaction / session title). */
		function AuxSection(props) {
			const { draft, current, disabled, setDraft } = props;
			const tierOptions = TIERS.map((tier) => ({ value: tier, label: TIER_LABELS[tier] }));
			const auxValue = (purpose) => draft[`auxiliary.${purpose}`] ?? (textAt(current, ["auxiliary", purpose]) || "sonnet");
			return react_jsx_runtime.jsx("div", {
				style: grid2,
				children: AUX_PURPOSES.map(([purpose, name]) => react_jsx_runtime.jsx(SelectField, {
					label: name,
					value: auxValue(purpose),
					options: tierOptions,
					disabled,
					onChange: (next) => setDraft(`auxiliary.${purpose}`, next),
				}, purpose)),
			});
		}
		//#endregion
		//#region lib/client/save.js
		/**
		 * Turn the panel draft into settings document operations.
		 * @returns {ops, secrets, invalid} — invalid lists blocked field labels.
		 */
		function buildPlan(draft, current) {
			const ops = [];
			const secrets = [];
			const invalid = [];
			for (const tier of TIERS) {
				const base = ["tiers", tier];
				const key = base.join(".");
				const hasProvider = `tiers.${tier}.provider` in draft;
				const hasModel = `tiers.${tier}.model` in draft;
				const hasEffort = `tiers.${tier}.reasoningEffort` in draft;
				const hasFallback = `tiers.${tier}.fallbacks.0.provider` in draft || `tiers.${tier}.fallbacks.0.model` in draft;
				if (!hasProvider && !hasModel && !hasEffort && !hasFallback) continue;
				const provider = String(hasProvider ? draft[`tiers.${tier}.provider`] : textAt(current, [...base, "provider"])).trim();
				const model = String(hasModel ? draft[`tiers.${tier}.model`] : textAt(current, [...base, "model"])).trim();
				const effort = String(hasEffort ? draft[`tiers.${tier}.reasoningEffort`] : textAt(current, [...base, "reasoningEffort"])).trim();
				const fallbackProvider = String(draft[`tiers.${tier}.fallbacks.0.provider`] ?? textAt(current, [...base, "fallbacks", 0, "provider"])).trim();
				const fallbackModel = String(draft[`tiers.${tier}.fallbacks.0.model`] ?? textAt(current, [...base, "fallbacks", 0, "model"])).trim();
				if (hasProvider || hasModel) {
					if (provider === "" && model === "") {
						// clearing the mapping removes the whole tier entry
						ops.push({ op: "unset", path: base });
						continue;
					}
					if (provider === "" || model === "") {
						invalid.push(`${TIER_LABELS[tier] ?? tier} 的提供商与模型需同时填写`);
						continue;
					}
					if (provider === ROUTE) {
						invalid.push(`${TIER_LABELS[tier] ?? tier} 的提供商不能指向网关自身`);
						continue;
					}
					ops.push({ op: "set", path: [...base, "provider"], value: provider });
					ops.push({ op: "set", path: [...base, "model"], value: model });
					if (hasEffort) ops.push(effort === ""
						? { op: "unset", path: [...base, "reasoningEffort"] }
						: { op: "set", path: [...base, "reasoningEffort"], value: effort });
				} else if (hasEffort && provider !== "" && model !== "") {
					ops.push(effort === ""
						? { op: "unset", path: [...base, "reasoningEffort"] }
						: { op: "set", path: [...base, "reasoningEffort"], value: effort });
				}
				if (hasFallback) {
					const existingFallbacks = getPath(current, [...base, "fallbacks"]);
					const rest = Array.isArray(existingFallbacks) ? existingFallbacks.slice(1) : [];
					if (fallbackProvider === "" && fallbackModel === "") {
						if (rest.length > 0) ops.push({ op: "set", path: [...base, "fallbacks"], value: rest });
						else ops.push({ op: "unset", path: [...base, "fallbacks"] });
					} else if (fallbackProvider === "" || fallbackModel === "") {
						invalid.push(`${TIER_LABELS[tier] ?? tier} 的故障转移候选需同时填写提供商与模型`);
					} else if (fallbackProvider === ROUTE) {
						invalid.push(`${TIER_LABELS[tier] ?? tier} 的故障转移候选不能指向网关自身`);
					} else if (provider !== "" && model !== "") {
						ops.push({ op: "set", path: [...base, "fallbacks", 0, "provider"], value: fallbackProvider });
						ops.push({ op: "set", path: [...base, "fallbacks", 0, "model"], value: fallbackModel });
					}
				}
			}
			// Router entries: draft keys are `router.<family>.<field>`, plus the
			// top-level `enableRouter` selector. Blank strings unset the field; the
			// entry itself may stay behind — an all-default entry is inert.
			for (const key of Object.keys(draft)) {
				if (key === "enableRouter" || key === "router.enableRouter") {
					// Top-level selector: `router` is a dict of endpoint entries,
					// so `router.enableRouter` (a string) would fail the plugin's
					// schema validation and reject the whole save.
					ops.push({ op: "set", path: ["enableRouter"], value: draft[key] });
					continue;
				}
				if (!key.startsWith("router.")) continue;
				const segments = key.split("."); // ["router", family, field]
				if (segments.length !== 3) continue;
				// `api` was the chat-protocol selector and is gone: a judge
				// family has exactly one endpoint shape now. Ignore stale drafts
				// instead of resurrecting the retired field.
				if (segments[2] === "api") continue;
				const next = String(draft[key]).trim();
				ops.push(next === ""
					? { op: "unset", path: segments }
					: { op: "set", path: segments, value: next });
			}
			for (const [purpose] of AUX_PURPOSES) {
				if (`auxiliary.${purpose}` in draft) ops.push({ op: "set", path: ["auxiliary", purpose], value: draft[`auxiliary.${purpose}`] });
			}
			// Decision granularity: three top-level/nested fields the panel owns.
			if (typeof draft["@key"] === "string" && draft["@key"].trim() !== "") {
				// the staged key belongs to the family this save enables
				const family = draft["enableRouter"] ?? draft["router.enableRouter"]
					?? (textAt(current, ["enableRouter"]) || "jev");
				const kind = family === "startlux" ? "startlux" : "jev";
				secrets.push({ ref: JUDGE_KEY_ENVS[kind], value: draft["@key"].trim() });
			}
			return { ops, secrets, invalid };
		}
		//#endregion
		//#region lib/client/card.js
		/**
		 * The panel rendered on the gateway's provider card. Slot props carry the
		 * row entry; injected props carry the services (forms, remote).
		 */
		function TierGatewayCard(props) {
			const entry = props.provider;
			if (entry?.provider !== ROUTE) return null;
			if (entry.settingsNs !== undefined && entry.settingsNs !== NS) return null;
			const remote = props.remote;
			const forms = props.forms;
			const form = forms?.get?.(entry.settingsNs ?? NS) ?? null;
			const snapshot = useFormSnapshot(form);
			const catalog = useCatalog(remote, props.watch);
			const value = snapshot?.value ?? null;
			const [draft, setDraftState] = react.useState({});
			// The family the form is *showing*: a staged switch must retarget the
			// key presence check and the proxy section, not just the fields.
			const cardKind = judgeKindOfDraft(value, draft);
			const keyRef = JUDGE_KEY_ENVS[cardKind];
			const [refreshKey, setRefreshKey] = react.useState(0);
			const keyState = useCredential(remote, keyRef, refreshKey);
			const [busy, setBusy] = react.useState(false);
			const [testing, setTesting] = react.useState(false);
			const [notice, setNotice] = react.useState(null);
			const writable = snapshot?.writable === true;
			const disabled = !writable || busy;
			const setDraft = react.useCallback((key, next) => {
				setNotice(null);
				setDraftState((previous) => ({ ...previous, [key]: next }));
			}, []);
			const dirty = Object.keys(draft).length > 0;
			const onDiscard = () => {
				setDraftState({});
				setNotice(null);
			};
			const onTest = async () => {
				if (testing) return;
				setTesting(true);
				setNotice(null);
				try {
					const response = await fetch(JUDGE_TEST_PATH, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({
							...routerForTest(value, draft),
							key: draft["@key"] ?? "",
						}),
					});
					const payload = await response.json();
					if (payload?.ok === true) {
						const score = typeof payload.confidence === "number" ? `（置信度 ${payload.confidence.toFixed(2)}）` : "";
						setNotice({ ok: true, text: `判定：${payload.tier}${score} · ${(payload.ms / 1000).toFixed(1)}s` });
					} else {
						setNotice({ ok: false, text: `测试失败：${payload?.error ?? "未知错误"}` });
					}
				} catch (error) {
					setNotice({ ok: false, text: `测试失败：${error instanceof Error ? error.message : String(error)}` });
				} finally {
					setTesting(false);
				}
			};

			const onSave = async () => {
				if (!form || busy) return;
				const plan = buildPlan(draft, value);
				if (plan.invalid.length > 0) {
					setNotice({ ok: false, text: plan.invalid.join("；") });
					return;
				}
				setBusy(true);
				setNotice(null);
				let ok = true;
				// The key may only be stored once the config it belongs to landed;
				// otherwise a rejected save leaves an orphan credential behind and
				// the next "test" call appears to work against a config that was
				// never written.
				let configAccepted = true;
				const failures = [];
				try {
					if (plan.ops.length > 0) {
						const landed = await form.mutate(plan.ops);
						if (!landed) {
							ok = false;
							configAccepted = false;
							failures.push("配置未被接受，请重试");
						}
					}
					if (configAccepted) for (const secret of plan.secrets) {
						try {
							const response = await remote.credentials.set(secret.ref, secret.value);
							if (response !== null && typeof response === "object" && response.ok === false) {
								throw new Error(response.error?.message ?? "凭据服务拒绝了写入");
							}
						} catch (error) {
							ok = false;
							failures.push(`凭据 ${secret.ref} 保存失败：${error instanceof Error ? error.message : String(error)}`);
						}
					}
				} catch (error) {
					ok = false;
					failures.push(error instanceof Error ? error.message : String(error));
				} finally {
					setBusy(false);
				}
				if (ok) {
					setDraftState({});
					setRefreshKey((count) => count + 1);
					setNotice({ ok: true, text: "已保存" });
				} else {
					setNotice({ ok: false, text: failures.join("；") });
				}
			};
			if (snapshot !== null && snapshot.status !== "ready" && snapshot.status !== "loading") {
				return react_jsx_runtime.jsx("div", { style: card, children: react_jsx_runtime.jsx("p", { style: hintWarn, role: "status", children: "设置文档不可用。" }) });
			}
			return react_jsx_runtime.jsxs("div", {
				style: card,
				children: [
					react_jsx_runtime.jsx("h3", { style: sectionTitle, children: "判定模型" }),
					react_jsx_runtime.jsx(JudgeSection, {
						draft,
						current: value,
						disabled,
						setDraft,
						keyState,
					}),
					react_jsx_runtime.jsx("h3", { style: sectionTitle, children: "档位" }),
					catalog.status === "error" ? react_jsx_runtime.jsx("p", { style: hintWarn, children: `模型目录加载失败：${catalog.error instanceof Error ? catalog.error.message : String(catalog.error)}` }) : null,
					catalog.failures.length > 0 ? react_jsx_runtime.jsx("p", { style: hintWarn, children: `部分提供商目录不可用：${catalog.failures.map((failure) => failure.id).join("、")}` }) : null,
					catalog.status === "ready" && catalog.groups.length === 0 ? react_jsx_runtime.jsx("p", { style: hintWarn, children: "模型目录为空，稍后自动刷新。" }) : null,
					react_jsx_runtime.jsx("div", {
						style: tierGrid,
						children: TIERS.map((tier) => react_jsx_runtime.jsx(TierCard, {
							tier,
							draft,
							current: value,
							groups: catalog.groups,
							disabled,
							setDraft,
						}, tier)),
					}),
					react_jsx_runtime.jsx("h3", { style: sectionTitle, children: "辅助调用" }),
					react_jsx_runtime.jsx(AuxSection, {
						draft,
						current: value,
						disabled,
						setDraft,
					}),
					react_jsx_runtime.jsx(ProxySection, {
						value: draft[`router.${cardKind}.proxy`] ?? textAt(value, ["router", cardKind, "proxy"]),
						disabled,
						onChange: (next) => setDraft(`router.${cardKind}.proxy`, next),
					}),
					react_jsx_runtime.jsxs("div", {
						style: footer,
						children: [
							react_jsx_runtime.jsx(primitives.Button, {
								variant: "primary",
								size: "sm",
								disabled: disabled || !dirty,
								onClick: onSave,
								children: busy ? "保存中…" : "保存",
							}),
							react_jsx_runtime.jsx(primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: testing,
								onClick: onTest,
								children: testing ? "测试中…" : "测试",
							}),
							dirty && !busy ? react_jsx_runtime.jsx(primitives.Button, {
								variant: "outline",
								size: "sm",
								disabled: busy || testing,
								onClick: onDiscard,
								children: "放弃修改",
							}) : null,
							dirty ? react_jsx_runtime.jsx("span", { style: hintWarn, children: "有未保存的修改" }) : null,
							notice !== null ? react_jsx_runtime.jsx("span", { style: notice.ok === true ? noticeOk : noticeBad, role: "status", children: notice.text }) : null,
							!writable ? react_jsx_runtime.jsx("span", { style: hintWarn, children: "只读。" }) : null,
						],
					}),
				],
			});
		}
		//#endregion
		//#region lib/client/apply.js
		const inject = [
			"slots",
			"remote",
			"remote.session",
			"remote.credentials",
			"configForms",
		];
		/**
		 * Register the panel on the gateway's provider card. `slots.inject` waits
		 * for the Models section to declare the seat, so activation order does not
		 * matter; the disposer retires the registration with this plugin fiber.
		 * @param ctx - client plugin context.
		 */
		function apply(ctx) {
			/**
			 * Follow the Host's catalog invalidations: provider routes register and
			 * retire asynchronously (pi-ai profiles mount dormant until settings
			 * supply them), and model discovery lands after the first read.
			 */
			const watch = (notify) => {
				const disposers = [
					ctx.remote.$on("llm/adapters-updated", notify),
					ctx.remote.$on("settings/document-updated", notify),
					ctx.on("connection/reset", notify),
				];
				return () => {
					for (const dispose of disposers) dispose();
				};
			};
			ctx.slots.inject("settings.models.provider-card", () => ctx.slots.register({
				name: "settings.models.provider-card",
				key: NS,
				inject: () => ({
					remote: ctx.remote,
					forms: ctx.configForms,
					watch,
				}),
			}, TierGatewayCard));
		}
		//#endregion
		exports.inject = inject;
		exports.apply = apply;
		exports.TierGatewayCard = TierGatewayCard;
		exports.buildPlan = buildPlan;
		exports.getPath = getPath;
		exports.catalogOf = catalogOf;
		exports.judgeKindOfDraft = judgeKindOfDraft;
		exports.routerForTest = routerForTest;
		exports.providerChoices = providerChoices;
		exports.proxySummary = proxySummary;
		return module.exports;
	}
});
