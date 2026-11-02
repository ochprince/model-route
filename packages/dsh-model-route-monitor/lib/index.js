/**
 * ModelRoute economy monitor — Host half.
 *
 * Observes the `llm/stream` waterfall for calls that enter the model-route gateway,
 * follows each gateway call into its nested upstream call to learn which tier
 * actually served it, and records tokens only. Prices stay outside the record
 * so editing a unit price immediately re-prices history.
 *
 * The browser half polls one same-origin snapshot route; the data never leaves
 * this Host except as that local HTTP response.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import {
	BUILTIN_FALLBACKS,
	TIERS,
	aggregateRecords,
	buildRecentDelegations,
	buildRecentRoutes,
	buildTierMap,
	callCost,
	effectiveTierPrices,
	judgeFromDecision,
	matchDecisionForRecord,
	normalizePrices,
	normalizeRange,
	normalizeTier,
	normalizeUsage,
	priceTemplatePatch,
	resolveModelPrice,
	resolveTier,
} from "./model.js";
export const name = "model-route-monitor";
export const inject = ["llm"];

const NS = "model-route-monitor";
const GATEWAY_PACKAGE = "@jiangshilong/dsh-llm-model-route";
const SNAPSHOT_PATH = "/model-route-monitor/snapshot";
const OPEN_CONFIG_PATH = "/model-route-monitor/open-config";
const PREVIEW_PATH = "/model-route-monitor/preview";
const FILE_MAX_BYTES = 8 * 1024 * 1024;
const RECENT_LIMIT = 24;
const GATEWAY_CACHE_MS = 2500;

const PriceSchema = z.object({
	input: z.number().default(0).description("每百万输入 token 的单价"),
	output: z.number().default(0).description("每百万输出 token 的单价"),
	cacheRead: z.number().default(0).description("每百万缓存命中输入 token 的单价"),
});

const Config = z.object({
	gatewayPackage: z.string().default(GATEWAY_PACKAGE)
		.description("要监控的网关插件包名；用于从 profile 配置中读取档位到上游模型的映射"),
	gatewayRoute: z.string().default("model-route")
		.description("读不到网关配置时使用的 provider 路由名"),
	prices: z.dict(PriceSchema).default({}).volatile()
		.description("手动模式的三档单价（每百万 token）；0 表示未配置。开启 autoPrices 时被自动价格覆盖"),
	currency: z.string().default("USD").description("单价与金额的货币代码"),
	autoPrices: z.boolean().default(true).volatile()
		.description("按内置价格表自动匹配当前档位模型；关闭后使用 prices 中的手动单价"),
	persist: z.boolean().default(true).description("把调用记录追加到 $DSH_HOME/logs/model-route-monitor.jsonl"),
	maxRecords: z.number().default(5000).description("内存与文件中保留的调用记录上限"),
});

/** A finite non-negative integer inside a bound. */
function boundedInteger(value, fallback, min, max) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number)) return fallback;
	return Math.max(min, Math.min(max, Math.floor(number)));
}

/** Read the reactive config proxy into plain values. */
function readConfig(raw) {
	return {
		gatewayPackage: cleanString(raw?.gatewayPackage) || GATEWAY_PACKAGE,
		gatewayRoute: cleanString(raw?.gatewayRoute) || "model-route",
		prices: normalizePrices(raw?.prices),
		currency: cleanString(raw?.currency) || "USD",
		autoPrices: raw?.autoPrices !== false,
		persist: raw?.persist !== false,
		maxRecords: boundedInteger(raw?.maxRecords, 5000, 100, 50000),
	};
}

/** A trimmed string, or an empty string. */
function cleanString(value) {
	return typeof value === "string" ? value.trim() : "";
}

