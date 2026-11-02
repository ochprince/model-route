/**
 * Judge families: one strategy object per kind of decision model.
 *
 * A family owns everything that differs between decision models — its endpoint
 * shape, how a call is made, and how its answer is read into the shared
 * `{tier, confidence, reason}` shape (including its own confidence scale). The
 * adapter and the planner only see that shared shape, so adding a new judge (or
 * giving one family a different scale) never touches routing.
 *
 * Both built-in families are structured decision APIs, not chat completions:
 * JEV speaks TypeSafe's System One endpoint, StartLux speaks its decisions
 * endpoint. A chat model can still serve as judge through a registered provider
 * route (`router.<family>.provider`), which the adapter handles separately.
 */
import {
	DECISION_KINDS,
	JudgeError,
	callDecisionEndpoint,
} from "./jev.js";

/**
 * JEV (TypeSafe System One): one `choice` question over the tier criteria,
 * posted to `/v1/systemone`. Its confidence is the probability JEV assigned to
 * the chosen option.
 */
const jev = {
	label: "JEV（TypeSafe System One）",
	defaultKeyEnv: "JEV_API_KEY",
	async call({ router, built, apiKey, signal, attribution }) {
		return callDecisionEndpoint({
			kind: "jev",
			baseURL: router.baseURL,
			apiKey,
			model: router.model,
			timeoutMs: router.timeoutMs,
			signal,
			state: built.state,
			attribution,
			proxy: router.proxy,
		});
	},
};

/**
 * StartLux structured decisions: the same tier question plus its think-mode and
 * none-check extensions. Its confidence is the probability the model assigned
 * to the chosen option (its `probabilities` share), which is the same meaning
 * JEV's answer carries — so one threshold reads sensibly across families.
 */
const startlux = {
	label: "StartLux 结构化判定",
	defaultKeyEnv: "BAMBOO_API_KEY",
	async call({ router, built, apiKey, signal, attribution }) {
		return callDecisionEndpoint({
			kind: "startlux",
			baseURL: router.baseURL,
			apiKey,
			model: router.model,
			timeoutMs: router.timeoutMs,
			signal,
			state: built.state,
			decision: {
				thinkMode: router.thinkMode,
				thinkBudget: router.thinkBudget,
				gate: router.gate,
				mix: router.mix,
				noneThreshold: router.noneThreshold,
			},
			attribution,
			proxy: router.proxy,
		});
	},
};

export const JUDGE_KINDS = DECISION_KINDS;

export const JUDGE_FAMILIES = { jev, startlux };

/**
 * The credential one family reads. Fixed per family and not configurable: the
 * family already decides the endpoint shape, so it decides the key slot too —
 * a key stored for one judge is never silently reused by another.
 */
export function judgeKeyEnvOf(router) {
	return judgeFamily(judgeKindOf(router)).defaultKeyEnv;
}

/** Resolve one family by kind, refusing unknown kinds with a configuration error. */
export function judgeFamily(kind) {
	const family = JUDGE_FAMILIES[kind];
	if (family === undefined) throw new JudgeError(`unknown judge kind "${String(kind)}"; expected one of ${JUDGE_KINDS.join(", ")}`, "INVALID_CONFIG");
	return family;
}

/**
 * The judge family one router config selects. `kind` is authoritative; no wire
 * protocol field participates in the choice.
 */
export function judgeKindOf(router) {
	return router?.kind === "startlux" ? "startlux" : "jev";
}

export { buildDecisionBody, readDecisionReply } from "./jev.js";