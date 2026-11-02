/**
 * HiRoute-style decision planning for the model-route gateway.
 *
 * One rule decides everything:
 *
 * - `auto` asks the judge model which tier the turn needs.
 * - An explicit tier (`opus` / `sonnet` / `haiku`) maps straight to that tier's
 *   configured model — no judge call, fully deterministic.
 *
 * The mechanism mirrors HiRoute's decision semantics (higress-group/HiRoute):
 *
 * - Each NEW user turn is judged again; tool continuations and same-turn
 *   replay REUSE the frozen decision while the same turn is recognizable.
 *   Keeping the same model for the whole turn lets the provider reuse its
 *   growing context-prefix KV cache.
 * - A memo keyed by the exact request prefix lets retries, context rebuilds,
 *   and identical follow-ups reuse the previous decision without another
 *   judge call. Unrecognizable (reconstructed/compacted) history simply
 *   misses and re-judges — never silently inherits a stale choice.
 *
 * This module is pure: it receives a `judge` function and returns plans; the
 * adapter supplies judge I/O and logging.
 */
import { BoundedMap, TIERS, cheaperTier, contentText, isTier, isTurnStartUser, lastTurnUserIndex, stableHash, tierRank } from "./util.js";

/**
 * Judgment nodes.
 *
 * A decision is made at exactly three points, and nowhere else:
 *
 * 1. a new user turn (the base decision);
 * 2. a rebuilt history — compaction replaced the context the frozen decision
 *    was made on, so that decision cannot be inherited;
 * 3. delegation, through the separate `route_tier` tool, which judges a
 *    subagent task rather than the conversation.
 *
 * Tool continuations inside a turn reuse the frozen decision: one model for the
 * whole turn keeps the provider's prefix KV cache hitting. In-turn proxies for
 * "the task may have changed" (tool-result counts, context growth) were removed
 * after measurement showed they re-judged without changing the tier.
 */

const DEFAULTS = {
	turnFreeze: true,
	memoTtlMs: 6 * 60 * 60 * 1000,
	memoMaxEntries: 512,
	sessionMaxEntries: 256,
};

/** Normalize an incoming model id into a gateway alias. */
export function normalizeAlias(model) {
	const value = String(model ?? "").toLowerCase();
	if (value === "auto" || value === "default" || value === "") return "auto";
	if (isTier(value)) return value;
	// Claude-Code-style suffixed aliases (e.g. "opusplan") degrade to "auto".
	return "auto";
}

/** Ordered upstream candidates for one tier from the resolved config. */
export function candidatesForTier(cfg, tier) {
	const tierCfg = cfg?.tiers?.[tier];
	if (!tierCfg) return [];
	const candidates = [];
	if (tierCfg.provider && tierCfg.model) {
		candidates.push({
			provider: String(tierCfg.provider),
			model: String(tierCfg.model),
			reasoningEffort: tierCfg.reasoningEffort || undefined,
		});
	}
	for (const fallback of Array.isArray(tierCfg.fallbacks) ? tierCfg.fallbacks : []) {
		if (fallback?.provider && fallback?.model) {
			candidates.push({
				provider: String(fallback.provider),
				model: String(fallback.model),
				reasoningEffort: fallback.reasoningEffort || undefined,
			});
		}
	}
	return candidates;
}

export function routerUsable(cfg) {
	const router = cfg?.router;
	if (!router || !router.model) return false;
	return Boolean(router.baseURL || router.provider);
}

/**
 * One request's routing plan.
 * @returns {{tier: string, source: 'auxiliary'|'fixed'|'frozen'|'memo'|'judge'|'fallback', decision: object|null, ceiling: string}}
 */