/** A plain object, or an empty one. */
function objectOf(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Read `tiers` from one gateway config row, keeping only model selection. */
function readTiers(raw) {
	const source = objectOf(raw);
	const tiers = {};
	for (const [tier, value] of Object.entries(source)) {
		const entry = objectOf(value);
		const provider = cleanString(entry.provider);
		const model = cleanString(entry.model);
		if (provider === "" || model === "") continue;
		tiers[tier] = {
			provider,
			model,
			fallbacks: (Array.isArray(entry.fallbacks) ? entry.fallbacks : [])
				.map((candidate) => ({
					provider: cleanString(objectOf(candidate).provider),
					model: cleanString(objectOf(candidate).model),
				}))
				.filter((candidate) => candidate.provider !== "" && candidate.model !== ""),
		};
	}
	return tiers;
}

/** The public, secret-free shape of a gateway's tier mapping. */
function publicTiers(tiers) {
	const output = {};
	for (const [tier, value] of Object.entries(tiers ?? {})) {
		output[tier] = {
			provider: value.provider,
			model: value.model,
			fallbacks: value.fallbacks ?? [],
		};
	}
	return output;
}

/**
 * Read the live model-route row from the profile through the config editor.
 * Cached briefly because the editor composes profile layers on every read and
 * model calls are much rarer than this TTL.
 */
function createGatewayReader(ctx, cfg, logger) {
	let cached = null;
	let cachedAt = 0;
	let warned = false;
	const warnOnce = (error) => {
		if (warned) return;
		warned = true;
		logger?.warn?.(`model-route-monitor: cannot read gateway configuration (${error?.message ?? error}); tier attribution falls back to explicit aliases`);
	};
	const invalidate = () => {
		cached = null;
		cachedAt = 0;
	};
	const get = () => {
		const current = cfg();
		const now = Date.now();
		if (cached !== null && cached.requestedPackage === current.gatewayPackage && now - cachedAt < GATEWAY_CACHE_MS) return cached;
		const fallback = {
			found: false,
			package: current.gatewayPackage,
			requestedPackage: current.gatewayPackage,
			route: current.gatewayRoute,
			tiers: {},
			tierMap: new Map(),
			judge: { family: "jev", model: null },
			log: { enabled: false, path: "" },
		};
		try {
			const editor = ctx.get("configEditor");
			if (editor === undefined || typeof editor.configuration !== "function") {
				cached = fallback;
				cachedAt = now;
				return cached;
			}
			const rows = editor.configuration();
			const row = (Array.isArray(rows) ? rows : []).find((candidate) => {
				const options = candidate?.entry?.options ?? {};
				return options.name === current.gatewayPackage || options.id === "llm-model-route";
			});
			if (row === undefined) {
				cached = fallback;
				cachedAt = now;
				return cached;
			}
			// `options.config` is the live resolved row; inherited/override cover
			// layers when the row itself carries only a partial override.
			const config = {
				...objectOf(row.inherited),
				...objectOf(row.override),
				...objectOf(row.entry?.options?.config),
			};
			const tiers = readTiers(config.tiers);
			const route = cleanString(config.route) || current.gatewayRoute;
			const family = cleanString(config.enableRouter) === "startlux" ? "startlux" : "jev";
			const router = objectOf(objectOf(config.router)[family]);
			cached = {
				found: true,
				package: current.gatewayPackage,
				requestedPackage: current.gatewayPackage,
				route,
				tiers,
				tierMap: buildTierMap(tiers),
				judge: {
					family,
					model: cleanString(router.model) || null,
					provider: cleanString(router.provider) || null,
				},
				log: {
					enabled: objectOf(config.log).enabled === true,
					path: cleanString(objectOf(config.log).path),
				},
			};
			cachedAt = now;
			return cached;
		} catch (error) {
			warnOnce(error);
			cached = fallback;
			cachedAt = now;
			return cached;
		}
	};
	return { get, invalidate };
}

/** Read at most a small tail of the gateway JSONL decision log. */
function readDecisionLog(file, limit = 400) {
	if (!existsSync(file)) return [];
	let size = 0;
	try {
		size = statSync(file).size;
	} catch {
		return [];
	}
	if (size === 0) return [];
	const start = Math.max(0, size - 1_000_000);
	let text = "";
	try {
		const fd = openSync(file, "r");
		try {
			const buffer = Buffer.alloc(size - start);
			readSync(fd, buffer, 0, buffer.length, start);
			text = buffer.toString("utf8");
		} finally {
			closeSync(fd);
		}
	} catch {
		return [];
	}
	const decisions = [];
	for (const line of text.split(/\r?\n/)) {
		if (line.trim() === "") continue;
		try {
			const record = JSON.parse(line);
			// "route" lines are per-call routing decisions; "delegate" lines are
			// the route_tier judgments made before a subagent is delegated. Both
			// are judgments the panel can explain.
			if (record?.kind === "route" || record?.kind === "delegate") decisions.push(record);
		} catch {
			// A torn first line is expected when the tail starts mid-record.
		}
	}
	return decisions.slice(-limit);
}

/** Read recent gateway decisions through inspect, falling back to its JSONL log. */
function createDecisionReader(ctx, gateway, logger) {
	let cached = [];
	let cachedAt = 0;
	let inFlight = null;
	let warned = false;
	const get = () => {
		const now = Date.now();
		if (now - cachedAt < 1200) return Promise.resolve(cached);
		if (inFlight !== null) return inFlight;
		inFlight = (async () => {
			let inspectError = null;
			// The JSONL route line carries the user-message preview, which the
			// in-memory inspect records omit. Prefer the log when it is enabled.
			try {
				const facts = gateway.get();
				if (facts.log?.enabled === true) {
					const home = process.env.DSH_HOME || join(homedir(), ".dsh");
					const file = facts.log.path || join(home, "logs", "model-route.jsonl");
					const decisions = readDecisionLog(file);
					if (decisions.length > 0) {
						cached = decisions;
						return cached;
					}
				}
			} catch {
				// fall through to inspect
			}
			try {
				const inspect = ctx.get("cordisInspect");
				if (inspect !== undefined && typeof inspect.query === "function") {
					const result = await inspect.query("host", "model-route", "listDecisions", { limit: 200 }, undefined, new AbortController().signal);
					const decisions = Array.isArray(result?.decisions) ? result.decisions : [];
					if (decisions.length > 0) {
						cached = decisions;
						return cached;
					}
				}
			} catch (error) {
				inspectError = error;
			}
			if (inspectError !== null && !warned) {
				warned = true;
				logger?.warn?.(`model-route-monitor: gateway decisions are unavailable (${inspectError?.message ?? inspectError}); decision details will be omitted`);
			}
			cached = [];
			return cached;
		})();
		return inFlight.finally(() => {
			cachedAt = Date.now();
			inFlight = null;
		});
	};
	return { get };
}

/** Normalize one persisted line back into a record. */
/** Normalize one persisted line back into a record. */
function readRecord(value) {
	const source = objectOf(value);
	const at = Number(source.at);
	if (!Number.isFinite(at) || at <= 0) return null;
	return {
		v: 1,
		at,
		sessionId: cleanString(source.sessionId) || null,
		tier: normalizeTier(source.tier),
		provider: cleanString(source.provider) || null,
		model: cleanString(source.model) || null,
		requestedModel: cleanString(source.requestedModel) || null,
		purpose: cleanString(source.purpose) || null,
		usage: normalizeUsage(source.usage),
		ms: Number.isFinite(Number(source.ms)) ? Math.max(0, Number(source.ms)) : 0,
		finish: cleanString(source.finish) || "ok",
	};
}

/** Load the newest records from the append-only file. */
function loadRecords(file, maxRecords, logger) {
	try {
		if (!existsSync(file)) return [];
		const text = readFileSync(file, "utf8");
		const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
		const from = Math.max(0, lines.length - maxRecords * 2);
		const records = [];
		for (let index = from; index < lines.length; index += 1) {
			try {
				const record = readRecord(JSON.parse(lines[index]));
				if (record !== null) records.push(record);
			} catch {
				// A torn final line or an older record shape is skipped; one bad
				// line must not hide the rest of the history.
			}
		}
		return records.slice(-maxRecords);
	} catch (error) {
		logger?.warn?.(`model-route-monitor: cannot read usage history (${error?.message ?? error}); starting empty`);
		return [];
	}
}

/** In-memory ring plus an append-only, self-rotating history file. */
function createRecordStore(cfg, logger) {
	const home = process.env.DSH_HOME || join(homedir(), ".dsh");
	const file = join(home, "logs", "model-route-monitor.jsonl");
	let writeWarned = false;
	let directoryReady = false;
	let records = cfg().persist ? loadRecords(file, cfg().maxRecords, logger) : [];
	const ensureDirectory = () => {
		if (directoryReady) return;
		mkdirSync(dirname(file), { recursive: true });
		directoryReady = true;
	};
	return {
		file,
		records: () => records,
		add(record) {
			records.push(record);
			const max = cfg().maxRecords;
			if (records.length > max) records.splice(0, records.length - max);
			if (!cfg().persist) return;
			try {
				ensureDirectory();
				try {
					if (statSync(file).size > FILE_MAX_BYTES) renameSync(file, `${file}.1`);
				} catch {
					// absent file: nothing to rotate
				}
				appendFileSync(file, `${JSON.stringify(record)}\n`);
			} catch (error) {
				if (writeWarned) return;
				writeWarned = true;
				logger?.warn?.(`model-route-monitor: cannot append usage history (${error?.message ?? error}); further failures are silent`);
			}
		},
	};
}

/** One JSON response. */
function respondJson(res, status, payload) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store, max-age=0",
		"x-content-type-options": "nosniff",
	});
	res.end(JSON.stringify(payload));
}

