/**
 * Pure data model for the ModelRoute economy monitor.
 *
 * No Node, React, or Harness imports live here so the pricing and aggregation
 * rules can be tested offline. The Host collector feeds real calls in; the
 * browser only renders the aggregated snapshot.
 */

/** The three tier names the gateway exposes. */
export const TIERS = ["opus", "sonnet", "haiku"];

/** A zero price means "not configured", not "free". */
export const DEFAULT_PRICES = Object.freeze({
	opus: Object.freeze({ input: 0, output: 0, cacheRead: 0 }),
	sonnet: Object.freeze({ input: 0, output: 0, cacheRead: 0 }),
	haiku: Object.freeze({ input: 0, output: 0, cacheRead: 0 }),
});

const TOKEN_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"];

/** A finite, non-negative number, else the fallback. */
function amount(value, fallback = 0) {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) && number >= 0 ? number : fallback;
}

/** Keep only the three configurable prices, each as a non-negative number. */
export function normalizePrices(raw) {
	const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const prices = {};
	for (const tier of TIERS) {
		const value = source[tier] !== null && typeof source[tier] === "object" ? source[tier] : {};
		prices[tier] = {
			input: amount(value.input),
			output: amount(value.output),
			cacheRead: amount(value.cacheRead),
		};
	}
	return prices;
}

/**
 * The next config object when a complete prices template is missing, or
 * `null` when the existing object already has the normalized three-tier block.
 */
export function priceTemplatePatch(raw) {
	const config = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const prices = normalizePrices(config.prices);
	if (JSON.stringify(prices) === JSON.stringify(config.prices)) return null;
	return { ...config, prices };
}

/** Whether any of a tier's three prices has been configured. */
export function hasPrice(price) {
	return Boolean(price && (price.input > 0 || price.output > 0 || price.cacheRead > 0));
}

/** Normalize the token counters a provider reports. */
export function normalizeUsage(raw) {
	const source = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const usage = {};
	for (const field of TOKEN_FIELDS) usage[field] = amount(source[field]);
	const explicitTotal = amount(source.totalTokens, Number.NaN);
	usage.totalTokens = Number.isFinite(explicitTotal) && explicitTotal > 0
		? explicitTotal
		: usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
	return usage;
}

/** Normalize a tier name, or `null` when it is not one of the three. */
export function normalizeTier(value) {
	const tier = typeof value === "string" ? value.trim().toLowerCase() : "";
	return TIERS.includes(tier) ? tier : null;
}

/** The stable lookup key for an upstream route. */
export function routeKey(provider, model) {
	return `${String(provider ?? "").trim()}\u0000${String(model ?? "").trim()}`;
}

/** Standard tiers first, then any custom tier aliases in registration order. */
function orderedTiers(tiers) {
	const names = Object.keys(tiers ?? {});
	return [...TIERS.filter((tier) => names.includes(tier)), ...names.filter((tier) => !TIERS.includes(tier))];
}

/**
 * Map `provider/model` upstream candidates back to tier aliases.
 *
 * Primary candidates are registered before fallbacks and a key used by more
 * than one tier stays ambiguous (resolveTier returns null) rather than being
 * silently attributed to the wrong tier.
 */
export function buildTierMap(tiers) {
	const map = new Map();
	const add = (tier, candidate) => {
		if (!candidate || typeof candidate.provider !== "string" || typeof candidate.model !== "string") return;
		if (candidate.provider === "" || candidate.model === "") return;
		const key = routeKey(candidate.provider, candidate.model);
		const owners = map.get(key) ?? new Set();
		owners.add(tier);
		map.set(key, owners);
	};
	const names = orderedTiers(tiers);
	for (const tier of names) add(tier, tiers?.[tier]);
	for (const tier of names) {
		const fallbacks = Array.isArray(tiers?.[tier]?.fallbacks) ? tiers[tier].fallbacks : [];
		for (const candidate of fallbacks) add(tier, candidate);
	}
	return map;
}

