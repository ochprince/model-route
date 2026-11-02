/**
 * Offline checks for the monitor's pure pricing and aggregation model.
 * Run: node test/monitor.test.mjs
 */
import assert from "node:assert/strict";
import {
	aggregateRecords,
	buildRecentDelegations,
	buildRecentRoutes,
	buildTierMap,
	callCost,
	effectiveTierPrices,
	normalizePrices,
	normalizeRange,
	modelPriceCandidates,
	normalizeTier,
	normalizeUsage,
	parseFallbackPriceSource,
	parseModelPriceTable,
	priceTemplatePatch,
	resolveModelPrice,
	rangeSince,
	resolveTier,
} from "../lib/model.js";

const usage = (input, output, cacheRead, cacheWrite) => ({ input, output, cacheRead, cacheWrite });

let passed = 0;
let failed = 0;
async function check(name, fn) {
	try {
		await fn();
		passed += 1;
	} catch (error) {
		failed += 1;
		process.exitCode = 1;
		console.error(`FAIL ${name}:`, error);
	}
}

const PRICES = {
	opus: { input: 10, output: 20, cacheRead: 1 },
	sonnet: { input: 1, output: 2, cacheRead: 0.1 },
	haiku: { input: 0.5, output: 1, cacheRead: 0.05 },
};

await check("prices normalize, clamp, and keep only the three tiers", () => {
	const prices = normalizePrices({
		opus: { input: -2, output: "75", cacheRead: Number.NaN },
		sonnet: { input: 3 },
		extra: { input: 99 },
	});
	assert.equal(prices.opus.input, 0);
	assert.equal(prices.opus.output, 75);
	assert.equal(prices.opus.cacheRead, 0);
	assert.equal(prices.sonnet.input, 3);
	assert.equal(prices.extra, undefined);
});

await check("price template adds a complete zero block without losing other config", () => {
	const patch = priceTemplatePatch({ route: "model-route", prices: { opus: { input: 10 } } });
	assert.equal(patch.route, "model-route");
	assert.deepEqual(patch.prices.opus, { input: 10, output: 0, cacheRead: 0 });
	assert.deepEqual(patch.prices.sonnet, { input: 0, output: 0, cacheRead: 0 });
	assert.deepEqual(patch.prices.haiku, { input: 0, output: 0, cacheRead: 0 });
	assert.equal(priceTemplatePatch(patch), null);
});

await check("usage normalizes counters and fills a total", () => {
	const usage = normalizeUsage({ inputTokens: "12", outputTokens: 8, cacheReadTokens: 5 });
	assert.equal(usage.inputTokens, 12);
	assert.equal(usage.outputTokens, 8);
	assert.equal(usage.cacheReadTokens, 5);
	assert.equal(usage.totalTokens, 25);
	assert.equal(normalizeUsage(null).totalTokens, 0);
});

await check("cost uses input, output, cache-read, and input-priced cache writes", () => {
	const usage = {
		inputTokens: 1_000_000,
		outputTokens: 500_000,
		cacheReadTokens: 2_000_000,
		cacheWriteTokens: 100_000,
	};
	const cost = callCost(usage, { input: 15, output: 75, cacheRead: 1.5 });
	assert.equal(cost, 15 + 37.5 + 3 + 1.5);
	assert.equal(callCost(usage, { input: 0, output: 0, cacheRead: 0 }), null);
	assert.equal(callCost(usage, null), null);
});

await check("tier aliases are normalized strictly", () => {
	assert.equal(normalizeTier("OPUS"), "opus");
	assert.equal(normalizeTier("haiku "), "haiku");
	assert.equal(normalizeTier("auto"), null);
	assert.equal(normalizeTier(undefined), null);
});

await check("tier map resolves primaries and fallbacks, and keeps ambiguity visible", () => {
	const map = buildTierMap({
		opus: { provider: "a", model: "big", fallbacks: [{ provider: "a", model: "fallback" }] },
		sonnet: { provider: "a", model: "mid" },
		haiku: { provider: "a", model: "small" },
	});
	assert.equal(resolveTier(map, "a", "big"), "opus");
	assert.equal(resolveTier(map, "a", "fallback"), "opus");
	assert.equal(resolveTier(map, "a", "mid"), "sonnet");
	assert.equal(resolveTier(map, "a", "missing"), null);

	const ambiguous = buildTierMap({
		opus: { provider: "a", model: "shared" },
		sonnet: { provider: "a", model: "shared" },
	});
	assert.equal(resolveTier(ambiguous, "a", "shared"), null);
});