export async function planRequest({ options, cfg, store, judge, now = Date.now() }) {
	const alias = normalizeAlias(options.model);
	const ceiling = alias === "auto" ? "opus" : alias;
	const fingerprint = turnFingerprint(options, alias);
	const turnKey = turnScope(options, alias);
	const turn = turnKey.slice(0, 8);

	const purpose = options.purpose;
	const aux = cfg?.auxiliary ?? {};
	if (purpose && aux[purpose]) {
		return { tier: aux[purpose], source: "auxiliary", decision: null, ceiling: aux[purpose], turn };
	}

	// An explicit tier is an exact pick; `auto` is the only alias that judges.
	if (alias !== "auto") {
		return { tier: alias, source: "fixed", decision: null, ceiling, turn };
	}

	// No usable judge endpoint: deterministic fallback tier.
	if (!routerUsable(cfg)) {
		return { tier: cfg?.fallbackTier ?? "sonnet", source: "fixed", decision: null, ceiling, turn };
	}

	const cache = { ...DEFAULTS, ...(cfg?.cache ?? {}) };
	const cacheOn = cache.enabled !== false;
	const sessionId = options.sessionId ? String(options.sessionId) : null;
	const previous = sessionId ? store.sessions.get(sessionId) : undefined;
	const previousTier = previous?.decision?.tier;
	const runJudge = () => judge({ alias, ceiling, options, previousTier });

	/** One judge call; a failure degrades to the fallback tier inside the ceiling. */
	const judgeOnce = async () => {
		let decision;
		let source = "judge";
		try {
			decision = await runJudge();
		} catch (error) {
			decision = {
				tier: cheaperTier(cfg?.fallbackTier ?? "sonnet", ceiling),
				confidence: 0,
				reason: `judge failed: ${error?.message ?? String(error)}`,
				fallback: true,
			};
			source = "fallback";
		}
		return { decision, source };
	};

	const sameTurn = Boolean(previous && previous.turnKey === turnKey);
	// The only in-turn judgment node: a rebuilt history. Compaction replaced the
	// context the frozen decision was made on, so it cannot be inherited; the
	// prefix cache is gone anyway, so the new decision stands as judged.
	const rebuilt = sameTurn && !isContinuous(options.messages, previous);

	// 1. Same-turn freeze: a tool continuation reuses this turn's decision.
	if (cacheOn && cache.turnFreeze !== false && sessionId && sameTurn && !rebuilt) {
		return {
			tier: previous.decision.tier,
			source: "frozen",
			decision: { ...previous.decision, reusedAt: now },
			ceiling,
			turn,
			boundary: null,
		};
	}

	// 2. Prefix memo: retries, rebuilt contexts, and identical follow-ups reuse
	// a previous decision instead of asking the judge the same question again.
	const memoKey = prefixMemoKey(options, alias);
	if (cacheOn) {
		const memoHit = store.memo.get(memoKey);
		if (memoHit && now - memoHit.at <= cache.memoTtlMs) {
			const decision = { ...memoHit.decision, reusedAt: now };
			recordSession(store, sessionId, fingerprint, turnKey, decision, cache, timingOf(options));
			return { tier: decision.tier, source: "memo", decision, ceiling, turn, boundary: rebuilt ? "rebuild" : null };
		}
		if (memoHit) store.memo.delete(memoKey);
	}

	// 3. Judge a fresh decision.
	const judged = await judgeOnce();
	let decision = judged.decision;
	let source = judged.source;

	// The judge's verdict is final. Nothing overrides it: a wrong but cheaper
	// choice costs one retry, while a cheap model re-reading the whole context
	// still costs less than a strong model reading its cache. Continuity,
	// confidence and cache economics are not reasons to overrule the decision.
	const tier = validTier(decision.tier, cfg);
	decision = { ...decision, tier };
	if (cacheOn) recordMemo(store, memoKey, decision, cache, now);
	recordSession(store, sessionId, fingerprint, turnKey, decision, cache, timingOf(options));
	return { tier, source, decision, ceiling, turn, boundary: rebuilt ? "rebuild" : null };
}

/** Keep a judged tier inside the aliases this gateway serves. */
function validTier(tier, cfg) {
	if (isTier(tier)) return tier;
	const fallback = cfg?.fallbackTier;
	return isTier(fallback) ? fallback : "sonnet";
}