/** Resolve one observed upstream route to its unique tier, if any. */
export function resolveTier(tierMap, provider, model) {
	if (!(tierMap instanceof Map)) return null;
	const owners = tierMap.get(routeKey(provider, model));
	return owners?.size === 1 ? [...owners][0] : null;
}

/**
 * Cost of one call in the configured currency.
 *
 * Cache writes are billed at the ordinary input rate: the request only asks
 * for input/output/cache-read prices, so there is no separate cache-write
 * price to apply.
 *
 * @returns the cost, or `null` when no price for this tier is configured.
 */
export function callCost(usage, price) {
	if (!hasPrice(price)) return null;
	const tokens = normalizeUsage(usage);
	const perMillion = (count, rate) => (count / 1_000_000) * rate;
	return perMillion(tokens.inputTokens, amount(price.input))
		+ perMillion(tokens.outputTokens, amount(price.output))
		+ perMillion(tokens.cacheReadTokens, amount(price.cacheRead))
		+ perMillion(tokens.cacheWriteTokens, amount(price.input));
}

/** One allowed snapshot window. */
export function normalizeRange(value) {
	return ["1h", "1d", "7d", "30d", "all"].includes(value) ? value : "all";
}

/** Millisecond start of one snapshot window. */
export function rangeSince(range, now = Date.now()) {
	switch (normalizeRange(range)) {
		case "1h": return now - 60 * 60 * 1000;
		case "1d": return now - 24 * 60 * 60 * 1000;
		case "7d": return now - 7 * 24 * 60 * 60 * 1000;
		case "30d": return now - 30 * 24 * 60 * 60 * 1000;
		default: return 0;
	}
}

function emptyAggregate() {
	return {
		requests: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		cost: 0,
		opusCost: 0,
		savings: 0,
		pricedRequests: 0,
		opusPricedRequests: 0,
		comparableRequests: 0,
		comparableCost: 0,
		comparableOpusCost: 0,
		lastAt: null,
		models: {},
		_sessions: new Set(),
	};
}

function accumulate(aggregate, usage, actual, baseline, at, tier) {
	aggregate.requests += 1;
	aggregate.inputTokens += usage.inputTokens;
	aggregate.outputTokens += usage.outputTokens;
	aggregate.cacheReadTokens += usage.cacheReadTokens;
	aggregate.cacheWriteTokens += usage.cacheWriteTokens;
	aggregate.reasoningTokens += usage.reasoningTokens;
	aggregate.totalTokens += usage.totalTokens;
	if (actual !== null) {
		aggregate.pricedRequests += 1;
		aggregate.cost += actual;
	}
	if (baseline !== null) {
		aggregate.opusPricedRequests += 1;
		aggregate.opusCost += baseline;
	}
	if (actual !== null && baseline !== null) {
		aggregate.comparableRequests += 1;
		aggregate.comparableCost += actual;
		aggregate.comparableOpusCost += baseline;
		aggregate.savings += baseline - actual;
	}
	if (aggregate.lastAt === null || at > aggregate.lastAt) aggregate.lastAt = at;
	if (tier !== undefined) {
		const byTier = aggregate.tiers ?? (aggregate.tiers = {});
		byTier[tier] = (byTier[tier] ?? 0) + 1;
	}
}

function finishAggregate(aggregate) {
	const sessions = aggregate._sessions?.size ?? 0;
	delete aggregate._sessions;
	aggregate.sessions = sessions;
	aggregate.models = Object.values(aggregate.models ?? {}).sort((left, right) => right.requests - left.requests);
	aggregate.savingsRate = aggregate.comparableOpusCost > 0
		? aggregate.savings / aggregate.comparableOpusCost
		: null;
	aggregate.hasPrices = aggregate.pricedRequests > 0;
	aggregate.hasBaseline = aggregate.opusPricedRequests > 0;
	aggregate.comparable = aggregate.comparableRequests > 0;
	return aggregate;
}

function noteModel(aggregate, record) {
	if (typeof record.model !== "string" || record.model === "") return;
	const provider = typeof record.provider === "string" ? record.provider : "";
	const key = `${provider}\u0000${record.model}`;
	const entry = aggregate.models[key] ?? (aggregate.models[key] = { provider, model: record.model, requests: 0 });
	entry.requests += 1;
}