await check("aggregation filters by window and re-prices current history", () => {
	const now = Date.UTC(2026, 9, 21, 12, 0, 0);
	const records = [
		{
			at: now - 1_000,
			sessionId: "s1",
			tier: "sonnet",
			provider: "a",
			model: "mid",
			usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
		},
		{
			at: now - 2 * 24 * 60 * 60 * 1000,
			sessionId: "s2",
			tier: "haiku",
			provider: "a",
			model: "small",
			usage: { inputTokens: 1_000_000 },
		},
		{
			at: now - 8 * 24 * 60 * 60 * 1000,
			sessionId: "s3",
			tier: "opus",
			usage: { inputTokens: 1_000_000 },
		},
	];
	const data = aggregateRecords(records, PRICES, "7d", now);
	assert.equal(data.range, "7d");
	assert.equal(data.totals.requests, 2);
	assert.equal(data.totals.sessions, 2);
	assert.equal(data.totals.inputTokens, 2_000_000);
	assert.equal(data.totals.outputTokens, 1_000_000);
	assert.equal(data.totals.comparableRequests, 2);
	assert.equal(data.totals.comparableCost, 3.5);
	assert.equal(data.totals.comparableOpusCost, 40);
	assert.equal(data.totals.savings, 36.5);
	assert.equal(data.totals.savingsRate, 36.5 / 40);
	assert.equal(data.tiers.find((row) => row.tier === "sonnet").share, 0.5);
	assert.equal(data.sessions[0].sessionId, "s1");
	assert.equal(data.tiers.find((row) => row.tier === "sonnet").models[0].requests, 1);
});

await check("unpriced tiers never fabricate a cost or savings", () => {
	const now = Date.now();
	const records = [{
		at: now - 1000,
		sessionId: "s1",
		tier: "sonnet",
		usage: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
	}];
	const data = aggregateRecords(records, {
		opus: { input: 10, output: 10, cacheRead: 1 },
		sonnet: { input: 0, output: 0, cacheRead: 0 },
		haiku: { input: 0, output: 0, cacheRead: 0 },
	}, "all", now);
	assert.equal(data.totals.requests, 1);
	assert.equal(data.totals.pricedRequests, 0);
	assert.equal(data.totals.comparableRequests, 0);
	assert.equal(data.totals.savings, 0);
	assert.equal(data.totals.hasPrices, false);
	assert.equal(data.tiers.find((row) => row.tier === "sonnet").cost, 0);
});

await check("unknown tiers are counted, but stay out of the three tier rows", () => {
	const now = Date.now();
	const records = [{
		at: now - 1000,
		sessionId: "s1",
		tier: null,
		usage: { inputTokens: 1_000_000 },
	}];
	const data = aggregateRecords(records, PRICES, "all", now);
	assert.equal(data.totals.requests, 1);
	assert.equal(data.tiers.length, 4);
	assert.equal(data.tiers.at(-1).tier, "unknown");
	assert.equal(data.tiers.at(-1).requests, 1);
	assert.equal(data.totals.pricedRequests, 0);
});

await check("range boundaries and fallbacks are stable", () => {
	const now = Date.UTC(2026, 9, 21, 12, 0, 0);
	assert.equal(rangeSince("1h", now), now - 60 * 60 * 1000);
	assert.equal(rangeSince("30d", now), now - 30 * 24 * 60 * 60 * 1000);
	assert.equal(rangeSince("bogus", now), 0);
	assert.equal(normalizeRange("7d"), "7d");
	assert.equal(normalizeRange("bogus"), "all");
});

await check("price candidates normalize vendor prefixes and DeepSeek version suffixes", () => {
	assert.deepEqual(modelPriceCandidates("aiapi/deepseek-v4.1-flash-1017"), [
		"aiapi/deepseek-v4.1-flash-1017",
		"deepseek-v4.1-flash-1017",
		"deepseek-v4.1-flash",
		"deepseek-v4-flash",
	]);
	assert.ok(modelPriceCandidates("models/glm-5.3").includes("glm-5.3"));
});

await check("LiteLLM table prices convert from per-token to per-million", () => {
	const table = parseModelPriceTable({
		"deepseek-chat": { input_cost_per_token: 2.8e-7, output_cost_per_token: 4.2e-7, cache_read_input_token_cost: 2.8e-8 },
		"free": { input_cost_per_token: 0, output_cost_per_token: 0 },
	});
	assert.equal(table.get("deepseek-chat").input, 0.28);
	assert.equal(table.get("deepseek-chat").output, 0.42);
	assert.equal(table.get("deepseek-chat").cacheRead, 0.028);
	assert.equal(table.has("free"), false);
});

