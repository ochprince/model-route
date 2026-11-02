/**
 * Offline smoke test for the model-route pure modules.
 * Run: node test/smoke.mjs
 */
import assert from "node:assert/strict";
import http from "node:http";
import {
	candidatesForTier,
	createStore,
	decisionRecord,
	normalizeAlias,
	planRequest,
} from "../lib/plan.js";
import {
	createDelegateStore,
	delegateBrief,
	planDelegation,
	resolveDelegation,
} from "../lib/delegate.js";
import {
	buildJudgePayload,
	endpointUrl,
	parseJudgeReply,
	buildSystemOneBody,
	buildDecisionBody,
	readDecisionReply,
	callDecisionEndpoint,
} from "../lib/jev.js";
import { JUDGE_KINDS, judgeFamily, judgeKeyEnvOf, judgeKindOf } from "../lib/judges.js";
import { contentText, stableHash, stableStringify } from "../lib/util.js";

let failed = 0;
let passed = 0;
async function check(name, fn) {
	try {
		await fn();
		passed += 1;
	} catch (error) {
		failed += 1;
		console.error(`FAIL ${name}:`, error.message);
		process.exitCode = 1;
	}
}

const CFG = {
	tiers: {
		opus: { provider: "aiapi", model: "glm-5.3", fallbacks: [] },
		sonnet: { provider: "aiapi", model: "glm-5.3-flash", fallbacks: [{ provider: "aiapi", model: "deepseek-v4-flash" }] },
		haiku: { provider: "aiapi", model: "deepseek-v4-flash", fallbacks: [] },
	},
	router: { baseURL: "https://jev.example/v1", model: "jev-1" },
	fallbackTier: "sonnet",
	relayToPrimary: true,
	auxiliary: { compaction: "haiku", "session-title": "haiku" },
	cache: { enabled: true, turnFreeze: true },
};

const req = (overrides = {}) => ({
	provider: "model-route",
	model: "auto",
	messages: [
		{ role: "system", content: [{ type: "text", text: "system prompt" }] },
		{ role: "user", content: [{ type: "text", text: "hello" }] },
	],
	sessionId: "session-1",
	...overrides,
});

await check("stableStringify is order-independent", async () => {
	assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
	assert.notEqual(stableHash({ a: 1 }), stableHash({ a: 2 }));
});

await check("normalizeAlias maps unknown ids to auto", async () => {
	assert.equal(normalizeAlias("opus"), "opus");
	assert.equal(normalizeAlias("AUTO"), "auto");
	assert.equal(normalizeAlias("opusplan"), "auto");
	assert.equal(normalizeAlias(undefined), "auto");
});

