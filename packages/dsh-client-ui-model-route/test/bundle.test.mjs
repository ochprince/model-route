/**
 * Node-side smoke tests for the model-route client panel bundle.
 *
 * The bundle is authored in the browser __ModuleLoader__ factory format; here a
 * stub captures the registration and drives the factory with minimal module
 * stubs, then exercises the exported registration contract and the pure save
 * plan builder.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "../lib/client.js"), "utf8");

let captured = null;
globalThis.window = {
	__ModuleLoader__: {
		load(definition) {
			captured = definition;
		},
	},
};

// Evaluate the bundle as a script so the window global drives registration.
new Function(source)();

assert.ok(captured, "bundle must register via window.__ModuleLoader__.load");
assert.equal(captured.id, "@jiangshilong/dsh-client-ui-model-route");

const reactStub = {
	Fragment: Symbol("fragment"),
	useState: (value) => [typeof value === "function" ? value() : value, () => {}],
	useEffect: () => {},
	useCallback: (fn) => fn,
	useMemo: (fn) => fn(),
	useRef: (value) => ({ current: value }),
};
const jsxStub = {
	jsxs: (type, props) => ({ type, props }),
	jsx: (type, props) => ({ type, props }),
};
const primitivesStub = {
	Tag: (props) => ({ type: "Tag", props }),
	Switch: () => null,
	SegmentedControl: () => null,
	Button: (props) => ({ type: "Button", props }),
	StateDot: () => null,
};
const requireStub = (spec) => {
	if (spec === "react") return reactStub;
	if (spec === "react/jsx-runtime") return jsxStub;
	if (spec === "@deepseek-ai/dsh-client-ui-primitives") return primitivesStub;
	throw new Error(`unexpected require: ${spec}`);
};

const exports = captured.factory(requireStub);

let checks = 0;
const ok = (name) => {
	checks += 1;
	console.log(`ok   ${name}`);
};

// ---- client plugin contract ----------------------------------------------
assert.deepEqual(exports.inject, [
	"slots",
	"remote",
	"remote.session",
	"remote.credentials",
	"configForms",
]);
assert.equal(typeof exports.apply, "function");
ok("client plugin exports the inject/apply contract");

// apply registers the keyed slot with the gateway's settingsNs as key.
const registrations = [];
let currentSlot = null;
const remoteListeners = new Map();
const ctx = {
	slots: {
		inject(slotName, register) {
			currentSlot = slotName;
			register();
			currentSlot = null;
		},
		register(descriptor, component) {
			registrations.push({ slotName: currentSlot, descriptor, component });
			return () => {};
		},
	},
	remote: {
		session: {},
		credentials: {},
		$on(event, listener) {
			remoteListeners.set(event, listener);
			return () => {
				remoteListeners.delete(event);
			};
		},
	},
	configForms: { get: () => null },
	on(event, listener) {
		remoteListeners.set(`ctx:${event}`, listener);
		return () => {
			remoteListeners.delete(`ctx:${event}`);
		};
	},
};
exports.apply(ctx);
assert.equal(registrations.length, 1);
assert.equal(registrations[0].slotName, "settings.models.provider-card");
assert.equal(registrations[0].descriptor.name, "settings.models.provider-card");
assert.equal(registrations[0].descriptor.key, "llm-model-route");
assert.equal(typeof registrations[0].descriptor.inject, "function");
const injected = registrations[0].descriptor.inject();
assert.equal(injected.remote, ctx.remote);
assert.equal(injected.forms, ctx.configForms);
assert.equal(typeof injected.watch, "function");
assert.equal(typeof registrations[0].component, "function");
ok("apply registers the provider-card panel keyed by the gateway namespace");

// The watch helper follows the Host's catalog invalidations and disposes them.
let notified = 0;
const disposeWatch = injected.watch(() => {
	notified += 1;
});
assert.equal(typeof disposeWatch, "function");
assert.ok(remoteListeners.has("llm/adapters-updated"));
assert.ok(remoteListeners.has("settings/document-updated"));
assert.ok(remoteListeners.has("ctx:connection/reset"));
remoteListeners.get("llm/adapters-updated")();
assert.equal(notified, 1);
disposeWatch();
assert.equal(remoteListeners.size, 0);
ok("watch reloads the catalog on adapters/settings/reset and disposes");

// The card refuses to render on foreign provider rows.
const card = exports.TierGatewayCard;
assert.equal(card({ provider: { provider: "aiapi" } }), null);
assert.equal(card({ provider: { provider: "model-route", settingsNs: "other" } }), null);
ok("panel only renders on the model-route card");

// Render the panel's element tree with the stub runtime: the proxy belongs at
// the bottom, collapsed, and never echoes credentials; no protocol selector.
{
	const textsOf = (node, out = []) => {
		if (node === null || node === undefined || typeof node === "boolean") return out;
		if (typeof node === "string" || typeof node === "number") {
			out.push(String(node));
			return out;
		}
		if (Array.isArray(node)) {
			for (const child of node) textsOf(child, out);
			return out;
		}
		if (typeof node === "object" && node.props) {
			if (typeof node.type === "function") textsOf(node.type(node.props), out);
			else textsOf(node.props.children, out);
		}
		return out;
	};
	const renderPanel = (proxy) => {
		const value = {
			enableRouter: "jev",
			tiers: {
				opus: { provider: "aiapi", model: "glm-5.3" },
				sonnet: { provider: "aiapi", model: "glm-5.3-flash" },
				haiku: { provider: "aiapi", model: "deepseek-v4-flash" },
			},
			router: { jev: { baseURL: "https://api.typesafe.ai/v1", model: "jev-latest", ...(proxy === "" ? {} : { proxy }) } },
			auxiliary: { compaction: "haiku", "session-title": "haiku" },
		};
		const form = {
			getSnapshot: () => ({ status: "ready", writable: true, value }),
			subscribe: () => () => {},
			mutate: async () => true,
		};
		const remote = {
			session: {
				modelCatalog: async () => ({
					ok: true,
					value: { groups: [{ id: "aiapi", name: "aiapi", models: [{ id: "glm-5.3", name: "glm-5.3" }] }], failures: [] },
				}),
			},
			credentials: { describe: async () => ({ ok: true, value: {} }) },
		};
		const tree = card({
			provider: { provider: "model-route", settingsNs: "llm-model-route" },
			remote,
			forms: { get: () => form },
			watch: () => () => {},
		});
		return textsOf(tree);
	};

	const plain = renderPanel("");
	const joined = plain.join("\n");
	assert.match(joined, /判定模型/);
	assert.ok(plain.includes("代理（可选）"), "the proxy section renders");
	assert.equal(joined.includes("协议"), false, "no protocol selector remains");
	assert.ok(plain.indexOf("代理（可选）") > plain.indexOf("辅助调用"), "the proxy sits below the auxiliary tiers");
	assert.ok(plain.includes("设置"), "a collapsed proxy offers a setup button");
	assert.equal(plain.includes("HTTP(S) 代理地址"), false, "the proxy field starts collapsed");
	assert.equal(joined.includes("默认直连"), false, "a collapsed proxy adds no explanatory copy");
	assert.equal(joined.includes("先配置判定模型"), false, "the panel has no introductory wall of text");

	const configured = renderPanel("http://user:pass@127.0.0.1:7897");
	assert.ok(configured.includes("http://127.0.0.1:7897"), "the summary shows the proxy target");
	assert.equal(configured.some((text) => text.includes("user") || text.includes("pass")), false, "proxy credentials are never echoed");
	assert.ok(configured.includes("修改"), "a configured proxy offers an edit button");
	ok("panel keeps the proxy last and collapsed, without a protocol selector");
}

// ---- save plan ------------------------------------------------------------
const { buildPlan, getPath } = exports;

// full tier write, with effort cleared
{
	const plan = buildPlan(
		{
			"tiers.opus.provider": "aiapi",
			"tiers.opus.model": "glm-5.3",
			"tiers.opus.reasoningEffort": "",
		},
		{ tiers: { opus: { provider: "aiapi", model: "glm-5.3-flash" } } },
	);
	assert.equal(plan.invalid.length, 0);
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "tiers.opus.provider" && op.value === "aiapi"));
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "tiers.opus.model" && op.value === "glm-5.3"));
	assert.ok(plan.ops.some((op) => op.op === "unset" && op.path.join(".") === "tiers.opus.reasoningEffort"));
	ok("buildPlan writes tier provider/model and clears effort");
}

// cleared tier unsets the whole mapping
{
	const plan = buildPlan(
		{ "tiers.haiku.provider": "", "tiers.haiku.model": "" },
		{ tiers: { haiku: { provider: "aiapi", model: "deepseek-v4-flash" } } },
	);
	assert.equal(plan.invalid.length, 0);
	assert.ok(plan.ops.some((op) => op.op === "unset" && op.path.join(".") === "tiers.haiku"));
	ok("buildPlan clears an unmapped tier");
}

// half-filled tier blocks the save
{
	const plan = buildPlan({ "tiers.opus.provider": "aiapi" }, {});
	assert.equal(plan.invalid.length, 1);
	ok("buildPlan refuses a tier with only a provider");
}

// fallback preserved when extra entries exist, dropped when sole
{
	const current = { tiers: { opus: { provider: "a", model: "b", fallbacks: [{ provider: "x", model: "y" }, { provider: "p2", model: "m2" }] } } };
	const plan = buildPlan({ "tiers.opus.fallbacks.0.provider": "", "tiers.opus.fallbacks.0.model": "" }, current);
	const set = plan.ops.find((op) => op.op === "set" && op.path.join(".") === "tiers.opus.fallbacks");
	assert.ok(set, "rewrites the remaining fallbacks");
	assert.deepEqual(set.value, [{ provider: "p2", model: "m2" }]);

	const plan2 = buildPlan({ "tiers.opus.fallbacks.0.provider": "", "tiers.opus.fallbacks.0.model": "" }, { tiers: { opus: { provider: "a", model: "b", fallbacks: [{ provider: "x", model: "y" }] } } });
	assert.ok(plan2.ops.some((op) => op.op === "unset" && op.path.join(".") === "tiers.opus.fallbacks"));

	const plan3 = buildPlan(
		{ "tiers.opus.fallbacks.0.provider": "aiapi", "tiers.opus.fallbacks.0.model": "deepseek-v4-flash" },
		{ tiers: { opus: { provider: "a", model: "b" } } },
	);
	assert.ok(plan3.ops.some((op) => op.op === "set" && op.path.join(".") === "tiers.opus.fallbacks.0.provider"));
	ok("buildPlan preserves or drops the fallback slot correctly");
}

// half-filled fallback blocks the save
{
	const plan = buildPlan({ "tiers.opus.fallbacks.0.provider": "aiapi", "tiers.opus.fallbacks.0.model": "" }, {});
	assert.equal(plan.invalid.length, 1);
	ok("buildPlan refuses a half-filled fallback candidate");
}

// router entry fields clear to unset; the retired flat knobs never write
{
	const plan = buildPlan(
		{
			"enableRouter": "jev",
			"router.jev.baseURL": "https://gw/v1",
			"router.jev.model": "",
			"router.jev.api": "anthropic-messages",
			"router.jev.proxy": "http://127.0.0.1:7897",
		},
		{},
	);
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "enableRouter" && op.value === "jev"));
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "router.jev.proxy" && op.value === "http://127.0.0.1:7897"));
	assert.equal(plan.ops.some((op) => op.path.join(".") === "router.enableRouter"), false, "the selector never nests inside the router dict");
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "router.jev.baseURL" && op.value === "https://gw/v1"));
	assert.ok(plan.ops.some((op) => op.op === "unset" && op.path.join(".") === "router.jev.model"));
	assert.equal(plan.ops.some((op) => op.path.join(".") === "router.jev.api"), false, "the retired protocol field is never written");
	assert.equal(plan.ops.some((op) => op.path.join(".") === "router.enabled" || op.path.join(".") === "router.strategy"), false);

	// a panel left mid-edit by the old bundle may still hold the legacy key:
	// migrate it to the top-level selector instead of writing the invalid path
	const legacyDraft = buildPlan({ "router.enableRouter": "startlux" }, {});
	assert.ok(legacyDraft.ops.some((op) => op.op === "set" && op.path.join(".") === "enableRouter" && op.value === "startlux"));
	assert.equal(legacyDraft.ops.some((op) => op.path.join(".") === "router.enableRouter"), false);

	const plan2 = buildPlan({ "router.enabled": false, "router.strategy": "free", "router.timeoutMs": "30000" }, {});
	assert.equal(plan2.ops.length, 0);
	ok("buildPlan writes router.<family> entries and ignores retired flat knobs");
}

// JEV now speaks System One natively, so its own /systemone address saves
{
	const current = { enableRouter: "jev", router: { jev: { baseURL: "https://api.typesafe.ai/v1" } } };
	const plan = buildPlan(
		{ "router.jev.baseURL": "https://api.typesafe.ai/v1/systemone", "router.jev.model": "jev-latest" },
		current,
	);
	assert.equal(plan.invalid.length, 0, "JEV + /systemone is valid");
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "router.jev.baseURL" && op.value === "https://api.typesafe.ai/v1/systemone"));
	ok("buildPlan accepts the JEV System One endpoint under JEV");
}

// auxiliary tier picks; the retired cache/sizing knobs never write
{
	const plan = buildPlan({ "auxiliary.compaction": "sonnet", "cache.turnFreeze": false, "cache.memoMaxEntries": "8", "router.timeoutMs": "30000" }, {});
	assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === "auxiliary.compaction" && op.value === "sonnet"));
	assert.equal(plan.ops.some((op) => op.path.join(".").startsWith("cache.") || op.path.join(".") === "router.timeoutMs"), false);
	assert.equal(plan.invalid.length, 0);
	ok("buildPlan writes auxiliary tiers and ignores retired cache knobs");
}

// the panel no longer owns granularity or a delegation switch
{
	const plan = buildPlan({}, {});
	assert.equal(plan.ops.length, 0, "an untouched panel writes nothing");
	assert.equal(plan.ops.some((op) => op.path.join(".") === "decideAt"), false);
	assert.equal(plan.ops.some((op) => op.path.join(".").startsWith("stage.")), false);
	assert.equal(plan.ops.some((op) => op.path.join(".").startsWith("delegate.")), false);
	ok("buildPlan writes no removed granularity or delegation fields");
}

// the secret write targets the enabled family's own credential name
{
	const plan = buildPlan({ "@key": "  sk-jev  ", "router.jev.apiKeyEnv": "MY_JEV" }, {});
	assert.deepEqual(plan.secrets, [{ ref: "JEV_API_KEY", value: "sk-jev" }], "the family decides the name; a leftover apiKeyEnv is inert");
	const plan2 = buildPlan({ "@key": "sk-jev" }, { enableRouter: "startlux", router: { startlux: { apiKeyEnv: "CUR_REF" } } });
	assert.deepEqual(plan2.secrets, [{ ref: "BAMBOO_API_KEY", value: "sk-jev" }]);
	const plan3 = buildPlan({ "@key": "sk-jev" }, {});
	assert.deepEqual(plan3.secrets, [{ ref: "JEV_API_KEY", value: "sk-jev" }], "saved family without an entry");
	const plan4 = buildPlan({ "@key": "sk-bamboo", "enableRouter": "startlux" }, {});
	assert.deepEqual(plan4.secrets, [{ ref: "BAMBOO_API_KEY", value: "sk-bamboo" }], "staged family decides the name");
	const plan5 = buildPlan({ "@key": "" }, {});
	assert.equal(plan5.secrets.length, 0);
	ok("buildPlan routes the judge key to the enabled family's own credential");
}

// getPath nested reads
{
	const value = { tiers: { opus: { provider: "aiapi" } } };
	assert.equal(getPath(value, ["tiers", "opus", "provider"]), "aiapi");
	assert.equal(getPath(value, ["tiers", "sonnet", "provider"]), undefined);
	assert.equal(getPath(null, ["a"]), undefined);
	ok("getPath reads nested config paths");
}

console.log(`client-panel: ${checks} checks passed`);

// ---- per-family router entries --------------------------------------------
{
	// each family edits its own entry; saving the selector enables that family
	const current = {
		enableRouter: "startlux",
		router: {
			startlux: { baseURL: "https://api.bamboonode.dev/v1", model: "startlux-decision-27b-autothink" },
			jev: { baseURL: "https://jev.saved/v1", model: "jev-model", api: "openai-completions" },
		},
	};

	// staged edits for BOTH families coexist: nothing is banked or overwritten
	const plan = buildPlan(
		{
			"enableRouter": "jev",
			"router.jev.baseURL": "https://jev.new/v1",
			"router.jev.model": "jev-model",
			"router.startlux.baseURL": "https://api.bamboonode.dev/v1",
			"router.startlux.model": "startlux-decision-27b-autothink",
		},
		current,
	);
	for (const [path, value] of [
		["enableRouter", "jev"],
		["router.jev.baseURL", "https://jev.new/v1"],
		["router.startlux.baseURL", "https://api.bamboonode.dev/v1"],
	]) {
		assert.ok(plan.ops.some((op) => op.op === "set" && op.path.join(".") === path && op.value === value), `sets ${path}`);
	}
	assert.equal(plan.secrets.length, 0);
	ok("buildPlan writes both families' entries and the enable selector");

	// a first use of a family stages fields over an absent entry
	const fresh = buildPlan(
		{ "enableRouter": "startlux", "router.startlux.baseURL": "https://bamboo.new/v1", "router.startlux.model": "s1" },
		{ router: {} },
	);
	assert.ok(fresh.ops.some((op) => op.op === "set" && op.path.join(".") === "router.startlux.baseURL" && op.value === "https://bamboo.new/v1"));
	assert.ok(fresh.ops.some((op) => op.op === "set" && op.path.join(".") === "enableRouter" && op.value === "startlux"));
	ok("buildPlan creates an entry on first use of a family");

	// clearing the form's fields unsets them but never touches the other family
	const cleared = buildPlan(
		{ "enableRouter": "startlux", "router.startlux.baseURL": "", "router.startlux.model": "" },
		current,
	);
	assert.ok(cleared.ops.some((op) => op.op === "unset" && op.path.join(".") === "router.startlux.baseURL"));
	assert.ok(cleared.ops.some((op) => op.op === "unset" && op.path.join(".") === "router.startlux.model"));
	assert.equal(cleared.ops.some((op) => op.path.join(".").startsWith("router.jev")), false, "the other family's entry is untouched");
	ok("clearing one family leaves the other family's entry alone");

	// the edited family is what judgeKindOfDraft reports, staged first
	const { judgeKindOfDraft } = exports;
	assert.equal(judgeKindOfDraft(current, {}), "startlux", "saved selector");
	assert.equal(judgeKindOfDraft(current, { "enableRouter": "jev" }), "jev", "staged selector wins");
	assert.equal(judgeKindOfDraft({}, {}), "jev", "defaults to jev");
	ok("judgeKindOfDraft resolves the staged or saved family");
}

// ---- provider choices ----------------------------------------------------
{
	const providerChoices = exports.providerChoices;
	assert.equal(typeof providerChoices, "function");
	const groups = [
		{ id: "model-route", name: "ModelRoute 智能模型路由", models: [] },
		{ id: "aiapi", name: "aiapi", models: [] },
		{ id: "deepseek-account", name: "DeepSeek Account", models: [] },
	];
	const options = providerChoices(groups, "aiapi");
	assert.deepEqual(options.map((o) => o.value), ["aiapi", "deepseek-account"], "the gateway's own route is not an upstream");
	// a configured value the catalog dropped still displays (even the self route)
	const legacy = providerChoices(groups, "model-route");
	assert.ok(legacy.some((o) => o.value === "model-route"), "the current configured value always displays");
	assert.equal(legacy.filter((o) => o.value === "model-route").length, 1, "and only once");
	// an empty catalog reports unavailability instead of an empty select
	assert.deepEqual(providerChoices([], ""), [{ value: "", label: "（模型目录未就绪）" }]);
	ok("provider choices exclude the gateway route");
}

// ---- test request --------------------------------------------------------
{
	const routerForTest = exports.routerForTest;
	assert.equal(typeof routerForTest, "function");
	const merged = routerForTest(
		{
			enableRouter: "startlux",
			router: {
				startlux: { baseURL: "https://bamboo/v1", model: "startlux-decision-27b-autothink", timeoutMs: 20000 },
				jev: { baseURL: "https://saved/v1", model: "saved-model", api: "openai-completions", timeoutMs: 20000 },
			},
		},
		{
			"enableRouter": "startlux",
			"router.startlux.baseURL": "https://draft/v1",
			"router.startlux.model": "draft-model",
		},
	);
	assert.equal(merged.kind, "startlux", "staged family wins");
	assert.equal(merged.baseURL, "https://draft/v1", "staged address wins");
	assert.equal(merged.model, "draft-model", "staged model wins");
	assert.equal(merged.api, undefined, "the retired protocol field is not part of the test request");
	assert.equal(merged.timeoutMs, 20000, "untouched entry fields are kept");

	const jevDraft = routerForTest(
		{ enableRouter: "jev", router: { jev: { baseURL: "https://saved/v1", model: "saved-model", api: "openai-completions", timeoutMs: 20000 } } },
		{ "router.jev.model": "draft-model" },
	);
	assert.equal(jevDraft.kind, "jev");
	assert.equal(jevDraft.baseURL, "https://saved/v1", "the saved entry backs the draft");
	assert.equal(jevDraft.model, "draft-model");
	ok("the test request merges staged values over the edited family's entry");
}

// ---- proxy summary -------------------------------------------------------
{
	const { proxySummary } = exports;
	assert.equal(proxySummary(""), "", "no proxy renders no summary");
	assert.equal(proxySummary("   "), "");
	assert.equal(proxySummary("http://127.0.0.1:7897"), "http://127.0.0.1:7897");
	assert.equal(proxySummary("127.0.0.1:7897"), "http://127.0.0.1:7897", "a bare host:port is summarized as HTTP");
	assert.equal(proxySummary("http://user:pass@proxy.example:8080"), "http://proxy.example:8080", "credentials never reach the page");
	assert.equal(proxySummary("not a url"), "已配置", "an unparsable value still reports a configured proxy");
	ok("proxySummary shows the target host without credentials");
}

// ---- remote answer unwrapping --------------------------------------------
{
	const catalogOf = exports.catalogOf;
	assert.equal(typeof catalogOf, "function");

	// Host remotes answer with an envelope; the bare catalog is nested in `.value`.
	const unwrapped = catalogOf({
		ok: true,
		value: {
			groups: [{ id: "aiapi", name: "aiapi", models: [{ id: "glm-5.3", name: "glm-5.3" }] }],
			failures: [],
		},
	});
	assert.equal(unwrapped.groups.length, 1);
	assert.equal(unwrapped.groups[0].id, "aiapi");

	// A refused read must surface as an error, not as an empty catalog.
	assert.throws(() => catalogOf({ ok: false, error: { code: "RATE_LIMIT", message: "slow down" } }), /RATE_LIMIT/);

	// A bare catalog (plain transport) still reads.
	const bare = catalogOf({ groups: [{ id: "x", name: "x", models: [] }], failures: [{ id: "y", name: "y", message: "m" }] });
	assert.equal(bare.groups.length, 1);
	assert.equal(bare.failures.length, 1);

	// Missing shape degrades to empty groups instead of throwing.
	const empty = catalogOf(undefined);
	assert.deepEqual(empty, { groups: [], failures: [] });
	ok("catalogOf unwraps the remote envelope and refuses errors");
}

console.log(`client-panel: ${checks} checks passed`);