function emptySession(sessionId) {
	return {
		sessionId,
		requests: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		cost: 0,
		opusCost: 0,
		savings: 0,
		pricedRequests: 0,
		comparableRequests: 0,
		comparableOpusCost: 0,
		lastAt: null,
		tiers: {},
		models: {},
	};
}

/**
 * Aggregate durable call records for one window under the *current* prices.
 *
 * Costs are deliberately not stored on records: changing a unit price must
 * re-price history rather than leave stale arithmetic behind.
 */
export function aggregateRecords(records, rawPrices, range = "all", now = Date.now()) {
	const prices = normalizePrices(rawPrices);
	const window = normalizeRange(range);
	const since = rangeSince(window, now);
	const byTier = new Map(TIERS.map((tier) => [tier, emptyAggregate()]));
	const unknown = emptyAggregate();
	const totals = emptyAggregate();
	const sessions = new Map();

	for (const record of Array.isArray(records) ? records : []) {
		if (!record || !Number.isFinite(record.at) || record.at < since) continue;
		const usage = normalizeUsage(record.usage);
		const tier = normalizeTier(record.tier);
		const aggregate = tier === null ? unknown : byTier.get(tier);
		const price = tier === null ? null : prices[tier];
		const actual = callCost(usage, price);
		const baseline = callCost(usage, prices.opus);
		aggregate._sessions.add(record.sessionId ?? "unknown");
		totals._sessions.add(record.sessionId ?? "unknown");
		accumulate(aggregate, usage, actual, baseline, record.at, tier ?? "unknown");
		accumulate(totals, usage, actual, baseline, record.at);
		noteModel(aggregate, record);
		noteModel(totals, record);

		const sessionId = record.sessionId ?? "unknown";
		const session = sessions.get(sessionId) ?? emptySession(sessionId);
		accumulate(session, usage, actual, baseline, record.at, tier ?? "unknown");
		sessions.set(sessionId, session);
	}

	finishAggregate(totals);
	finishAggregate(unknown);
	const tiers = TIERS.map((tier) => {
		const aggregate = finishAggregate(byTier.get(tier));
		return {
			tier,
			...aggregate,
			share: totals.requests > 0 ? aggregate.requests / totals.requests : 0,
			costShare: totals.cost > 0 ? aggregate.cost / totals.cost : 0,
		};
	});
	if (unknown.requests > 0) {
		tiers.push({
			tier: "unknown",
			...unknown,
			share: totals.requests > 0 ? unknown.requests / totals.requests : 0,
			costShare: totals.cost > 0 ? unknown.cost / totals.cost : 0,
		});
	}

	const sessionRows = [...sessions.values()]
		.map((session) => finishAggregate(session))
		.sort((left, right) => {
			const byCost = (right.cost ?? 0) - (left.cost ?? 0);
			if (byCost !== 0) return byCost;
			const byRequests = right.requests - left.requests;
			if (byRequests !== 0) return byRequests;
			return (right.lastAt ?? 0) - (left.lastAt ?? 0);
		})
		.slice(0, 12);

	return {
		range: window,
		since,
		generatedAt: now,
		prices,
		totals,
		tiers,
		sessions: sessionRows,
	};
}
/* ------------------------------------------------------------------------- *
 * Price-source matching
 *
 * The monitor can resolve a tier's model against the sub2api price catalog
 * (LiteLLM JSON, USD per token) and the hard-coded family fallbacks in
 * `billing_service.go` for models the catalog does not know yet. Both sources
 * are converted to USD per million tokens for the plugin's price config.
 * ------------------------------------------------------------------------- */