/**
 * Fingerprint of the current user turn: system prompt plus every message up
 * to and including the last user message. Identical while tools stream in.
 */
function turnFingerprint(options, alias) {
	const messages = Array.isArray(options.messages) ? options.messages : [];
	const cut = lastTurnUserIndex(messages);
	const turn = cut < 0 ? messages : messages.slice(0, cut + 1);
	return stableHash({
		// Do NOT include system content: the runtime refreshes ambient context
		// (clock, attachment notices) on every step, both as `options.system`
		// and sometimes as a message. Hashing it would make every continuation
		// look like a new turn. A new user turn still changes the prefix.
		turn: turn.filter((message) => message?.role !== "system"),
		alias,
		purpose: options.purpose ?? null,
	});
}

/**
 * The narrow, stable identity of one user turn. Unlike `turnFingerprint` it
 * deliberately ignores system/context messages, message count, and earlier
 * message metadata: it only hashes the newest real user prompt. Ambient
 * injections can add messages mid-turn without changing the prompt, while a
 * genuinely new user prompt changes the text.
 */
function turnScope(options, alias) {
	const messages = Array.isArray(options.messages) ? options.messages : [];
	let latest = null;
	for (const message of messages) {
		if (!isTurnStartUser(message)) continue;
		latest = message;
	}
	return stableHash({
		// The prompt text is the only part that stays byte-identical across
		// projections: message ids and message counts both change when ambient
		// context is appended. A repeated prompt therefore reuses the frozen
		// decision, which is also what the prefix memo would do.
		latest: latest ? contentText(latest.content).replace(/\s+/g, " ").trim() : "",
		alias,
		purpose: options.purpose ?? null,
	});
}

/** Memo key over the full request shape (history included). */
function prefixMemoKey(options, alias) {
	return stableHash({
		system: options.system ?? null,
		messages: Array.isArray(options.messages) ? options.messages : [],
		tools: Array.isArray(options.tools) ? options.tools.length : 0,
		alias,
		purpose: options.purpose ?? null,
	});
}

/**
 * Top-two probability gap for the judge's choice. Prefer the explicit margin;
 * fall back to deriving it from the full tier distribution.
 */
function decisionMargin(decision) {
	const explicit = Number(decision?.margin);
	if (Number.isFinite(explicit)) return Math.round(Math.max(0, explicit) * 1e6) / 1e6;
	const probabilities = decision?.probabilities;
	if (!probabilities || typeof probabilities !== "object") return 0;
	const chosen = Number(probabilities[decision?.tier]);
	const shares = Object.values(probabilities).map(Number).filter(Number.isFinite).sort((left, right) => right - left);
	if (shares.length < 2 || !Number.isFinite(chosen)) return 0;
	// A non-leading choice is not decisive, regardless of how wide the top-two
	// gap happens to be.
	if (Math.abs(chosen - shares[0]) > 1e-9) return 0;
	return Math.round(Math.max(0, chosen - shares[1]) * 1e6) / 1e6;
}

/**
 * Cheap continuity witness over the CONVERSATION messages only.
 *
 * System messages are ambient context the runtime refreshes on every step
 * (clock, attachment notices, tool guidance), so including them would make an
 * ordinary continuation look like a rebuilt history. The witness therefore
 * records the last few non-system messages plus how many there were, and a
 * check compares the same non-system positions.
 */
function conversationMessages(messages) {
	return (Array.isArray(messages) ? messages : []).filter((message) => message?.role !== "system");
}

function witnessOf(messages) {
	const conversation = conversationMessages(messages);
	const tail = conversation.slice(-3).map((message) => ({
		role: String(message?.role ?? ""),
		text: contentText(message?.content).slice(0, 400),
		toolCallId: message?.toolCallId ?? null,
	}));
	return { tail, count: conversation.length };
}

/**
 * Whether the current request continues the recorded one. True when the stored
 * witness still sits at the same position in the conversation; false when the
 * history was rebuilt (compaction, summarization, projection change), which is
 * the signal that a frozen decision cannot be inherited.
 */