await check("purpose calls take the auxiliary tier without judging", async () => {
	const store = createStore();
	let judged = 0;
	const plan = await planRequest({ options: req({ purpose: "compaction", model: "auto" }), cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(plan.tier, "haiku");
	assert.equal(plan.source, "auxiliary");
	assert.equal(judged, 0);
});

await check("an explicit tier maps directly without judging", async () => {
	const store = createStore();
	const plan = await planRequest({ options: req({ model: "opus" }), cfg: CFG, store, judge: async () => { throw new Error("should not judge"); } });
	assert.equal(plan.tier, "opus");
	assert.equal(plan.source, "fixed");
});

await check("router unusable degrades to fixed mapping", async () => {
	const store = createStore();
	const plan = await planRequest({ options: req({ model: "auto" }), cfg: { ...CFG, router: { ...CFG.router, baseURL: "", model: "" } }, store, judge: async () => { throw new Error("should not judge"); } });
	assert.equal(plan.tier, "sonnet"); // fallbackTier
	assert.equal(plan.source, "fixed");
});

await check("an explicit tier never consults the judge", async () => {
	const store = createStore();
	let judged = 0;
	const plan = await planRequest({ options: req({ model: "haiku" }), cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(plan.tier, "haiku");
	assert.equal(plan.source, "fixed");
	assert.equal(judged, 0);
});

await check("auto alias lets the judge choose freely", async () => {
	const store = createStore();
	const plan = await planRequest({ options: req({ model: "auto" }), cfg: CFG, store, judge: async () => ({ tier: "opus" }) });
	assert.equal(plan.tier, "opus");
});

await check("same-turn continuation reuses the frozen decision", async () => {
	const store = createStore();
	let judged = 0;
	const base = req();
	const first = await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	// tool continuation: same turn prefix, assistant + tool result appended
	const cont = { ...base, messages: [...base.messages, { role: "assistant", content: [{ type: "tool-call" }] }, { role: "tool", content: [{ type: "tool-result" }] }] };
	const second = await planRequest({ options: cont, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(first.tier, "sonnet");
	assert.equal(second.tier, "sonnet", "frozen decision reused");
	assert.equal(second.source, "frozen");
	assert.equal(judged, 1, "judge called once");
});

await check("new user turn re-judges", async () => {
	const store = createStore();
	let judged = 0;
	const base = req();
	await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	const nextTurn = { ...base, messages: [...base.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }, { role: "user", content: [{ type: "text", text: "now refactor the whole module" }] }] };
	const second = await planRequest({ options: nextTurn, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus", confidence: 0.9 }; } });
	assert.equal(judged, 2);
	assert.equal(second.tier, "opus");
	assert.equal(second.source, "judge");
});

await check("ambient system-prompt refreshes keep the turn frozen", async () => {
	const store = createStore();
	let judged = 0;
	const base = req({ model: "auto", system: "clock v1", messages: [{ role: "user", content: [{ type: "text", text: "fix the parser" }] }], sessionId: "s-system" });
	await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet", confidence: 0.9 }; } });
	// The runtime may refresh ambient context between steps; that must not look
	// like a new user turn.
	const cont = {
		...base,
		system: "clock v2; attachment notice changed",
		messages: [...base.messages, { role: "assistant", content: [{ type: "text", text: "working" }] }, { role: "tool", content: [{ type: "tool-result", text: "ok" }] }],
	};
	const plan = await planRequest({ options: cont, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus", confidence: 0.9 }; } });
	assert.equal(plan.source, "frozen");
	assert.equal(plan.tier, "sonnet");
	assert.equal(judged, 1);
});

await check("a message-level system refresh also keeps the turn frozen", async () => {
	const store = createStore();
	let judged = 0;
	const base = req({
		model: "auto",
		messages: [
			{ role: "system", content: [{ type: "text", text: "clock v1" }] },
			{ role: "user", content: [{ type: "text", text: "fix the parser" }] },
		],
		sessionId: "s-system-message",
	});
	await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet", confidence: 0.9 }; } });
	const cont = {
		...base,
		messages: [
			{ role: "system", content: [{ type: "text", text: "clock v2" }] },
			{ role: "user", content: [{ type: "text", text: "fix the parser" }] },
			{ role: "assistant", content: [{ type: "text", text: "working" }] },
			{ role: "tool", content: [{ type: "tool-result", text: "ok" }] },
		],
	};
	const plan = await planRequest({ options: cont, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus", confidence: 0.9 }; } });
	assert.equal(plan.source, "frozen");
	assert.equal(plan.tier, "sonnet");
	assert.equal(judged, 1);
});

await check("ambient time messages without a source marker keep the turn frozen", async () => {
	const store = createStore();
	let judged = 0;
	const base = req({
		model: "auto",
		messages: [{ role: "user", content: [{ type: "text", text: "fix the parser" }] }],
		sessionId: "s-ambient-bare",
	});
	await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet", confidence: 0.9 }; } });
	const cont = {
		...base,
		messages: [
			...base.messages,
			{ role: "assistant", content: [{ type: "text", text: "working" }] },
			{ role: "user", content: [{ type: "text", text: "Time sampled while preparing turn 16, step 2: 2026-10-23T15:31:15+08:00" }] },
		],
	};
	const plan = await planRequest({ options: cont, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus", confidence: 0.9 }; } });
	assert.equal(plan.source, "frozen");
	assert.equal(plan.tier, "sonnet");
	assert.equal(judged, 1);
});

await check("exact retry hits the frozen decision without judging", async () => {
	const store = createStore();
	let judged = 0;
	const base = req();
	const first = await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	const second = await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(first.source, "judge");
	assert.equal(second.source, "frozen"); // session freeze takes precedence over the memo
	assert.equal(second.tier, "sonnet");
	assert.equal(judged, 1);
});

await check("memo serves a different session with the same prefix", async () => {
	const store = createStore();
	let judged = 0;
	const base = req();
	await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	const other = req({ sessionId: "session-2" });
	const plan = await planRequest({ options: other, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(plan.source, "memo");
	assert.equal(plan.tier, "sonnet");
	assert.equal(judged, 1);
});

await check("tool results sent as user role do not split the turn", async () => {
	const store = createStore();
	let judged = 0;
	const base = req();
	await planRequest({ options: base, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	const cont = { ...base, messages: [...base.messages, { role: "assistant", content: [{ type: "tool-call" }] }, { role: "user", content: [{ type: "tool-result", text: "result" }] }] };
	const plan = await planRequest({ options: cont, cfg: CFG, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(plan.source, "frozen");
	assert.equal(judged, 1);
});

await check("the judge's verdict is final: no hold, no floor", async () => {
	const store = createStore();
	const turn1 = req({ model: "auto", messages: [{ role: "user", content: [{ type: "text", text: "first task" }] }], sessionId: "s-final" });
	await planRequest({ options: turn1, cfg: CFG, store, judge: async () => ({ tier: "opus", confidence: 0.95 }) });
	const turn2 = {
		...turn1,
		messages: [
			...turn1.messages,
			{ role: "assistant", content: [{ type: "text", text: "ok" }] },
			{ role: "user", content: [{ type: "text", text: "tiny rename" }] },
		],
	};
	// A downgrade from opus to haiku at low confidence is still the answer.
	const plan = await planRequest({ options: turn2, cfg: CFG, store, judge: async () => ({ tier: "haiku", confidence: 0.3 }) });
	assert.equal(plan.tier, "haiku");
	assert.equal(plan.source, "judge");
	assert.equal(plan.decision.heldTo, undefined);
	assert.equal(plan.decision.escalatedFrom, undefined);
});

await check("a rejection reaches the judge instead of being applied by a regex", async () => {
	const store = createStore();
	const turn1 = req({ model: "auto", messages: [{ role: "user", content: [{ type: "text", text: "修复登录流程" }] }], sessionId: "s-reject" });
	await planRequest({ options: turn1, cfg: CFG, store, judge: async () => ({ tier: "sonnet", confidence: 0.9 }) });
	const turn2 = {
		...turn1,
		messages: [
			...turn1.messages,
			{ role: "assistant", content: [{ type: "text", text: "已修复" }] },
			{ role: "user", content: [{ type: "text", text: "还是不对，登录仍然失败" }] },
		],
	};
	let seen = null;
	const plan = await planRequest({ options: turn2, cfg: CFG, store, judge: async (request) => { seen = request; return { tier: "opus", confidence: 0.7 }; } });
	// The judge sees the rejection verbatim and the tier it should beat.
	const payload = buildJudgePayload(turn2, {}, { previousTier: seen.previousTier });
	const state = JSON.parse(payload.user);
	assert.equal(state.latest_user, "还是不对，登录仍然失败");
	assert.equal(state.previous_tier, "sonnet");
	assert.equal(payload.system.includes("Escalate above"), true);
	// The decision is whatever the judge said; no second opinion overrides it.
	assert.equal(plan.tier, "opus");
	assert.equal(plan.source, "judge");
});

await check("a judge failure falls straight to the fallback tier", async () => {
	const store = createStore();
	const plan = await planRequest({ options: req({ sessionId: "s-fail" }), cfg: CFG, store, judge: async () => { throw new Error("jev down"); } });
	assert.equal(plan.tier, "sonnet");
	assert.equal(plan.source, "fallback");
	assert.equal(plan.decision.fallback, true);
	// An explicit ceiling still bounds the fallback.
	const capped = await planRequest({ options: req({ sessionId: "s-fail-2", model: "haiku" }), cfg: CFG, store, judge: async () => { throw new Error("jev down"); } });
	assert.equal(capped.tier, "haiku");
});

await check("the judge payload carries only the request and prior user turns", async () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "第一个请求" }] },
		{ role: "assistant", content: [{ type: "text", text: "助手的长篇回答".repeat(200) }] },
		{ role: "tool", content: [{ type: "tool-result", text: "工具输出".repeat(200) }] },
		{ role: "user", content: [{ type: "text", text: "第二个请求" }] },
		{ role: "assistant", content: [{ type: "text", text: "又一段回答" }] },
		{ role: "user", content: [{ type: "text", text: "最新请求" }] },
	];
	const payload = buildJudgePayload({ provider: "model-route", model: "auto", messages, system: "系统提示词".repeat(500), tools: [{}, {}] }, {}, { previousTier: "sonnet" });
	const state = JSON.parse(payload.user);
	assert.deepEqual(state, {
		latest_user: "最新请求",
		prior_user_turns: ["第一个请求", "第二个请求"],
		previous_tier: "sonnet",
		history_partial: false,
	});
	assert.equal(payload.user.includes("助手的长篇回答"), false, "assistant text is absent");
	assert.equal(payload.user.includes("工具输出"), false, "tool traffic is absent");
	assert.equal(payload.user.includes("系统提示词"), false, "the agent system prompt is absent");
	assert.equal("repetition" in state, false, "no regex-derived block");
});

await check("the judge prompt states principles, not scenarios", async () => {
	const state = JSON.parse(buildJudgePayload(req(), {}, {}).user);
	const prompt = buildJudgePayload(req(), {}, {}).system;
	for (const principle of [
		"Difficulty belongs to the request, not to the conversation",
		"Choosing a cheaper tier than the previous turn is correct",
		"Escalate above `previous_tier`",
		"Do not round uncertain cases upward",
	]) assert.equal(prompt.includes(principle), true, principle);
	// No enumerated scenarios that would box the judge in.
	assert.equal(/按钮|界面|页面|button|panel|refresh/i.test(prompt), false, "prompt names no concrete UI objects");
	assert.equal(state.previous_tier, null);
});

await check("ambient user-role injections do not start a new turn", async () => {
	const store = createStore();
	const base = req({
		model: "auto",
		messages: [{ role: "user", content: [{ type: "text", text: "fix the parser" }] }],
		sessionId: "s-ambient",
	});
	await planRequest({ options: base, cfg: CFG, store, judge: async () => ({ tier: "sonnet", confidence: 0.9 }) });
	// the runtime appends a clock reading (and a model-switch notice) mid-turn
	const injected = {
		...base,
		messages: [
			...base.messages,
			{ role: "assistant", content: [{ type: "text", text: "working" }] },
			{ role: "user", content: [{ type: "text", text: "Time sampled while preparing…" }], source: { kind: "time-context", form: "snapshot" } },
			{ role: "user", content: [{ type: "text", text: "[model changed: …]" }], source: { kind: "model-selection", form: "notice" } },
		],
	};
	const plan = await planRequest({ options: injected, cfg: CFG, store, judge: async () => { throw new Error("must stay frozen"); } });
	assert.equal(plan.source, "frozen");
	assert.equal(plan.tier, "sonnet");
	const payload = buildJudgePayload(injected);
	assert.equal(JSON.parse(payload.user).latest_user, "fix the parser");
});

await check("judge failure falls back to the fallback tier", async () => {
	const store = createStore();
	const plan = await planRequest({ options: req({ model: "auto" }), cfg: CFG, store, judge: async () => { throw new Error("jev down"); } });
	assert.equal(plan.tier, "sonnet"); // fallbackTier
	assert.equal(plan.source, "fallback");
	assert.equal(plan.decision.fallback, true);
});

await check("cache disabled still judges with fallback", async () => {
	const store = createStore();
	const plan = await planRequest({ options: req({ model: "auto" }), cfg: { ...CFG, cache: { enabled: false } }, store, judge: async () => { throw new Error("jev down"); } });
	assert.equal(plan.tier, "sonnet");
	assert.equal(plan.source, "fallback");
});

await check("candidates keep declared failover order", async () => {
	const candidates = candidatesForTier(CFG, "sonnet");
	assert.deepEqual(candidates.map((c) => `${c.provider}/${c.model}`), ["aiapi/glm-5.3-flash", "aiapi/deepseek-v4-flash"]);
	assert.deepEqual(candidatesForTier(CFG, "missing"), []);
});

await check("a follow-up survives without tool traffic in the payload", async () => {
	const messages = [
		{ role: "user", content: [{ type: "text", text: "fix the parser" }] },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "I will inspect src/parser.ts" },
				{ type: "tool-call", id: "c1", name: "read_file", arguments: '{"path":"src/parser.ts"}' },
			],
		},
		{ role: "tool", content: [{ type: "tool-result", toolCallId: "c1", content: [{ type: "text", text: "export function parse(){}" }] }] },
		{ role: "user", content: [{ type: "text", text: "把它改回去" }] },
	];
	const state = JSON.parse(buildJudgePayload(req({ messages })).user);
	assert.equal(state.latest_user, "把它改回去");
	// The earlier request is what makes the follow-up judgeable; the file body,
	// tool name and tool arguments are deliberately not part of the view.
	assert.deepEqual(state.prior_user_turns, ["fix the parser"]);
	const serialized = JSON.stringify(state);
	assert.equal(serialized.includes("read_file"), false);
	assert.equal(serialized.includes("src/parser.ts"), false);
	assert.equal(serialized.includes("export function parse"), false);
});

await check("judge reply keeps the task restatement", async () => {
	const parsed = parseJudgeReply('{"task":"把 parser 的解析顺序改回旧版","tier":"sonnet","confidence":0.8,"reason":"refers to prior edit"}');
	assert.equal(parsed.task, "把 parser 的解析顺序改回旧版");
	assert.equal(parsed.tier, "sonnet");
});

await check("judge reply keeps the task restatement", async () => {
	const parsed = parseJudgeReply('{"task":"把 parser 的解析顺序改回旧版","tier":"sonnet","confidence":0.8,"reason":"refers to prior edit"}');
	assert.equal(parsed.task, "把 parser 的解析顺序改回旧版");
	assert.equal(parsed.tier, "sonnet");
});

await check("prior user turns trim to the nearest ones and mark partial", async () => {
	const long = Array.from({ length: 12 }, (_, index) => ({ role: "user", content: [{ type: "text", text: `turn ${index} ${"x".repeat(200)}` }] }));
	long.push({ role: "user", content: [{ type: "text", text: "latest question" }] });
	const state = JSON.parse(buildJudgePayload(req({ messages: long }), { maxRequestChars: 12000 }).user);
	assert.equal(state.latest_user, "latest question");
	assert.equal(state.prior_user_turns.length, 3, "only the nearest prior turns");
	assert.match(state.prior_user_turns.at(-1), /turn 11/, "nearest first to survive");
	assert.equal(state.history_partial, true);

	// A tight budget drops prior turns instead of touching the request.
	const tight = JSON.parse(buildJudgePayload(req({ messages: long }), { maxRequestChars: 260 }).user);
	assert.equal(tight.latest_user, "latest question", "the request is never trimmed for context");
	assert.ok(tight.prior_user_turns.length <= 1);
	assert.equal(tight.history_partial, true);
});

await check("judge reply parser accepts fenced JSON and rejects junk", async () => {
	assert.equal(parseJudgeReply('```json\n{"tier":"sonnet","confidence":0.8,"reason":"ok"}\n```').tier, "sonnet");
	assert.equal(parseJudgeReply('The decision: {"tier":"opus","confidence":1}!').tier, "opus");
	assert.throws(() => parseJudgeReply("no json here"), /no JSON object/);
	assert.throws(() => parseJudgeReply('{"tier":"mega"}'), /unknown tier/);
});

await check("System One and StartLux request bodies share one tier question", async () => {
	const systemone = buildSystemOneBody({ model: "jev-latest", state: { latest_user: "hi" } });
	assert.equal(systemone.model, "jev-latest");
	assert.deepEqual(systemone.state, { latest_user: "hi" });
	assert.equal(systemone.questions.tier.type, "choice");
	assert.deepEqual(Object.keys(systemone.questions.tier.criteria).sort(), ["haiku", "opus", "sonnet"]);
	// System One has no think-mode or none-check extensions
	assert.equal("think_mode" in systemone, false);
	assert.equal("none_check" in systemone, false);
	assert.deepEqual(Object.keys(systemone).sort(), ["model", "questions", "state"]);

	const startlux = buildDecisionBody({ model: "startlux-decision-27b-autothink", state: { latest_user: "hi" }, thinkMode: "auto", gate: 0.6, mix: 0.75 });
	assert.equal(startlux.questions.tier.type, "choice");
	assert.equal(startlux.think_mode, "auto");
	assert.equal(startlux.none_check, true);
	assert.equal(startlux.gate, 0.6);
	assert.equal(startlux.mix, 0.75);
	const trimmed = buildDecisionBody({ model: "m", state: "s", thinkBudget: 1 });
	assert.equal(trimmed.think_budget, 1);
	const outOfRange = buildDecisionBody({ model: "m", state: "s", thinkBudget: 9000 });
	assert.equal("think_budget" in outOfRange, false);
});

await check("the structured judge request carries the repetition state", async () => {
	let received = null;
	const server = http.createServer((request, response) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({
				answers: { tier: { type: "choice", choice: "haiku", confidence: 0.4, probabilities: { haiku: 0.4 } } },
			}));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const state = {
			latest_user: "再给我一个 URL",
			repetition: {
				previous_tier: "sonnet",
				explicit_failure: false,
				same_intent: true,
				repeated_request: true,
				tool_errors: 0,
			},
		};
		const decision = await callDecisionEndpoint({
			kind: "jev",
			baseURL: `http://127.0.0.1:${server.address().port}/v1`,
			apiKey: "test-key",
			model: "jev-latest",
			timeoutMs: 5000,
			state,
		});
		assert.equal(received.state.repetition.previous_tier, "sonnet");
		assert.equal(received.state.repetition.same_intent, true);
		assert.equal(received.questions.tier.type, "choice");
		assert.equal(decision.tier, "haiku");
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
});

await check("judge families are structured endpoints, not chat protocols", async () => {
	assert.deepEqual(JUDGE_KINDS, ["jev", "startlux"]);
	assert.equal("protocols" in judgeFamily("jev"), false, "JEV exposes no wire-protocol choice");
	assert.equal("protocols" in judgeFamily("startlux"), false);
	assert.equal(judgeFamily("jev").label, "JEV（TypeSafe System One）");
	assert.throws(() => judgeFamily("nope"), /unknown judge kind/);
	// the family decides; no protocol field participates
	assert.equal(judgeKindOf({ kind: "startlux" }), "startlux");
	assert.equal(judgeKindOf({ kind: "jev" }), "jev");
	assert.equal(judgeKindOf({ api: "openai-completions" }), "jev");
	assert.equal(judgeKindOf({}), "jev");
	// an unknown protocol value is not a judge kind
	assert.equal(JUDGE_KINDS.includes("startlux-decisions"), false);
	// each family owns exactly one credential name; the config cannot rename it
	assert.equal(judgeKeyEnvOf({ kind: "jev" }), "JEV_API_KEY");
	assert.equal(judgeKeyEnvOf({ kind: "startlux" }), "BAMBOO_API_KEY");
	// a leftover name from an older profile is inert
	assert.equal(judgeKeyEnvOf({ kind: "startlux", apiKeyEnv: "MY_KEY" }), "BAMBOO_API_KEY");
});

await check("System One answers use TypeSafe's calibrated confidence", async () => {
	const decision = readDecisionReply({ answers: { tier: { type: "choice", choice: "sonnet", confidence: 0.4, probabilities: { haiku: 0.2, sonnet: 0.6, opus: 0.2 } } } }, { kind: "jev" });
	assert.equal(decision.tier, "sonnet");
	assert.equal(decision.confidence, 0.4, "JEV prefers the calibrated confidence over the probability share");
	assert.equal(decision.noneProbability, null);
	assert.equal(decision.reason, "jev: sonnet 0.400 (p 0.600)");
	const sparse = readDecisionReply({ answers: { tier: { choice: "haiku", probabilities: { haiku: 0.7, sonnet: 0.2, opus: 0.1 } } } }, { kind: "jev" });
	assert.equal(sparse.confidence, 0.7, "falls back to the option share when confidence is absent");
	const nulls = readDecisionReply({ answers: { tier: { choice: "haiku", confidence: null, none_probability: null, probabilities: { haiku: 0.5, sonnet: 0.3, opus: 0.2 } } } }, { kind: "jev" });
	assert.equal(nulls.confidence, 0.5, "a null confidence is absent, not zero");
	assert.equal(nulls.noneProbability, null, "a null none_probability is absent, not zero");
	assert.equal(nulls.reason, "jev: haiku 0.500 (p 0.500)");
	assert.throws(() => readDecisionReply({ answers: { tier: { choice: "mega" } } }, { kind: "jev" }), /jev named unknown tier/);
	assert.throws(() => readDecisionReply({}, { kind: "jev" }), /jev reply has no answers\.tier/);
});

await check("structured decisions keep the full tier distribution", async () => {
	const decision = readDecisionReply({
		answers: { tier: { choice: "sonnet", confidence: 0.58, probabilities: { haiku: 0.12, sonnet: 0.72, opus: 0.16 } } },
	}, { kind: "jev" });
	assert.deepEqual(decision.probabilities, { haiku: 0.12, sonnet: 0.72, opus: 0.16 });
	assert.equal(decision.topAlternative, "opus");
	assert.ok(Math.abs(decision.margin - 0.56) < 1e-9);
	const sparse = readDecisionReply({ answers: { tier: { choice: "haiku" } } }, { kind: "jev" });
	assert.equal(sparse.probabilities, null);
	assert.equal(sparse.margin, null);
	const inconsistent = readDecisionReply({
		answers: { tier: { choice: "haiku", probabilities: { haiku: 0.3, sonnet: 0.6, opus: 0.1 } } },
	}, { kind: "jev" });
	assert.equal(inconsistent.margin, 0, "a choice that is not the distribution leader is not decisive");
	assert.equal(inconsistent.topAlternative, "sonnet");
});

await check("StartLux answers map to a tier and expose uncertainty", async () => {
	const decision = readDecisionReply({ answers: { tier: { type: "choice", choice: "opus", confidence: 0.97, none_probability: 0.002, probabilities: { opus: 0.97 } } } });
	assert.equal(decision.tier, "opus");
	assert.equal(decision.confidence, 0.97);
	assert.equal(decision.noneProbability, 0.002);
	assert.equal(decision.reason, "startlux: opus 0.970 (p 0.970, none 0.002)");
	assert.throws(() => readDecisionReply({ answers: { tier: { type: "choice", choice: null, none_probability: 0.9 } } }), /no listed tier/);
	assert.throws(() => readDecisionReply({ answers: { tier: { type: "choice", choice: "sonnet", confidence: 0.9, none_probability: 0.31 } } }), /none_probability/);
	assert.throws(() => readDecisionReply({}), /answers\.tier/);
	assert.throws(() => readDecisionReply({ answers: { tier: { type: "choice", choice: "mega" } } }), /unknown tier/);
	const safe = readDecisionReply({ answers: { tier: { type: "choice", choice: "haiku", confidence: 0.9, none_probability: 0.5 } } }, { noneThreshold: 0.6 });
	assert.equal(safe.tier, "haiku");
});

await check("endpoint normalization keeps each family on its own path", async () => {
	assert.equal(endpointUrl("jev", "https://api.typesafe.ai/v1"), "https://api.typesafe.ai/v1/systemone");
	assert.equal(endpointUrl("jev", "https://api.typesafe.ai"), "https://api.typesafe.ai/v1/systemone");
	assert.equal(endpointUrl("jev", "https://api.typesafe.ai/v1/systemone"), "https://api.typesafe.ai/v1/systemone");
	assert.equal(endpointUrl("jev", "https://api.typesafe.ai/v1/systemone/"), "https://api.typesafe.ai/v1/systemone");
	assert.equal(endpointUrl("startlux", "https://api.bamboonode.dev/v1"), "https://api.bamboonode.dev/v1/decisions");
	assert.equal(endpointUrl("startlux", "https://api.bamboonode.dev"), "https://api.bamboonode.dev/v1/decisions");
	assert.equal(endpointUrl("startlux", "https://api.bamboonode.dev/v1/decisions"), "https://api.bamboonode.dev/v1/decisions");
	assert.equal(endpointUrl("startlux", "https://api.bamboonode.dev/v1/systemone"), "https://api.bamboonode.dev/v1/systemone");
	assert.throws(() => endpointUrl("chat", "https://x/v1"), /not supported/);
	assert.throws(() => endpointUrl("jev", "  "), /empty/);
});

await check("judge proxy sends absolute-form requests and reads the reply", async () => {
	let seen = null;
	const proxy = http.createServer((request, response) => {
		seen = { method: request.method, url: request.url };
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({
			answers: { tier: { type: "choice", choice: "sonnet", confidence: 0.9, probabilities: { sonnet: 0.9 } } },
		}));
	});
	await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	try {
		const decision = await callDecisionEndpoint({
			kind: "jev",
			baseURL: "http://judge.invalid/v1",
			apiKey: "test-key",
			model: "jev-latest",
			timeoutMs: 5000,
			state: { latest_user: "hi" },
			proxy: `http://127.0.0.1:${proxy.address().port}`,
		});
		assert.equal(decision.tier, "sonnet");
		assert.equal(seen.method, "POST");
		assert.equal(seen.url, "http://judge.invalid/v1/systemone", "HTTP targets use absolute-form proxy requests");
	} finally {
		await new Promise((resolve) => proxy.close(resolve));
	}
});

await check("judge proxy surfaces the upstream status and body", async () => {
	const proxy = http.createServer((_request, response) => {
		response.writeHead(451, { "content-type": "application/json" });
		response.end(JSON.stringify({ title: "Typesafe is not available in your region.", status: 451 }));
	});
	await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
	try {
		await assert.rejects(callDecisionEndpoint({
			kind: "jev",
			baseURL: "http://judge.invalid/v1",
			apiKey: "k",
			model: "m",
			timeoutMs: 5000,
			state: { latest_user: "hi" },
			proxy: `http://127.0.0.1:${proxy.address().port}`,
		}), /judge endpoint failed \(HTTP 451\).*not available in your region/);
	} finally {
		await new Promise((resolve) => proxy.close(resolve));
	}
});

await check("judge proxy refuses malformed URLs and SOCKS", async () => {
	const base = {
		kind: "jev",
		baseURL: "https://judge.example/v1",
		apiKey: "k",
		model: "m",
		timeoutMs: 2000,
		state: { latest_user: "hi" },
	};
	await assert.rejects(callDecisionEndpoint({ ...base, proxy: "socks5://127.0.0.1:1080" }), /must use http:\/\/ or https:\/\//);
	await assert.rejects(callDecisionEndpoint({ ...base, proxy: "http://[bad" }), /invalid judge proxy URL/);
});

// ---------------------------------------------------------- judgment nodes
const toolResult = (text, isError = false) => ({ role: "tool", content: [{ type: "tool-result", text }], isError });
const NODE_CFG = { ...CFG, cache: { ...CFG.cache, turnFreeze: true, switchHold: false } };

await check("a new user turn is judged", async () => {
	const store = createStore();
	let judged = 0;
	const plan = await planRequest({ options: req(), cfg: NODE_CFG, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	assert.equal(plan.source, "judge");
	assert.equal(judged, 1);
});

await check("tool continuations stay frozen no matter how much work they add", async () => {
	const store = createStore();
	let judged = 0;
	const cfg = NODE_CFG;
	await planRequest({ options: req(), cfg, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	// 12 tool results, 60k+ characters, and one failed tool: none of these judge.
	const messages = [...req().messages];
	for (let index = 0; index < 12; index += 1) {
		messages.push({ role: "assistant", content: [{ type: "tool-call" }] }, toolResult("x".repeat(8000)));
	}
	messages.push(toolResult("boom", true));
	const plan = await planRequest({ options: { ...req(), messages }, cfg, store, judge: async () => { judged += 1; return { tier: "opus" }; } });
	assert.equal(plan.source, "frozen");
	assert.equal(plan.tier, "sonnet");
	assert.equal(judged, 1, "only the turn decision ran");
});

await check("a rebuilt history is judged again and marked as such", async () => {
	const store = createStore();
	let judged = 0;
	const cfg = NODE_CFG;
	const base = req();
	await planRequest({ options: base, cfg, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	const rebuilt = {
		...base,
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "摘要：此前在处理 README 的错别字。" }] },
			base.messages[base.messages.length - 1],
		],
	};
	const plan = await planRequest({ options: rebuilt, cfg, store, judge: async () => { judged += 1; return { tier: "opus", confidence: 0.9 }; } });
	assert.equal(plan.source, "judge");
	assert.equal(plan.boundary, "rebuild");
	assert.equal(plan.tier, "opus");
	assert.equal(judged, 2);
});

await check("a rebuilt history takes the judge's answer without a switch gate", async () => {
	const store = createStore();
	const cfg = { ...NODE_CFG, cache: { ...NODE_CFG.cache, switchHold: true, switchConfidence: 0.7 } };
	const base = req();
	await planRequest({ options: base, cfg, store, judge: async () => ({ tier: "opus" }) });
	const rebuilt = {
		...base,
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "摘要" }] },
			{ role: "user", content: [{ type: "text", text: "hello" }] },
		],
	};
	// confidence below the switch gate: normally held, but the cache is gone here.
	const plan = await planRequest({ options: rebuilt, cfg, store, judge: async () => ({ tier: "haiku", confidence: 0.4 }) });
	assert.equal(plan.tier, "haiku");
});

await check("a frozen decision never outlives a second user turn", async () => {
	const store = createStore();
	let judged = 0;
	const cfg = NODE_CFG;
	const base = req();
	await planRequest({ options: base, cfg, store, judge: async () => { judged += 1; return { tier: "haiku" }; } });
	const nextTurn = {
		...base,
		messages: [...base.messages, { role: "assistant", content: [{ type: "text", text: "done" }] }, { role: "user", content: [{ type: "text", text: "now refactor it" }] }],
	};
	const plan = await planRequest({ options: nextTurn, cfg, store, judge: async () => { judged += 1; return { tier: "opus", confidence: 0.9 }; } });
	assert.equal(judged, 2);
	assert.equal(plan.tier, "opus");
});

await check("turnFreeze off judges every continuation", async () => {
	const store = createStore();
	let judged = 0;
	const cfg = { ...CFG, cache: { ...CFG.cache, turnFreeze: false } };
	const base = req();
	await planRequest({ options: base, cfg, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	const cont = { ...base, messages: [...base.messages, { role: "assistant", content: [{ type: "tool-call" }] }, toolResult("ok")] };
	await planRequest({ options: cont, cfg, store, judge: async () => { judged += 1; return { tier: "sonnet" }; } });
	assert.equal(judged, 2);
});

// ---------------------------------------------------------------- delegation
const DELEGATE_CFG = { ...CFG, route: "model-route", delegate: { maxCandidates: 3 } };

await check("delegate brief carries the task, context, and preset", async () => {
	const brief = delegateBrief({ task: "给 parser 补单元测试", context: "只改 tests/", preset: "code" });
	assert.match(brief, /委派子任务：给 parser 补单元测试/);
	assert.match(brief, /背景：只改 tests\//);
	assert.match(brief, /预设：code/);
});

await check("delegation judges the task and resolves a concrete model", async () => {
	const store = createDelegateStore(DELEGATE_CFG);
	const answer = await planDelegation({
		cfg: DELEGATE_CFG,
		store,
		judge: async () => ({ tier: "opus", confidence: 0.8, reason: "cross-module" }),
		task: "重构整个运存层",
	});
	assert.equal(answer.tier, "opus");
	assert.equal(answer.provider, "aiapi");
	assert.equal(answer.model, "glm-5.3");
	assert.equal(answer.source, "judge");
	assert.equal(answer.alternatives.length, 0);
});

await check("delegation memo reuses an identical task", async () => {
	const store = createDelegateStore(DELEGATE_CFG);
	let judged = 0;
	const judge = async () => { judged += 1; return { tier: "sonnet" }; };
	await planDelegation({ cfg: DELEGATE_CFG, store, judge, task: "写一个小脚本" });
	const second = await planDelegation({ cfg: DELEGATE_CFG, store, judge, task: "写一个小脚本" });
	assert.equal(judged, 1);
	assert.equal(second.source, "memo");
	assert.equal(second.cached, true);
});

await check("delegation honours a ceiling and falls back on judge failure", async () => {
	const store = createDelegateStore(DELEGATE_CFG);
	const capped = await planDelegation({
		cfg: DELEGATE_CFG,
		store,
		judge: async () => ({ tier: "opus" }),
		task: "扫一遍日志找错别字",
		maxTier: "haiku",
	});
	assert.equal(capped.tier, "haiku");
	assert.equal(capped.model, "deepseek-v4-flash");
	const failed = await planDelegation({
		cfg: DELEGATE_CFG,
		store,
		judge: async () => { throw new Error("judge down"); },
		task: "另一个任务",
	});
	assert.equal(failed.fallback, true);
	assert.equal(failed.tier, "sonnet");
	assert.match(failed.error, /judge down/);
});

await check("delegation candidates relay upward when a tier is unconfigured", async () => {
	const cfg = { ...DELEGATE_CFG, tiers: { sonnet: CFG.tiers.sonnet, opus: CFG.tiers.opus } };
	const picked = resolveDelegation({ cfg, tier: "haiku", maxCandidates: 3 });
	assert.deepEqual(picked.map((candidate) => candidate.tier), ["sonnet", "sonnet"]);
	assert.equal(picked[0].model, "glm-5.3-flash");
});

console.log(`smoke: ${passed} checks passed${failed ? `, ${failed} failed` : ""}`);