/** Built-ins for the current gateway families when the code source is absent. */
export const BUILTIN_FALLBACKS = Object.freeze({
	prices: {
		"glm-5": { input: 1, output: 3.2, cacheRead: 0.2 },
		"glm-5.1": { input: 1.4, output: 4.4, cacheRead: 0.26 },
		"glm-5.2": { input: 1.4, output: 4.4, cacheRead: 0.26 },
		"glm-5-turbo": { input: 1.2, output: 4, cacheRead: 0.24 },
		"deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
		"deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625 },
	},
	patterns: [
		{ contains: ["glm-5.2"], target: "glm-5.2" },
		{ contains: ["glm-5.1"], target: "glm-5.1" },
		{ contains: ["glm-5-turbo", "glm-5turbo"], target: "glm-5-turbo" },
		{ contains: ["glm-5"], target: "glm-5" },
		{ contains: ["deepseek-v4-flash"], target: "deepseek-v4-flash" },
		{ contains: ["deepseek-v4-pro"], target: "deepseek-v4-pro" },
		{ contains: ["deepseek-chat", "deepseek-reasoner"], target: "deepseek-v4-flash" },
	],
});

/** USD per token to USD per million, rounded for config storage. */
function perMillionPrice(value) {
	const number = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(number) || number < 0) return 0;
	return Math.round(number * 1e6 * 1e6) / 1e6;
}

/** A numeric field in a Go composite literal. */
function goPriceField(body, name) {
	const match = body.match(new RegExp(`\\b${name}\\s*:\\s*([0-9.]+(?:[eE][+-]?\\d+)?)`));
	return match === null ? 0 : Number(match[1]);
}

/**
 * Candidate spellings for a tier's upstream model.
 *
 * Upstream aliases often add a major/minor version and a vendor build suffix,
 * while the price catalog/code use the family id (`deepseek-v4.1-flash-1017`
 * → `deepseek-v4-flash`). Candidates are ordered from most to least exact.
 */