const GO_FIXTURE = `
func (s *BillingService) initFallbackPricing() {
\ts.fallbackPrices["glm-5"] = &ModelPricing{
\t\tInputPricePerToken:     1e-6,
\t\tOutputPricePerToken:    3.2e-6,
\t\tCacheReadPricePerToken: 0.2e-6,
\t}
\ts.fallbackPrices["glm-5.2"] = &ModelPricing{
\t\tInputPricePerToken:     1.4e-6,
\t\tOutputPricePerToken:    4.4e-6,
\t\tCacheReadPricePerToken: 0.26e-6,
\t}
\ts.fallbackPrices["deepseek-v4-flash"] = &ModelPricing{
\t\tInputPricePerToken:     1.4e-7,
\t\tOutputPricePerToken:    2.8e-7,
\t\tCacheReadPricePerToken: 2.8e-9,
\t}
}

func (s *BillingService) getFallbackPricing(model string) *ModelPricing {
\tmodelLower := strings.ToLower(model)
\tif strings.Contains(modelLower, "deepseek-v4-flash") {
\t\treturn s.fallbackPrices["deepseek-v4-flash"]
\t}
\tif strings.Contains(modelLower, "glm-5.2") {
\t\treturn s.fallbackPrices["glm-5.2"]
\t}
\tif strings.Contains(modelLower, "glm-5") {
\t\treturn s.fallbackPrices["glm-5"]
\t}
\tif strings.Contains(modelLower, "opus") {
\t\tif strings.Contains(modelLower, "4.8") {
\t\t\treturn s.fallbackPrices["glm-5"]
\t\t}
\t}
\treturn nil
}

// GetModelPricing
`;

await check("auto prices follow a tier model switch without touching manual config", () => {
	const fallback = parseFallbackPriceSource(GO_FIXTURE);
	const zeros = { opus: { input: 0, output: 0, cacheRead: 0 }, sonnet: { input: 0, output: 0, cacheRead: 0 }, haiku: { input: 0, output: 0, cacheRead: 0 } };
	const tiers = {
		opus: { provider: "aiapi", model: "glm-5.3" },
		sonnet: { provider: "aiapi", model: "deepseek-v4.1-flash-1017" },
		haiku: { provider: "aiapi", model: "glm-5.3-flash" },
	};
	const first = effectiveTierPrices(tiers, zeros, true, new Map(), fallback);
	assert.equal(first.sources.opus.mode, "auto");
	assert.equal(first.sources.sonnet.matchedKey, "deepseek-v4-flash");
	assert.equal(first.prices.sonnet.input, 0.14);
	const switched = effectiveTierPrices({ ...tiers, sonnet: { provider: "aiapi", model: "glm-5.2" } }, zeros, true, new Map(), fallback);
	assert.equal(switched.sources.sonnet.matchedKey, "glm-5.2");
	assert.equal(switched.prices.sonnet.input, 1.4);
	const manual = effectiveTierPrices(tiers, { ...zeros, opus: { input: 9, output: 9, cacheRead: 9 } }, false, new Map(), fallback);
	assert.equal(manual.sources.opus.mode, "manual");
	assert.equal(manual.prices.opus.input, 9);
});

await check("fallback source parser extracts ordered top-level family rules", () => {
	const fallback = parseFallbackPriceSource(GO_FIXTURE);
	assert.equal(fallback.prices.get("glm-5").input, 1);
	assert.equal(fallback.prices.get("deepseek-v4-flash").cacheRead, 0.0028);
	assert.deepEqual(fallback.patterns.map((rule) => rule.target), ["deepseek-v4-flash", "glm-5.2", "glm-5"]);
	assert.equal(fallback.patterns.some((rule) => rule.target === "glm-5" && rule.contains.includes("4.8")), false);
});

await check("resolver uses table first, then code fallbacks and family normalization", () => {
	const table = parseModelPriceTable({
		"glm-5.2": { input_cost_per_token: 9e-6, output_cost_per_token: 9e-6, cache_read_input_token_cost: 9e-7 },
	});
	const fallback = parseFallbackPriceSource(GO_FIXTURE);
	const tableHit = resolveModelPrice("glm-5.2", table, fallback);
	assert.equal(tableHit.source, "table");
	assert.equal(tableHit.input, 9);
	const glm = resolveModelPrice("glm-5.3", table, fallback);
	assert.equal(glm.source, "code");
	assert.equal(glm.matchedKey, "glm-5");
	const deepseek = resolveModelPrice("deepseek-v4.1-flash-1017", table, fallback);
	assert.equal(deepseek.matchedKey, "deepseek-v4-flash");
	assert.equal(deepseek.input, 0.14);
});

await check("resolver falls back to builtins when the code source is missing", () => {
	const hit = resolveModelPrice("deepseek-v4.1-flash-1017", new Map(), { prices: new Map(), patterns: [] });
	assert.equal(hit.source, "builtin");
	assert.equal(hit.input, 0.14);
	assert.equal(hit.cacheRead, 0.0028);
});


// ---- decision granularity: per-turn trail + delegation judgments