export function isContinuous(messages, previous) {
	const witness = previous?.witness;
	if (!witness || !Number.isInteger(witness.count) || witness.count === 0) return true;
	const conversation = conversationMessages(messages);
	if (conversation.length < witness.count) return false;
	return stableHash(witnessOf(conversation.slice(0, witness.count)).tail) === stableHash(witness.tail);
}

function recordSession(store, sessionId, fingerprint, turnKey, decision, cache, timing) {
	if (!sessionId || cache.turnFreeze === false) return;
	const messages = timing?.messages ?? [];
	store.sessions.set(sessionId, {
		fingerprint,
		turnKey,
		decision,
		at: Date.now(),
		messageCount: timing?.messageCount ?? 0,
		chars: timing?.chars ?? 0,
		witness: messages.length > 0 ? witnessOf(messages) : undefined,
	});
}

function recordMemo(store, memoKey, decision, cache, now) {
	store.memo.set(memoKey, { decision, at: now });
}

/** Fresh stores for one adapter instance. */
export function createStore(cfg = {}) {
	return {
		sessions: new BoundedMap(cfg.sessionMaxEntries ?? DEFAULTS.sessionMaxEntries),
		memo: new BoundedMap(cfg.memoMaxEntries ?? DEFAULTS.memoMaxEntries),
	};
}

/** Bounded, redacted decision log record for observability. */
export function decisionRecord({ at, options, plan, candidate, judgeMs, error }) {
	const sessionId = options.sessionId ? String(options.sessionId) : null;
	return {
		at: at ?? Date.now(),
		sessionId: sessionId ? sessionId.slice(-8) : null,
		alias: normalizeAlias(options.model),
		purpose: options.purpose ?? null,
		tier: plan.tier,
		source: plan.source,
		turn: plan.turn ?? null,
		// Absent on older records; new records carry it so the monitor can tell
		// repeated prompts apart without falling back to preview matching.
		turnKey: plan.turn ?? null,
		// The node that produced this decision: null for an ordinary turn
		// decision, "rebuild" when a rebuilt history forced a re-judgment.
		boundary: plan.boundary ?? null,
		ceiling: plan.ceiling ?? null,
		upstream: candidate ? { provider: candidate.provider, model: candidate.model } : null,
		confidence: plan.decision?.confidence ?? null,
		probabilities: plan.decision?.probabilities ?? null,
		topAlternative: plan.decision?.topAlternative ?? null,
		margin: plan.decision?.margin ?? null,
		task: plan.decision?.task ?? null,
		// Historical fields, kept so older log lines remain readable in the
		// monitor. New decisions leave them unset: nothing overrides the judge.
		judgedTier: plan.decision?.judgedTier ?? null,
		heldTo: plan.decision?.heldTo ?? null,
		heldBy: plan.decision?.heldBy ?? null,
		escalatedFrom: plan.decision?.escalatedFrom ?? null,
		escalationReason: plan.decision?.escalationReason ? String(plan.decision.escalationReason).slice(0, 200) : null,
		reason: plan.decision?.reason ? String(plan.decision.reason).slice(0, 200) : null,
		judgeMs: judgeMs ?? null,
		error: error ? String(error).slice(0, 200) : null,
	};
}

/**
 * Cheap size proxy for the current request: message count and textual volume.
 * Stored with each decision so a later stage check can measure what the turn
 * has grown by since that decision.
 */
export function timingOf(options) {
	const messages = Array.isArray(options.messages) ? options.messages : [];
	let chars = 0;
	for (const message of messages) {
		const content = message?.content;
		if (typeof content === "string") chars += content.length;
		else if (Array.isArray(content)) {
			for (const block of content) {
				if (typeof block?.text === "string") chars += block.text.length;
				else if (typeof block?.argumentsDelta === "string") chars += block.argumentsDelta.length;
			}
		}
	}
	return { messageCount: messages.length, chars, messages };
}