export function modelPriceCandidates(model) {
	const raw = String(model ?? "").trim().toLowerCase();
	if (raw === "") return [];
	const segments = raw.split("/").filter((segment) => segment !== "");
	const base = (segments.at(-1) ?? raw).replace(/^models\//, "").trim();
	const values = [raw, base];
	const withoutDate = base.replace(/-\d{3,8}$/, "");
	values.push(withoutDate);
	const dotVersion = withoutDate.replace(/-(\d+)-(\d+)(?=-|$)/g, "-$1.$2");
	values.push(dotVersion);
	const deepseekFamily = withoutDate.replace(/(deepseek-v\d+)\.\d+/g, "$1");
	values.push(deepseekFamily);
	const deepseekDot = dotVersion.replace(/(deepseek-v\d+)\.\d+/g, "$1");
	values.push(deepseekDot);
	const seen = new Set();
	return values.filter((value) => {
		if (value === "" || seen.has(value)) return false;
		seen.add(value);
		return true;
	});
}

/** Parse the LiteLLM-style catalog into USD-per-million entries. */
export function parseModelPriceTable(raw) {
	let data;
	try {
		data = typeof raw === "string" ? JSON.parse(raw) : raw;
	} catch {
		return new Map();
	}
	const entries = new Map();
	if (data === null || typeof data !== "object" || Array.isArray(data)) return entries;
	for (const [key, value] of Object.entries(data)) {
		if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
		const input = perMillionPrice(value.input_cost_per_token);
		const output = perMillionPrice(value.output_cost_per_token);
		const cacheRead = perMillionPrice(value.cache_read_input_token_cost);
		if (input === 0 && output === 0 && cacheRead === 0) continue;
		entries.set(key.trim().toLowerCase(), {
			input,
			output,
			cacheRead,
			matchedKey: key,
		});
	}
	return entries;
}

/**
 * Parse the sub2api hard-coded fallback map and its ordered family rules from
 * `billing_service.go`. This is intentionally a narrow reader: it accepts the
 * straightforward `s.fallbackPrices["id"] = &ModelPricing{...}` literals and
 * the top-level `strings.Contains(modelLower, "...")` rules. Unusual control
 * flow is ignored rather than guessed.
 */
export function parseFallbackPriceSource(source) {
	const text = typeof source === "string" ? source : "";
	const prices = new Map();
	const blocks = text.matchAll(/s\.fallbackPrices\["([^"]+)"\]\s*=\s*&ModelPricing\s*\{([\s\S]*?)\n\s*\}/g);
	for (const match of blocks) {
		const price = {
			input: perMillionPrice(goPriceField(match[2], "InputPricePerToken")),
			output: perMillionPrice(goPriceField(match[2], "OutputPricePerToken")),
			cacheRead: perMillionPrice(goPriceField(match[2], "CacheReadPricePerToken")),
		};
		if (price.input === 0 && price.output === 0 && price.cacheRead === 0) continue;
		prices.set(match[1].trim().toLowerCase(), price);
	}

	// Alias assignments: s.fallbackPrices["alias"] = s.fallbackPrices["target"]
	const aliases = [...text.matchAll(/s\.fallbackPrices\["([^"]+)"\]\s*=\s*s\.fallbackPrices\["([^"]+)"\]/g)]
		.map((match) => [match[1].trim().toLowerCase(), match[2].trim().toLowerCase()]);
	for (let pass = 0; pass < 4; pass += 1) {
		let changed = false;
		for (const [alias, target] of aliases) {
			if (prices.has(alias) || !prices.has(target)) continue;
			prices.set(alias, prices.get(target));
			changed = true;
		}
		if (!changed) break;
	}

	const patterns = [];
	const start = text.indexOf("func (s *BillingService) getFallbackPricing");
	if (start < 0) return { prices, patterns };
	const end = text.indexOf("\n// GetModelPricing", start);
	const body = text.slice(start, end < 0 ? text.length : end);
	const lines = body.split(/\r?\n/);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!/^\tif\s+/.test(line)) continue; // top-level family rules only
		let condition = line;
		let cursor = index;
		while (!condition.includes("{") && cursor + 1 < lines.length) {
			cursor += 1;
			condition += ` ${lines[cursor].trim()}`;
		}
		if (condition.includes("&&") || condition.includes("!") || condition.includes("modelLower ==")) continue;
		const contains = [...condition.matchAll(/strings\.Contains\(modelLower,\s*"([^"]+)"\)/g)]
			.map((match) => match[1].toLowerCase());
		if (contains.length === 0) continue;
		let next = cursor + 1;
		while (next < lines.length && lines[next].trim() === "") next += 1;
		const returned = lines[next]?.match(/return s\.fallbackPrices\["([^"]+)"\]/);
		if (returned === null || returned === undefined) continue;
		const target = returned[1].trim().toLowerCase();
		if (!prices.has(target)) continue;
		patterns.push({ contains, target });
	}
	return { prices, patterns };
}

/** Resolve one upstream model against the catalog, then code fallbacks. */
export function resolveModelPrice(model, table, fallback) {
	const candidates = modelPriceCandidates(model);
	const catalog = table instanceof Map ? table : new Map();
	for (const candidate of candidates) {
		const hit = catalog.get(candidate);
		if (hit !== undefined) return { ...hit, source: "table", candidates };
	}
	const code = fallback !== null && typeof fallback === "object" ? fallback : BUILTIN_FALLBACKS;
	const parsedPrices = code.prices instanceof Map ? code.prices : new Map(Object.entries(code.prices ?? {}));
	const builtinPrices = new Map(Object.entries(BUILTIN_FALLBACKS.prices));
	const priceFor = (key) => parsedPrices.get(key) ?? builtinPrices.get(key);
	for (const candidate of candidates) {
		const hit = priceFor(candidate);
		if (hit !== undefined) return { ...hit, source: parsedPrices.has(candidate) ? "code" : "builtin", matchedKey: candidate, candidates };
	}
	const patterns = Array.isArray(code.patterns) && code.patterns.length > 0 ? code.patterns : BUILTIN_FALLBACKS.patterns;
	for (const pattern of patterns) {
		const matched = pattern.contains.some((needle) => candidates.some((candidate) => candidate.includes(needle)));
		if (!matched) continue;
		const hit = priceFor(pattern.target);
		if (hit !== undefined) {
			return { ...hit, source: parsedPrices.has(pattern.target) ? "code" : "builtin", matchedKey: pattern.target, pattern: pattern.contains, candidates };
		}
	}
	return { input: 0, output: 0, cacheRead: 0, source: "unresolved", matchedKey: null, candidates };
}