/** Read a bounded JSON request body. */
async function readJsonBody(req, limit = 64 * 1024) {
	let size = 0;
	const chunks = [];
	for await (const chunk of req) {
		size += chunk.length;
		if (size > limit) throw new Error("request body too large");
		chunks.push(chunk);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	return text.trim() === "" ? {} : JSON.parse(text);
}

/** The active profile patch that persists this plugin's config. */
function profilePatchPath(ctx) {
	try {
		const editor = ctx.get("configEditor");
		const path = editor?.documentPath;
		if (typeof path === "string" && path.trim() !== "") return path;
	} catch {
		// fall through to the profile directory
	}
	const dir = cleanString(process.env.DSH_PROFILE_DIR);
	return dir === "" ? null : join(dir, "cordis.patch.yml");
}

/**
 * Make sure the profile row contains a complete prices template before the
 * user opens it in an editor, so "open config" lands on fields to fill rather
 * than an empty row.
 */
async function ensurePriceTemplate(ctx) {
	const editor = ctx.get("configEditor");
	if (editor === undefined || typeof editor.entries !== "function" || typeof editor.edit !== "function") {
		return { changed: false, error: "config editor unavailable" };
	}
	const entry = (editor.entries() ?? []).find((candidate) => {
		const id = candidate?.options?.id;
		return id === "model-route-monitor" || id === "include:model-route-monitor";
	});
	if (entry === undefined) return { changed: false, error: "monitor entry not found" };
	// The bundle's own patch row is not the profile override the user opens.
	// Even when schema defaults already supply zeros, make sure the profile
	// patch gets an explicit row so the file has prices to edit.
	let hasProfileOverride = false;
	try {
		const row = (editor.configuration?.() ?? []).find((candidate) => candidate?.entry?.options?.id === entry.options.id);
		hasProfileOverride = row?.override !== null && typeof row?.override === "object" && row.override.prices !== undefined;
	} catch {
		hasProfileOverride = false;
	}
	const current = objectOf(entry?.options?.config);
	if (hasProfileOverride && priceTemplatePatch(current) === null) return { changed: false };
	await editor.edit(entry, (raw) => priceTemplatePatch(objectOf(raw)) ?? objectOf(raw));
	invalidateLivePrices(ctx);
	return { changed: true };
}

const BUNDLED_PRICES = (() => {
	try {
		const file = fileURLToPath(new URL("../data/prices.json", import.meta.url));
		const raw = JSON.parse(readFileSync(file, "utf8"));
		const table = new Map(Object.entries(raw.catalog ?? {}));
		const fallback = {
			prices: new Map(Object.entries(raw.fallbacks?.prices ?? {})),
			patterns: Array.isArray(raw.fallbacks?.patterns) ? raw.fallbacks.patterns : BUILTIN_FALLBACKS.patterns,
		};
		return {
			table,
			fallback,
			meta: {
				generatedAt: typeof raw.generatedAt === "string" ? raw.generatedAt : null,
				entries: table.size,
				fallbacks: fallback.prices.size,
				patterns: fallback.patterns.length,
			},
		};
	} catch {
		return {
			table: new Map(),
			fallback: BUILTIN_FALLBACKS,
			meta: { generatedAt: null, entries: 0, fallbacks: Object.keys(BUILTIN_FALLBACKS.prices).length, patterns: BUILTIN_FALLBACKS.patterns.length },
		};
	}
})();

const livePriceCache = new WeakMap();

/** Read prices and the auto/manual switch from the live profile row. */
function liveMonitorSettings(ctx, cfg) {
	const now = Date.now();
	const cached = livePriceCache.get(ctx);
	if (cached !== undefined && now - cached.at < 1500) return cached.value;
	try {
		const editor = ctx.get("configEditor");
		if (editor !== undefined && typeof editor.configuration === "function") {
			const row = (editor.configuration() ?? []).find((candidate) => {
				const id = candidate?.entry?.options?.id;
				return id === "model-route-monitor" || id === "include:model-route-monitor";
			});
			if (row !== undefined) {
				const merged = { ...objectOf(row.inherited), ...objectOf(row.override), ...objectOf(row.entry?.options?.config) };
				const value = { prices: normalizePrices(merged.prices), autoPrices: merged.autoPrices !== false };
				livePriceCache.set(ctx, { at: now, value });
				return value;
			}
		}
	} catch {
		// fall through to the activation-time config
	}
	const value = { prices: cfg().prices, autoPrices: cfg().autoPrices !== false };
	livePriceCache.set(ctx, { at: now, value });
	return value;
}

/** Drop the short-lived live-settings cache after a successful write. */
function invalidateLivePrices(ctx) {
	livePriceCache.delete(ctx);
}


/** Standalone visual harness for reviewing the real Client component. */
function previewHtml(reqUrl) {
	const url = new URL(reqUrl, "http://localhost");
	const clamp = (value, fallback, min, max) => {
		const number = Number(value);
		return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
	};
	const width = clamp(url.searchParams.get("width"), 400, 280, 1200);
	const height = clamp(url.searchParams.get("height"), 1000, 600, 1800);
	const source = readFileSync(fileURLToPath(new URL("./client.js", import.meta.url)), "utf8")
		.replace(/<\/script/gi, "<\\/script");
	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tier monitor preview</title>
<style>
html,body{margin:0;background:#e9ecf2;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1b1b1c}
body{display:flex;align-items:flex-start;justify-content:flex-start;padding:20px;box-sizing:border-box;min-height:100vh}
#frame{width:${width}px;height:${height}px;display:flex;flex-direction:column;overflow:hidden;background:var(--dsw-alias-bg-base);border-radius:14px;box-shadow:0 10px 40px #00000024}
#root{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
:root{--dsw-alias-bg-base:#f9fafb;--dsw-alias-bg-layer-1:#fff;--dsw-alias-bg-layer-2:#f5f6f7;--dsw-alias-border-l1:#0000000a;--dsw-alias-border-l2:#0000001a;--dsw-alias-border-l3:#0000001f;--dsw-alias-label-primary:#1b1b1c;--dsw-alias-label-secondary:#61666b;--dsw-alias-label-tertiary:#979da6;--dsw-alias-brand-primary:#3b82f6;--dsw-alias-state-success-primary:#22c55e;--dsw-alias-state-warn-primary:#d97706;--dsw-alias-state-error-primary:#dc2626;--dsw-alias-state-idle-primary:#adb2b8}
</style>
</head>
<body>
<div id="frame"><div id="root"></div></div>
<script src="https://unpkg.com/preact@10.25.4/dist/preact.umd.js"></script>
<script src="https://unpkg.com/preact@10.25.4/hooks/dist/hooks.umd.js"></script>
<script src="https://unpkg.com/preact@10.25.4/compat/dist/compat.umd.js"></script>
<script>
window.__ModuleLoader__ = { load(entry) { const module = { exports: {} }; const exports = module.exports; const require = (name) => { if (name === "react") return window.preactCompat; throw new Error("preview require: " + name); }; const result = entry.factory(require); window.__tgmPreview = result; } };
</script>
<script>${source}</script>
<script>
(function(){
 const preview = window.__tgmPreview;
 if (!preview) throw new Error("monitor preview did not load");
 const dict = preview.zh || {};
 const t = (key, vars) => { let text = dict[key] ?? key; for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll("{" + name + "}", String(value)); return text; };
 preact.render(preact.createElement(preview.MonitorBody, { t, form: null }), document.getElementById("root"));
})();
</script>
</body>
</html>`;
}

/** Build one poll response from current records and prices. */
function buildSnapshot({ cfg, store, gateway, range, configFile, settings, decisions = [], pending = null }) {
	const generatedAt = Date.now();
	const facts = gateway.get();
	const effective = effectiveTierPrices(facts.tiers, settings.prices, settings.autoPrices, BUNDLED_PRICES.table, BUNDLED_PRICES.fallback);
	const data = aggregateRecords(store.records(), effective.prices, range, generatedAt);
	const recent = buildRecentRoutes(store.records(), decisions, data.prices, facts.judge, data.since, RECENT_LIMIT);
	const delegations = buildRecentDelegations(decisions, data.since, RECENT_LIMIT);
	return {
		ok: true,
		version: 1,
		generatedAt,
		pending: pending ?? { count: 0, since: 0, ms: 0 },
		range: data.range,
		since: data.since,
		currency: cfg().currency,
		prices: data.prices,
		manualPrices: settings.prices,
		autoPrices: settings.autoPrices,
		priceSources: effective.sources,
		priceCatalog: BUNDLED_PRICES.meta,
		gateway: {
			found: facts.found,
			package: facts.package,
			route: facts.route,
			tiers: publicTiers(facts.tiers),
			judge: facts.judge,
		},
		configFile: configFile ?? null,
		totals: data.totals,
		tiers: data.tiers,
		sessions: data.sessions,
		recent,
		delegations,
		backend: {
			persisted: cfg().persist,
			retainedRecords: store.records().length,
		},
	};
}

/**
 * Observe every model call. Gateway calls are recorded once at the outer
 * layer; nested upstream calls only teach it which tier served the request.
 */
function createObserver({ cfg, gateway, store }) {
	const als = new AsyncLocalStorage();
	// Outer gateway calls that are still streaming. A turn's first record only
	// exists once its outer stream settles, so this is what lets the panel say
	// "a call is in flight" during that gap.
	const active = new Set();
	const finalize = (state) => {
		if (state.recorded) return;
		state.recorded = true;
		active.delete(state);
		const tier = normalizeTier(state.tier) ?? normalizeTier(state.requestedModel);
		const candidate = state.candidate
			?? (tier !== null ? state.facts.tiers[tier] : undefined)
			?? null;
		const usage = state.usage ?? normalizeUsage(null);
		const record = {
			v: 1,
			at: Date.now(),
			sessionId: state.sessionId,
			tier,
			provider: candidate?.provider ?? null,
			model: candidate?.model ?? null,
			requestedModel: state.requestedModel,
			purpose: state.purpose,
			usage,
			ms: Date.now() - state.startedAt,
			finish: state.finish ?? "ok",
		};
		store.add(record);
	};
	async function* iterate(state, next) {
		let iterator;
		try {
			const stream = next();
			iterator = stream?.[Symbol.asyncIterator]?.();
			if (iterator === undefined) throw new Error("llm/stream returned a non-iterable value");
			while (true) {
				const item = await als.run(state, () => iterator.next());
				if (item.done) break;
				const chunk = item.value;
				if (chunk?.type === "usage") state.usage = normalizeUsage(chunk.usage);
				if (chunk?.type === "finish") state.finish = cleanString(chunk.reason?.kind) || "finish";
				yield chunk;
			}
		} catch (error) {
			state.finish = state.finish ?? "error";
			throw error;
		} finally {
			if (iterator?.return !== undefined) {
				try {
					await als.run(state, () => iterator.return());
				} catch {
					// The call already settled; a cleanup failure must not replace it.
				}
			}
			finalize(state);
		}
	}
	const observer = (options, next) => {
		const parent = als.getStore();
		if (parent !== undefined) {
			// Nested call inside a gateway stream: learn the tier, never record
			// it as a second user-visible request. A judge call has no sessionId
			// so it cannot be mistaken for a tier candidate.
			if (options?.provider !== parent.facts.route
				&& (parent.sessionId === null || options?.sessionId === parent.sessionId)) {
				const tier = resolveTier(parent.facts.tierMap, options?.provider, options?.model);
				if (tier !== null) {
					parent.tier = tier;
					parent.candidate = { provider: options.provider, model: options.model };
				}
			}
			return next();
		}
		const facts = gateway.get();
		if (options?.provider !== facts.route) return next();
		const state = {
			startedAt: Date.now(),
			sessionId: cleanString(options?.sessionId) || null,
			requestedModel: cleanString(options?.model) || "auto",
			purpose: cleanString(options?.purpose) || null,
			tier: normalizeTier(options?.model),
			candidate: null,
			usage: null,
			finish: null,
			facts,
			recorded: false,
		};
		active.add(state);
		return iterate(state, next);
	};
	observer.liveCalls = () => {
		let since = 0;
		for (const state of active) since = since === 0 ? state.startedAt : Math.min(since, state.startedAt);
		return { count: active.size, since, ms: since > 0 ? Date.now() - since : 0 };
	};
	return observer;
}

/**
 * Register the collector and its one same-origin snapshot route.
 * @param ctx - Host plugin context.
 * @param config - the plugin's reactive config proxy.
 */
function apply(ctx, config) {
	const cfg = () => readConfig(config);
	const logger = ctx.logger;
	const gateway = createGatewayReader(ctx, cfg, logger);
	const store = createRecordStore(cfg, logger);
	const decisionReader = createDecisionReader(ctx, gateway, logger);
	const observer = createObserver({ cfg, gateway, store });

	ctx.on("llm/stream", observer);
	ctx.on("settings/document-updated", () => {
		gateway.invalidate();
		invalidateLivePrices(ctx);
	});
	ctx.on("loader/volatile-update", () => {
		gateway.invalidate();
		invalidateLivePrices(ctx);
	});
	ctx.on("app-boot/config-reload", () => {
		gateway.invalidate();
		invalidateLivePrices(ctx);
	});

	ctx.inject(["webServer"], (webCtx) => {
		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: SNAPSHOT_PATH,
			handler: async (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				if (String(req.headers["sec-fetch-site"] ?? "") === "cross-site") {
					res.writeHead(403);
					res.end();
					return;
				}
				try {
					const url = new URL(req.url ?? SNAPSHOT_PATH, "http://localhost");
					const range = normalizeRange(url.searchParams.get("range") ?? "all");
					const configFile = profilePatchPath(ctx);
					const decisions = await decisionReader.get();
					respondJson(res, 200, buildSnapshot({
						cfg, store, gateway, range, configFile,
						settings: liveMonitorSettings(ctx, cfg),
						decisions,
						pending: observer.liveCalls(),
					}));
				} catch (error) {
					respondJson(res, 500, {
						ok: false,
						error: String(error?.message ?? error),
					});
				}
			},
		}), "model-route-monitor: snapshot route");

		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: PREVIEW_PATH,
			handler: (req, res) => {
				if (req.method !== "GET") {
					res.writeHead(405, { allow: "GET" });
					res.end();
					return;
				}
				try {
					const html = previewHtml(req.url ?? PREVIEW_PATH);
					res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
					res.end(html);
				} catch (error) {
					res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
					res.end(String(error?.message ?? error));
				}
			},
		}), "model-route-monitor: standalone preview");

		webCtx.effect(() => webCtx.webServer.register({
			kind: "exact",
			path: OPEN_CONFIG_PATH,
			handler: async (req, res) => {
				if (req.method !== "POST") {
					res.writeHead(405, { allow: "POST" });
					res.end();
					return;
				}
				if (String(req.headers["sec-fetch-site"] ?? "") === "cross-site"
					|| !String(req.headers["content-type"] ?? "").includes("application/json")) {
					respondJson(res, 403, { ok: false, error: "same-origin JSON requests only" });
					return;
				}
				try {
					await readJsonBody(req);
				} catch (error) {
					respondJson(res, 400, { ok: false, error: String(error?.message ?? error) });
					return;
				}
				let template = { changed: false };
				try {
					template = await ensurePriceTemplate(ctx);
				} catch (error) {
					template = { changed: false, error: String(error?.message ?? error) };
				}
				const path = profilePatchPath(ctx);
				let opened = false;
				let openError = null;
				if (path === null) {
					openError = "profile patch path unavailable";
				} else {
					try {
						const controller = ctx.get("sessionController");
						if (controller !== undefined && typeof controller.openWorkspacePath === "function"
							&& controller.canOpenWorkspacePath?.() === true) {
							await controller.openWorkspacePath({ path }, new AbortController().signal);
							opened = true;
						} else {
							openError = "native desktop opener unavailable";
						}
					} catch (error) {
						openError = String(error?.message ?? error);
					}
				}
				respondJson(res, 200, {
					ok: true,
					opened,
					path,
					template: template.changed === true,
					templateError: template.error ?? null,
					openError,
				});
			},
		}), "model-route-monitor: open config route");

	});
}

export { Config, apply, readConfig, readTiers, readRecord, buildSnapshot, ensurePriceTemplate, SNAPSHOT_PATH, OPEN_CONFIG_PATH, PREVIEW_PATH };