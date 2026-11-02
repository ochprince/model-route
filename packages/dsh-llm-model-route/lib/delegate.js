/**
 * Delegation-time routing: the "choose a model for this subagent task" node.
 *
 * HiRoute picks a plan for a delegated Worker when the task is submitted, not
 * per message inside that Worker. This module brings the same idea to the
 * harness: before delegating, the agent asks the gateway which tier the *task*
 * needs, and gets back a concrete `provider` / `model` it can pass to the
 * `subagent` tool (when that tool exposes model selection).
 *
 * The decision reuses the configured judge family and tier criteria, so a
 * delegated task is judged by exactly the same standard as a conversation
 * turn — only the state is smaller (the task brief instead of a transcript).
 *
 * This module is pure; the adapter supplies the judge call and logging.
 */
import { candidatesForTier } from "./plan.js";
import { BoundedMap, stableHash } from "./util.js";

const DELEGATE_DEFAULTS = {
	enabled: true,
	toolName: "route_tier",
	defaultMaxTier: "",
	memo: true,
	cacheTtlMs: 60 * 60 * 1000,
	maxCandidates: 3,
};

/** Resolved delegation options from the live config snapshot. */
export function delegateOptions(cfg) {
	const raw = cfg?.delegate ?? {};
	return {
		enabled: raw.enabled !== false,
		toolName: typeof raw.toolName === "string" && raw.toolName.trim() !== "" ? raw.toolName.trim() : DELEGATE_DEFAULTS.toolName,
		defaultMaxTier: ["haiku", "sonnet", "opus"].includes(raw.defaultMaxTier) ? raw.defaultMaxTier : "",
		memo: raw.memo !== false,
		cacheTtlMs: Number(raw.cacheTtlMs) > 0 ? Number(raw.cacheTtlMs) : DELEGATE_DEFAULTS.cacheTtlMs,
		maxCandidates: Number(raw.maxCandidates) > 0 ? Math.min(5, Number(raw.maxCandidates)) : DELEGATE_DEFAULTS.maxCandidates,
	};
}

/**
 * The single user message the judge reads for one delegated task. Keeping the
 * task in `latest_user` means every judge family — and the chat fallback — sees
 * the delegation through its ordinary state shape.
 */
export function delegateBrief({ task, context = "", preset = "" }) {
	const parts = [`委派子任务：${String(task ?? "").trim()}`];
	if (String(context ?? "").trim() !== "") parts.push(`背景：${String(context).trim()}`);
	if (String(preset ?? "").trim() !== "") parts.push(`子智能体预设：${String(preset).trim()}`);
	parts.push("请判断独立完成这个子任务所需的最低充分档位，不要按当前对话的规模判断。");
	return parts.join("\n");
}

/** Options object handed to the judge for a delegated task. */
export function delegateJudgeOptions({ task, context, preset, route }) {
	return {
		provider: route,
		model: "auto",
		messages: [{ role: "user", content: [{ type: "text", text: delegateBrief({ task, context, preset }) }] }],
		sessionId: null,
	};
}

/** Cache key for one delegation decision (task text + ceiling). */
export function delegateMemoKey({ task, context, preset, maxTier }) {
	return stableHash({
		task: String(task ?? "").replace(/\s+/g, " ").trim(),
		context: String(context ?? "").replace(/\s+/g, " ").trim(),
		preset: String(preset ?? "").trim(),
		maxTier: maxTier ?? "",
	});
}

/**
 * Turn a judged tier into concrete delegation targets. The primary candidate
 * comes first; the rest are the same tier's failover candidates, then — when
 * relaying is enabled — candidates of a higher configured tier, so a thin tier
 * still yields a usable answer.
 */
export function resolveDelegation({ cfg, tier, maxTier = "", maxCandidates = 3 }) {
	const ceiling = maxTier === "haiku" || maxTier === "sonnet" || maxTier === "opus" ? maxTier : "";
	const selfRoute = cfg?.route;
	const usable = (value) => value && value.provider !== selfRoute;
	const order = ["haiku", "sonnet", "opus"];
	const start = order.indexOf(tier);
	const tiersInOrder = start < 0 ? ["sonnet", "opus"] : order.slice(start);
	const picked = [];
	const seen = new Set();
	for (const name of tiersInOrder) {
		if (ceiling && order.indexOf(name) > order.indexOf(ceiling)) break;
		for (const candidate of candidatesForTier(cfg, name)) {
			if (!usable(candidate)) continue;
			const key = `${candidate.provider}/${candidate.model}`;
			if (seen.has(key)) continue;
			seen.add(key);
			picked.push({ tier: name, ...candidate });
			if (picked.length >= maxCandidates) break;
		}
		if (picked.length >= maxCandidates) break;
		// Relaying to a higher tier only when the cheaper tier produced nothing.
		if (picked.length > 0) break;
	}
	return picked;
}

/** Fresh delegation memo for one adapter instance. */
export function createDelegateStore(cfg = {}) {
	const options = delegateOptions(cfg);
	return { decisions: new BoundedMap(256), ttlMs: options.cacheTtlMs };
}

/**
 * Plan one delegation: memo → judge → resolve. Returns a stable answer object
 * the tool renders, including the tier the judge chose and the concrete
 * provider/model pair to delegate with.
 *
 * A judge failure never fails the tool: it falls back to `fallbackTier` inside
 * the ceiling, flagged as `fallback: true`, so delegation still has an answer.
 */
export async function planDelegation({ cfg, store, judge, task, context, preset, maxTier, now = Date.now() }) {
	const options = delegateOptions(cfg);
	const ceiling = maxTier && ["haiku", "sonnet", "opus"].includes(maxTier) ? maxTier : options.defaultMaxTier;
	const key = delegateMemoKey({ task, context, preset, maxTier: ceiling });
	if (options.memo) {
		const hit = store.decisions.get(key);
		if (hit && now - hit.at <= store.ttlMs) {
			return { ...hit.value, source: "memo", cached: true };
		}
	}

	let decision;
	let source = "judge";
	let error = null;
	try {
		decision = await judge({
			options: delegateJudgeOptions({ task, context, preset, route: cfg.route }),
			mode: "delegate",
		});
	} catch (cause) {
		error = String(cause?.message ?? cause);
		decision = {
			tier: cfg?.fallbackTier ?? "sonnet",
			confidence: 0,
			reason: `judge failed: ${error}`,
			fallback: true,
		};
		source = "fallback";
	}

	let tier = ["haiku", "sonnet", "opus"].includes(decision.tier) ? decision.tier : (cfg?.fallbackTier ?? "sonnet");
	if (ceiling) {
		const order = ["haiku", "sonnet", "opus"];
		if (order.indexOf(tier) > order.indexOf(ceiling)) tier = ceiling;
	}
	const candidates = resolveDelegation({ cfg, tier, maxTier: ceiling, maxCandidates: options.maxCandidates });
	const primary = candidates[0] ?? null;
	const value = {
		tier,
		provider: primary?.provider ?? null,
		model: primary?.model ?? null,
		reasoningEffort: primary?.reasoningEffort ?? null,
		alternatives: candidates.slice(1),
		confidence: decision.confidence ?? null,
		reason: decision.reason ?? "",
		fallback: source === "fallback",
		ceiling: ceiling || null,
		source,
		error,
	};
	if (options.memo) store.decisions.set(key, { value, at: now });
	return value;
}