/**
 * Effective prices for the three standard tiers.
 *
 * Auto mode resolves the live gateway model against the bundled catalog and
 * code fallbacks; manual mode (or a catalog miss) keeps the configured price.
 * This is recomputed from the current tier mapping on every snapshot, so a
 * gateway model switch needs no profile write.
 */
export function effectiveTierPrices(tiers, manualPrices, autoPrices, table, fallback) {
	const prices = {};
	const sources = {};
	const manual = normalizePrices(manualPrices);
	for (const tier of TIERS) {
		const mapping = tiers?.[tier];
		let price = manual[tier];
		let source = { mode: "manual", model: mapping?.model ?? null };
		if (autoPrices !== false && mapping !== undefined) {
			const resolved = resolveModelPrice(mapping.model, table, fallback);
			if (resolved.source !== "unresolved") {
				price = { input: resolved.input, output: resolved.output, cacheRead: resolved.cacheRead };
				source = {
					mode: "auto",
					source: resolved.source,
					matchedKey: resolved.matchedKey ?? null,
					model: mapping.model,
				};
			} else {
				source = { mode: "manual", reason: "catalog-miss", model: mapping.model };
			}
		}
		prices[tier] = price;
		sources[tier] = source;
	}
	return { prices, sources };
}

//#region per-turn aggregation
/** A trimmed string, or an empty string. Local copy so this module stays standalone. */
function cleanString(value) {
	return typeof value === "string" ? value.trim() : "";
}

/** Pair one completed call with the latest preceding decision in its Session. */
export function matchDecisionForRecord(record, decisions) {
	const suffix = record.sessionId === null || record.sessionId === undefined ? null : record.sessionId.slice(-8);
	let best = null;
	let bestAt = Number.NEGATIVE_INFINITY;
	for (const decision of decisions) {
		if (decision === null || typeof decision !== "object") continue;
		// Delegation judgments describe a subagent route, never a model call.
		if (decision.kind === "delegate") continue;
		if (suffix !== null) {
			if (decision.sessionId === null || decision.sessionId === undefined || decision.sessionId !== suffix) continue;
		} else {
			if (decision.sessionId !== null && decision.sessionId !== undefined) continue;
			if (record.tier !== null && decision.tier !== null && decision.tier !== undefined && decision.tier !== record.tier) continue;
			if (record.model !== null && decision.upstream !== null && decision.upstream !== undefined && decision.upstream.model !== record.model) continue;
		}
		const at = Number(decision.at);
		if (!Number.isFinite(at)) continue;
		const delta = record.at - at;
		if (delta < -5000 || delta > 6 * 60 * 60 * 1000) continue;
		if (at > bestAt) {
			best = decision;
			bestAt = at;
		}
	}
	return best;
}


/** The tooltip fields derived from one decision record. */
export function judgeFromDecision(decision, judge) {
	return {
		reason: decision.reason ?? null,
		source: decision.source ?? null,
		confidence: typeof decision.confidence === "number" ? decision.confidence : null,
		probabilities: decision.probabilities ?? null,
		topAlternative: decision.topAlternative ?? null,
		margin: typeof decision.margin === "number" ? decision.margin : null,
		task: decision.task ?? null,
		judgedTier: decision.judgedTier ?? null,
		heldTo: decision.heldTo ?? null,
		heldBy: decision.heldBy ?? null,
		escalatedFrom: decision.escalatedFrom ?? null,
		escalationReason: decision.escalationReason ?? null,
		turn: decision.turn ?? null,
		judgeMs: decision.judgeMs ?? null,
		decisionAt: decision.at ?? null,
		judgeModel: judge?.model ?? null,
		judgeFamily: judge?.family ?? null,
	};
}