const TURN_PRICES = {
	opus: { input: 1, output: 2, cacheRead: 0.1 },
	sonnet: { input: 1, output: 2, cacheRead: 0.1 },
	haiku: { input: 1, output: 2, cacheRead: 0.1 },
};

await check("the monitor keeps every judgment of one turn", () => {
	const decisions = [
		{ kind: "route", at: 1000, sessionId: "abc12345", turnKey: "t1", source: "judge", tier: "sonnet", preview: "refactor", confidence: 0.8, judgeMs: 40 },
		{ kind: "route", at: 2000, sessionId: "abc12345", turnKey: "t1", source: "stage", tier: "opus", boundary: "tool-error", rejudges: 1, confidence: 0.9, judgeMs: 30 },
		{ kind: "route", at: 3000, sessionId: "abc12345", turnKey: "t1", source: "frozen", tier: "opus", judgeMs: null },
	];
	const records = [
		{ at: 3100, sessionId: "s-abc12345", tier: "opus", model: "glm-5.3", usage: usage(100, 50, 0, 0), ms: 900, finish: "ok" },
	];
	const recent = buildRecentRoutes(records, decisions, TURN_PRICES, { model: "jev-latest", family: "jev" }, 0, 24);
	assert.equal(recent.length, 1, "one row per turn");
	const row = recent[0];
	assert.equal(row.judgments.length, 3, "all three judgments of the turn are kept");
	assert.deepEqual(row.judgments.map((entry) => entry.source), ["judge", "stage", "frozen"]);
	assert.equal(row.judgments[1].boundary, "tool-error");
	assert.equal(row.rejudges, 1, "the trail's peak re-judgment count is exposed");
	assert.equal(row.boundary, null, "the newest decision carries no boundary of its own");
});

await check("a running turn keeps advancing and stays on top", () => {
	const decisions = [
		{ kind: "route", at: 1000, sessionId: "abc12345", turnKey: "old", source: "judge", tier: "haiku", preview: "finished turn", confidence: 0.9 },
		{ kind: "route", at: 20000, sessionId: "abc12345", turnKey: "live", source: "judge", tier: "sonnet", preview: "running turn", confidence: 0.8 },
	];
	const records = [
		{ at: 2000, sessionId: "s-abc12345", tier: "haiku", model: "glm-5.3-flash", usage: usage(10, 10, 0, 0), ms: 100, finish: "ok" },
		{ at: 21000, sessionId: "s-abc12345", tier: "sonnet", model: "glm-5.3", usage: usage(10, 10, 0, 0), ms: 100, finish: "ok" },
		// The turn is still running: a later call of the same turn arrives now.
		{ at: 90000, sessionId: "s-abc12345", tier: "sonnet", model: "glm-5.3", usage: usage(10, 10, 0, 0), ms: 100, finish: "ok" },
	];
	const recent = buildRecentRoutes(records, decisions, TURN_PRICES, {}, 0, 24);
	assert.equal(recent.length, 2);
	assert.equal(recent[0].preview, "running turn", "latest activity sorts first");
	assert.equal(recent[0].at, 90000, "row time follows the newest completed call");
	assert.equal(recent[0].decisionAt, 20000, "the judgment time stays available");
	assert.equal(recent[0].requests, 2, "both calls of the running turn are counted");
	assert.equal(recent[1].preview, "finished turn");
	assert.equal(recent[1].at, 2000);
});

await check("delegation judgments are listed separately with their task", () => {
	const decisions = [
		{ kind: "delegate", at: 2500, task: "写一个脚本", tier: "haiku", provider: "aiapi", model: "glm-5.3-flash", source: "judge", confidence: 0.7, ms: 55 },
		{ kind: "delegate", at: 2600, task: "重构调度层", tier: "opus", provider: "aiapi", model: "glm-5.3", source: "fallback", fallback: true, ms: 12 },
	];
	const rows = buildRecentDelegations(decisions, 0, 24);
	assert.equal(rows.length, 2);
	assert.equal(rows[0].tier, "opus", "newest first");
	assert.equal(rows[0].fallback, true);
	assert.equal(rows[1].task, "写一个脚本");
	assert.equal(rows[1].fallback, false);
});

await check("delegation judgments never explain an ordinary model call", () => {
	const decisions = [
		{ kind: "delegate", at: 500, task: "x", tier: "haiku", provider: "aiapi", model: "glm-5.3-flash" },
	];
	const records = [{ at: 900, sessionId: null, tier: "haiku", model: "glm-5.3-flash", usage: usage(10, 10, 0, 0), ms: 10, finish: "ok" }];
	assert.equal(buildRecentRoutes(records, decisions, {}, {}, 0, 24).length, 0);
});

console.log(`monitor model: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;