/** Group completed calls by their routing decision; one row per judge/route. */
export function buildRecentRoutes(records, decisions, prices, judgeInfo, since, limit) {
	// Old route records predate `turnKey`; if exactly one newer record exists
	// for the same prompt, that stable key is the right bucket for them too.
	const turnKeyByPreview = new Map();
	for (const decision of decisions) {
		if (!decision?.turnKey || !decision.preview) continue;
		const previewKey = cleanString(decision.preview).replace(/\s+/g, " ").slice(0, 80);
		if (!previewKey) continue;
		const mapKey = `${decision.sessionId ?? ""}|${previewKey}`;
		const keys = turnKeyByPreview.get(mapKey) ?? new Set();
		keys.add(decision.turnKey);
		turnKeyByPreview.set(mapKey, keys);
	}
	const groups = new Map();
	for (const record of records) {
		if (record.at < since) continue;
		const decision = matchDecisionForRecord(record, decisions);
		if (decision === null) continue;
		// One row per logical turn, not per re-judge. A plugin reload, a retry,
		// or a dynamic context refresh can produce several route records for the
		// same user turn (even with a different tier); the panel is a turn view,
		// so they must collapse into one row. `at` and `tier` are deliberately
		// not part of the key.
		// New records carry a stable turnKey. Older records do not, and their
		// turn ids can differ for the same prompt after a reload, so only those
		// fall back to the normalized preview.
		// The preview is only a grouping hint for legacy records. User text can
		// itself quote previous rows, so cap the key and prefer turnKey whenever
		// the record has one.
		const previewKey = cleanString(decision.preview).replace(/\s+/g, " ").slice(0, 80);
		const inherited = !decision.turnKey && previewKey ? turnKeyByPreview.get(`${decision.sessionId ?? ""}|${previewKey}`) : null;
		const inheritedKey = inherited?.size === 1 ? [...inherited][0] : null;
		const routeKey = decision.turnKey
			? `turn:${decision.turnKey}`
			: inheritedKey
				? `turn:${inheritedKey}`
				: previewKey
					? `preview:${previewKey}`
					: `turn:${decision.turn ?? decision.at ?? ""}`;
		const key = `${decision.sessionId ?? ""}|${routeKey}`;
		const group = groups.get(key) ?? {
			decision,
			usage: normalizeUsage(null),
			requests: 0,
			cost: null,
			opusCost: null,
			lastAt: 0,
			judgments: [],
		};
		const usage = normalizeUsage(record.usage);
		group.requests += 1;
		for (const field of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens", "totalTokens"]) {
			group.usage[field] += usage[field];
		}
		// Cost follows the tier that actually served each call, not just the
		// newest decision, so a turn that was re-judged across tiers still adds up.
		const price = prices[record.tier ?? decision.tier] ?? null;
		const actual = callCost(usage, price);
		const baseline = callCost(usage, prices.opus);
		if (actual !== null) group.cost = (group.cost ?? 0) + actual;
		if (baseline !== null) group.opusCost = (group.opusCost ?? 0) + baseline;
		group.lastAt = Math.max(group.lastAt, record.at);
		groups.set(key, group);
	}
	// A call matches only its newest preceding decision; the turn's trail is
	// every decision sharing that turn identity, which is what makes a
	// stage/call-granularity turn show each re-judgment.
	const trailByTurn = new Map();
	for (const decision of decisions) {
		if (decision === null || typeof decision !== "object") continue;
		if (decision.kind === "delegate") continue;
		const previewKey = cleanString(decision.preview).replace(/\s+/g, " ").slice(0, 80);
		const key = decision.turnKey ? `turn:${decision.turnKey}` : null;
		if (key === null) continue;
		const bucket = trailByTurn.get(key) ?? [];
		bucket.push(decision);
		trailByTurn.set(key, bucket);
	}
	return [...groups.values()]
		.map((group) => {
			const decision = group.decision;
			const trailKey = decision.turnKey ? `turn:${decision.turnKey}` : null;
			const trail = (trailKey !== null ? trailByTurn.get(trailKey) : null) ?? [decision];
			group.judgments = trail
				.filter((entry) => entry.sessionId === decision.sessionId)
				.map((entry) => ({
					at: Number(entry.at) || null,
					source: entry.source ?? null,
					tier: entry.tier ?? null,
					judgedTier: entry.judgedTier ?? null,
					heldTo: entry.heldTo ?? null,
					heldBy: entry.heldBy ?? null,
					escalatedFrom: entry.escalatedFrom ?? null,
					boundary: entry.boundary ?? null,
					rejudges: Number.isFinite(Number(entry.rejudges)) ? Number(entry.rejudges) : null,
					perCall: entry.perCall === true,
					confidence: typeof entry.confidence === "number" ? entry.confidence : null,
					judgeMs: Number.isFinite(Number(entry.judgeMs)) ? Number(entry.judgeMs) : null,
					reason: typeof entry.reason === "string" ? entry.reason : null,
				}))
				.sort((left, right) => (left.at ?? 0) - (right.at ?? 0));
			return {
				// The row follows the turn's latest completed call, not the moment
				// it was judged: while a turn is still running, its row keeps
				// advancing (and stays on top) instead of looking frozen.
				at: group.lastAt > 0 ? group.lastAt : (Number(decision.at) || 0),
				decisionAt: Number.isFinite(Number(decision.at)) ? Number(decision.at) : null,
				lastAt: group.lastAt,
				tier: decision.tier ?? null,
				provider: decision.upstream?.provider ?? null,
				model: decision.upstream?.model ?? null,
				source: decision.source ?? null,
				confidence: typeof decision.confidence === "number" ? decision.confidence : null,
				probabilities: decision.probabilities ?? null,
				topAlternative: decision.topAlternative ?? null,
				margin: typeof decision.margin === "number" ? decision.margin : null,
				task: decision.task ?? null,
				judgedTier: decision.judgedTier ?? null,
				heldTo: decision.heldTo ?? null,
				heldBy: decision.heldBy ?? null,
				escalatedFrom: decision.escalatedFrom ?? null,
				escalationReason: decision.escalationReason ?? null,
				turn: decision.turn ?? null,
				judgeMs: decision.judgeMs ?? null,
				boundary: decision.boundary ?? null,
				// "How many re-judgments this turn has spent": the newest decision may be
				// a frozen continuation with no count of its own, so the trail's peak wins.
				rejudges: group.judgments.reduce((max, entry) => (Number.isFinite(entry.rejudges) && entry.rejudges > max ? entry.rejudges : max), 0) || null,
				perCall: decision.perCall === true,
				judgments: group.judgments.sort((left, right) => (left.at ?? 0) - (right.at ?? 0)),
				preview: typeof decision.preview === "string" ? decision.preview : null,
				sessionId: decision.sessionId ?? null,
				requests: group.requests,
				usage: group.usage,
				cost: group.cost,
				opusCost: group.opusCost,
				judge: judgeFromDecision(decision, judgeInfo),
			};
		})
		.sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
		.slice(0, limit);
}

/**
 * Delegation-time judgments (the route_tier tool), newest first. They carry no
 * usage of their own: the child's calls appear as ordinary records once it runs.
 */
export function buildRecentDelegations(decisions, since, limit) {
	return decisions
		.filter((decision) => decision?.kind === "delegate")
		.filter((decision) => !Number.isFinite(Number(decision.at)) || Number(decision.at) >= since)
		.map((decision) => ({
			at: Number(decision.at) || null,
			task: typeof decision.task === "string" ? decision.task : null,
			tier: decision.tier ?? null,
			provider: decision.provider ?? null,
			model: decision.model ?? null,
			source: decision.source ?? null,
			confidence: typeof decision.confidence === "number" ? decision.confidence : null,
			reason: typeof decision.reason === "string" ? decision.reason : null,
			fallback: decision.fallback === true,
			ms: Number.isFinite(Number(decision.ms)) ? Number(decision.ms) : null,
		}))
		.sort((left, right) => (right.at ?? 0) - (left.at ?? 0))
		.slice(0, limit);
}


//#endregion
