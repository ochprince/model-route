/**
 * Adapter-level integration test against the REAL dsh packages (imported from
 * the extracted app runtime) with a mock host context and a mock upstream llm.
 *
 * Covers: config schema resolution, alias catalog, judge via endpoint mock,
 * turn freeze across tool continuations, exact tier picks, bounded failover,
 * and replay rebasing.
 *
 * Run: node test/adapter.test.mjs
 *
 * Needs the real `@deepseek-ai` peer packages resolvable from this directory
 * (`node_modules/@deepseek-ai/{cordis,schemastery,dsh-llm,dsh-credentials,
 * dsh-launch-environment}` plus their transitive deps). They ship inside the
 * installed app's `app.asar` (`dsh/node_modules/…`), not on npm — extract them
 * there when missing, or point `node_modules` at a dsh source checkout. Without
 * them only test/smoke.mjs runs.
 */
import assert from "node:assert/strict";

// The real packages resolve through the symlinked node_modules.
const { Context } = await import("@deepseek-ai/cordis");
const { Config, TierGatewayAdapter, name, inject, apply } = await import("../lib/index.js");
const { LlmAdapter: dshLlmAdapter } = await import("@deepseek-ai/dsh-llm");

const rootConfig = {
	route: "model-route",
	displayName: "ModelRoute 智能模型路由",
	tiers: {
		opus: { provider: "aiapi", model: "glm-5.3" },
		sonnet: { provider: "aiapi", model: "glm-5.3-flash", fallbacks: [{ provider: "aiapi", model: "deepseek-v4-flash" }] },
		haiku: { provider: "aiapi", model: "deepseek-v4-flash" },
	},
	enableRouter: "jev",
	router: {
		jev: {
			baseURL: "https://jev.example/v1",
			model: "jev-latest",
			timeoutMs: 5000,
		},
	},
	fallbackTier: "sonnet",
	relayToPrimary: true,
	auxiliary: { compaction: "haiku", "session-title": "haiku" },
	cache: { enabled: true, turnFreeze: true, replayRewrite: true },
	logDecisions: true,
};

let failed = 0;
let passed = 0;
async function check(label, fn) {
	try {
		await fn();
		passed += 1;
		console.log(`ok   ${label}`);
	} catch (error) {
		failed += 1;
		console.error(`FAIL ${label}:`, error.message);
		process.exitCode = 1;
	}
}

await check("config schema validates the example config", async () => {
	const validation = Config["~standard"].validate(rootConfig);
	assert.ok(!validation.issues, `schema accepts the example config: ${JSON.stringify(validation.issues ?? [])}`);
});

await check("config schema accepts a minimal config with defaults", async () => {
	const validation = Config["~standard"].validate({});
	assert.ok(!validation.issues, `schema accepts an empty config: ${JSON.stringify(validation.issues ?? [])}`);
});

await check("config schema validates per-family router entries", async () => {
	const validation = Config["~standard"].validate({
		enableRouter: "startlux",
		router: {
			jev: { baseURL: "https://jev.example/v1", model: "jev-1" },
			startlux: { baseURL: "https://api.bamboonode.dev/v1", model: "startlux-decision-27b-autothink", gate: 0.5, thinkMode: "never" },
		},
	});
	assert.ok(!validation.issues, `schema accepts per-family entries: ${JSON.stringify(validation.issues ?? [])}`);
});

await check("enableRouter is a live (volatile) top-level field", async () => {
	const json = Config.toJSON();
	const root = json.refs[json.uid];
	const selector = json.refs[root.dict.enableRouter];
	assert.equal(selector.meta.volatile, true, "the panel saves the selector as a live field");
});

await check("router is a dict and rejects a selector nested inside it", async () => {
	const validation = Config["~standard"].validate({ router: { enableRouter: "startlux" } });
	assert.ok(validation.issues, "router.enableRouter (a string in the entry dict) must be rejected");
});

await check("router entries accept an optional HTTP proxy", async () => {
	const validation = Config["~standard"].validate({
		router: { jev: { baseURL: "https://jev.example/v1", model: "jev-1", proxy: "http://127.0.0.1:7897" } },
	});
	assert.ok(!validation.issues, `schema accepts a proxy: ${JSON.stringify(validation.issues ?? [])}`);
});

function chunkText(index, text) {
	return { type: "text-delta", index, text };
}
function finishOk(usage) {
	return { type: "usage", usage: usage ?? { input: 1, output: 1 } };
}
function finishError(message, code) {
	return { type: "finish", reason: { kind: "error", failure: { message, code: code ?? "AUTH" } } };
}

mockHost.routes = [];
function mockHost({ upstreamFailures = 0, requests = [] } = {}) {
	let remainingFailures = upstreamFailures;
	const streams = [];
	const llm = {
		stream(options) {
			requests.push({ provider: options.provider, model: options.model, messages: options.messages, reasoningEffort: options.reasoningEffort });
			const self = this;
			async function* gen() {
				if (remainingFailures > 0 && options.provider === "aiapi") {
					remainingFailures -= 1;
					yield finishError(`mock failure for ${options.model}`);
					return;
				}
				streams.push(options);
				yield chunkText(0, `hello from ${options.model}`);
				yield finishOk();
			}
			return gen();
		},
		registerAdapter(routes, adapter) {
			const handle = () => {};
			handle.replace = () => {};
			mockHost.registered = { routes, adapter };
			return handle;
		},
		registerConfigurableProviders(entries) {
			mockHost.directory = entries;
			const handle = () => {};
			handle.replace = () => {};
			return handle;
		},
		registerModelDiscovery(ns, discover) {
			mockHost.discovery = { ns, discover };
			return () => {};
		},
	};
	const tools = {
		tools: new Map(),
		register(tool) {
			this.tools.set(tool.name, tool);
			mockHost.tool = tool;
			return () => {
				this.tools.delete(tool.name);
				if (mockHost.tool === tool) mockHost.tool = undefined;
			};
		},
	};
	const logger = process.env.DEBUG_LOGS ? { info: (...a) => console.error("INFO", ...a), warn: (...a) => console.error("WARN", ...a), error: (...a) => console.error("ERR", ...a) } : { info: () => {}, warn: () => {}, error: () => {} };
	const ctx = {
		llm,
		tools,
		logger,
		fiber: { entry: { options: { id: "llm-model-route" } } },
		get(service) {
			if (service === "tools") return tools;
			if (service === "credentials") {
				// every family's default credential resolves; an unknown ref does not
				return { resolve: async (ref) => ({ value: `key-${ref}` }) };
			}
			return undefined;
		},
		effect(fn) { const dispose = fn(); return () => typeof dispose === "function" ? dispose() : undefined; },
		on(event, handler) { (mockHost.listeners ??= {})[event] = handler; },
		inject(_services, callback) {
			callback({
				webServer: {
					register(route) {
						mockHost.routes.push(route);
						return () => {};
					},
				},
				effect(fn) { const dispose = fn(); return () => typeof dispose === "function" ? dispose() : undefined; },
			});
		},
	};
	return { ctx, llm, requests, streams };
}

async function collect(stream) {
	const chunks = [];
	const iterator = stream[Symbol.asyncIterator]();
	while (true) {
		const next = await iterator.next();
		if (next.done) break;
		chunks.push(next.value);
	}
	return chunks;
}

const message = (role, text) => ({ role, content: [{ type: "text", text }] });
const baseOptions = () => ({
	provider: "model-route",
	model: "auto",
	messages: [message("user", "fix a small typo in README")],
	sessionId: "s-1",
});

// Global fetch mock for both structured judge endpoints.
const originalFetch = globalThis.fetch;
let judgeReply = { choice: "sonnet", confidence: 0.97, none: 0.004 };
let lastJudgeRequest = null;
globalThis.fetch = async (url, init) => {
	const body = JSON.parse(init.body);
	lastJudgeRequest = { url: String(url), body };
	const probabilities = { haiku: 0.2, sonnet: 0.2, opus: 0.2 };
	if (judgeReply.choice !== null) probabilities[judgeReply.choice] = judgeReply.confidence;
	const answer = {
		type: "choice",
		choice: judgeReply.choice,
		confidence: judgeReply.confidence,
		probabilities,
	};
	// only StartLux asks for (and answers with) the none probability
	if (body.none_check === true) answer.none_probability = judgeReply.none;
	return {
		ok: true,
		status: 200,
		text: async () => JSON.stringify({
			model: body.model,
			answers: { tier: answer },
			usage: { input_tokens: 120, output_tokens: 0 },
		}),
	};
};

try {
	await check("plugin exports the loader contract", async () => {
		assert.equal(name, "llm-model-route");
		assert.deepEqual(inject, ["llm"]);
		assert.equal(typeof apply, "function");
		assert.ok(Config, "Config export present");
		assert.equal(typeof dshLlmAdapter, "function", "real dsh-llm loaded");
	});

	await check("apply registers route, directory, and discovery", async () => {
		const host = mockHost();
		apply(host.ctx, rootConfig);
		assert.deepEqual(mockHost.registered.routes, ["model-route"]);
		assert.equal(mockHost.directory[0].provider, "model-route");
		assert.equal(mockHost.discovery.ns, "llm-model-route");
	});

	await check("listModels advertises only auto", async () => {
		const host = mockHost();
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		const models = await adapter.listModels("model-route");
		assert.deepEqual(models.map((m) => m.id), ["auto"]);
		assert.deepEqual(models.map((m) => m.name), ["auto"]);
		assert.deepEqual(models.map((m) => m.description), [""]);
	});

	await check("auto streams through the judged tier with failover", async () => {
		const host = mockHost({ upstreamFailures: 1 });
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		const chunks = await collect(adapter.stream(baseOptions()));
		assert.equal(chunks[0].type, "text-delta");
		assert.equal(chunks[chunks.length - 1].type, "usage");
		// first candidate failed, second (fallback deepseek-v4-flash) served
		const upstreams = host.requests.filter((r) => r.provider === "aiapi").map((r) => r.model);
		assert.deepEqual(upstreams, ["glm-5.3-flash", "deepseek-v4-flash"]);
	});

	await check("JEV judges through the System One endpoint", async () => {
		judgeReply = { choice: "sonnet", confidence: 0.94, none: 0.004 };
		const host = mockHost();
		apply(host.ctx, rootConfig);
		await collect(mockHost.registered.adapter.stream({ ...baseOptions(), sessionId: "s-jev" }));
		assert.equal(lastJudgeRequest.url, "https://jev.example/v1/systemone");
		const body = lastJudgeRequest.body;
		assert.equal(body.model, "jev-latest");
		assert.equal(body.questions.tier.type, "choice");
		assert.deepEqual(Object.keys(body.questions.tier.criteria).sort(), ["haiku", "opus", "sonnet"]);
		assert.equal(body.state.latest_user, "fix a small typo in README");
		// System One has no StartLux extensions
		assert.equal("think_mode" in body, false);
		assert.equal("none_check" in body, false);
		assert.equal("none_budget" in body, false);
		assert.equal(host.streams[0].model, "glm-5.3-flash");
	});

	await check("startlux structured decisions route the judged tier", async () => {
		judgeReply = { choice: "opus", confidence: 0.98, none: 0.002 };
		const host = mockHost();
		const cfg = {
			...rootConfig,
			enableRouter: "startlux",
			router: {
				...rootConfig.router,
				startlux: {
					baseURL: "https://api.bamboonode.dev/v1",
					model: "startlux-decision-27b-autothink",
				},
			},
		};
		apply(host.ctx, cfg);
		const adapter = mockHost.registered.adapter;
		await collect(adapter.stream({ ...baseOptions(), sessionId: "s-startlux" }));
		assert.equal(lastJudgeRequest.url, "https://api.bamboonode.dev/v1/decisions");
		const body = lastJudgeRequest.body;
		assert.equal(body.model, "startlux-decision-27b-autothink");
		assert.equal(body.think_mode, "auto");
		assert.equal(body.none_check, true);
		assert.equal(body.questions.tier.type, "choice");
		assert.deepEqual(Object.keys(body.questions.tier.criteria).sort(), ["haiku", "opus", "sonnet"]);
		assert.equal(body.state.latest_user, "fix a small typo in README");
		assert.equal(host.streams[0].model, "glm-5.3");
	});

	await check("enableRouter picks the entry; the other family stays inert", async () => {
		judgeReply = { choice: "opus", confidence: 0.9, none: 0.01 };
		const cfg = {
			...rootConfig,
			router: {
				jev: { baseURL: "https://jev.example/v1", model: "jev-latest" },
				startlux: { baseURL: "https://api.bamboonode.dev/v1", model: "startlux-decision-27b-autothink" },
			},
		};
		const host = mockHost();
		apply(host.ctx, { ...cfg, enableRouter: "startlux" });
		await collect(mockHost.registered.adapter.stream({ ...baseOptions(), sessionId: "s-kind" }));
		assert.equal(lastJudgeRequest.url, "https://api.bamboonode.dev/v1/decisions");
		assert.equal(host.streams[0].model, "glm-5.3");

		// flipping the selector switches families; neither entry was rewritten
		judgeReply = { choice: "sonnet", confidence: 0.9, none: 0.01 };
		const host2 = mockHost();
		apply(host2.ctx, { ...cfg, enableRouter: "jev" });
		await collect(mockHost.registered.adapter.stream({ ...baseOptions(), sessionId: "s-kind-2" }));
		assert.equal(lastJudgeRequest.url, "https://jev.example/v1/systemone");
		assert.equal(host2.streams[0].model, "glm-5.3-flash");
	});

	await check("startlux uncertainty falls back to the fallback tier", async () => {
		judgeReply = { choice: null, confidence: 0, none: 0.61 };
		const host = mockHost();
		const cfg = {
			...rootConfig,
			enableRouter: "startlux",
			router: {
				...rootConfig.router,
				startlux: {
					baseURL: "https://api.bamboonode.dev/v1",
					model: "startlux-decision-27b-autothink",
				},
			},
		};
		apply(host.ctx, cfg);
		const adapter = mockHost.registered.adapter;
		await collect(adapter.stream({ ...baseOptions(), sessionId: "s-startlux-2" }));
		assert.equal(host.streams[0].model, "glm-5.3-flash"); // fallbackTier sonnet
	});

	await check("the judge test route runs a real judge call for staged values", async () => {
		judgeReply = { choice: "sonnet", confidence: 0.9, none: 0.004 };
		mockHost.routes = [];
		const host = mockHost();
		apply(host.ctx, rootConfig);
		const route = mockHost.routes.find((candidate) => candidate.path === "/model-route/judge-test");
		assert.ok(route, "test route registered");
		const body = {
			kind: "jev",
			baseURL: "https://jev.example/v1",
			model: "jev-latest",
		};
		let status = 0;
		let payload = "";
		const req = {
			method: "POST",
			headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
			async *[Symbol.asyncIterator]() {
				yield Buffer.from(JSON.stringify(body));
			},
		};
		const res = {
			writeHead(code) {
				status = code;
			},
			end(text) {
				payload = text;
			},
		};
		await route.handler(req, res);
		assert.equal(status, 200);
		const answer = JSON.parse(payload);
		assert.equal(answer.ok, true);
		assert.equal(answer.tier, "sonnet");
		assert.ok(Number.isFinite(answer.ms));
		assert.equal(lastJudgeRequest.url, "https://jev.example/v1/systemone");
		assert.equal(lastJudgeRequest.body.model, "jev-latest");
		assert.equal(lastJudgeRequest.body.questions.tier.type, "choice");
		assert.equal(lastJudgeRequest.body.state.latest_user, "把 README 里的错别字改掉，并补一句用法说明。");
	});

	await check("the judge test route refuses cross-site posts", async () => {
		mockHost.routes = [];
		apply(mockHost().ctx, rootConfig);
		const route = mockHost.routes.find((candidate) => candidate.path === "/model-route/judge-test");
		let status = 0;
		const req = {
			method: "POST",
			headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
			async *[Symbol.asyncIterator]() {
				yield Buffer.from("{}");
			},
		};
		const res = { writeHead(code) { status = code; }, end() {} };
		await route.handler(req, res);
		assert.equal(status, 403);
	});

	await check("access log writes route and result lines when enabled", async () => {
		judgeReply = { choice: "sonnet", confidence: 0.9, none: 0.004 };
		const { readFileSync, existsSync, rmSync } = await import("node:fs");
		const logPath = `/tmp/model-route-test-${Date.now()}.jsonl`;
		const host = mockHost();
		const cfg = { ...rootConfig, log: { enabled: true, path: logPath } };
		apply(host.ctx, cfg);
		const adapter = mockHost.registered.adapter;
		const first = { ...baseOptions(), sessionId: "s-log" };
		await collect(adapter.stream(first));
		const continuation = {
			...first,
			messages: [
				...first.messages,
				{ role: "assistant", content: [{ type: "text", text: "working" }] },
				{ role: "tool", content: [{ type: "tool-result", text: "done" }] },
			],
		};
		await collect(adapter.stream(continuation));
		assert.ok(existsSync(logPath), "log file created");
		const lines = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const routes = lines.filter((line) => line.kind === "route");
		const results = lines.filter((line) => line.kind === "result");
		const route = routes[0];
		const result = results[0];
		assert.equal(route.tier, "sonnet");
		assert.equal(route.source, "judge");
		assert.deepEqual(route.upstream, { provider: "aiapi", model: "glm-5.3-flash" });
		assert.equal(route.sessionId, "s-log");
		assert.equal(typeof route.reqId, "string");
		assert.equal(route.attempt, 1);
		assert.equal(route.preview, "fix a small typo in README");
		assert.equal(result.finish, "ok");
		assert.deepEqual(result.usage, { input: 1, output: 1 });
		assert.ok(Number.isFinite(result.ms));
		assert.equal(result.reqId, route.reqId);
		// the result line carries only what the route line cannot: correlation and outcome
		assert.equal("upstream" in result, false);
		assert.equal("alias" in result, false);
		assert.equal("tier" in result, false);
		assert.equal("source" in result, false);
		assert.equal(result.attempt, route.attempt);
		// the frozen continuation reuses the turn's decision: it logs its result
		// only, joined to the same turn, and produces no second route line
		assert.equal(routes.length, 1, "one route line per turn");
		assert.equal(results.length, 2, "one result line per model call");
		assert.equal(results[1].turn, route.turn);
		assert.equal(typeof route.turn, "string");
		assert.equal(route.turn.length, 8);
		rmSync(logPath, { force: true });

		const quietPath = `/tmp/model-route-quiet-${Date.now()}.jsonl`;
		apply(mockHost().ctx, { ...rootConfig, log: { enabled: false, path: quietPath } });
		await collect(mockHost.registered.adapter.stream({ ...baseOptions(), sessionId: "s-quiet" }));
		assert.equal(existsSync(quietPath), false, "disabled log writes nothing");
	});

	await check("same-turn tool continuation reuses the frozen decision", async () => {
		const host = mockHost();
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		await collect(adapter.stream(baseOptions()));
		const continuation = baseOptions();
		continuation.messages = [...continuation.messages, message("assistant", "working"), { role: "tool", content: [{ type: "tool-result", text: "done" }] }];
		await collect(adapter.stream(continuation));
		const judgeCalls = host.requests.filter((r) => r.provider === "jev.example");
		assert.equal(judgeCalls.length, 0, "no second upstream dispatch for the judge");
		assert.equal(host.streams.length, 2, "two upstream dispatches, one judge call");
	});

	await check("an explicit tier bypasses the judge entirely", async () => {
		const host = mockHost({ judgeReply: '{"tier":"opus","confidence":1,"reason":"big"}' });
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		await collect(adapter.stream({ ...baseOptions(), model: "haiku" }));
		const served = host.requests.filter((r) => r.provider === "aiapi").map((r) => r.model);
		assert.deepEqual(served, ["deepseek-v4-flash"]);
		const judgeCalls = host.requests.filter((r) => r.provider === "jev.example");
		assert.equal(judgeCalls.length, 0);
	});

	await check("replay rebase rewrites gateway-produced assistant history", async () => {
		const host = mockHost();
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		const history = [
			message("user", "first"),
			{ role: "assistant", content: [{ type: "text", text: "earlier answer" }], source: { kind: "model", provider: "model-route", model: "auto", replayState: { v: 1 } } },
			message("user", "second"),
		];
		await collect(adapter.stream({ ...baseOptions(), messages: history }));
		const dispatched = host.streams[0];
		assert.equal(dispatched.messages[1].source.provider, "aiapi");
		assert.ok(dispatched.messages[1].source.replayState, "replay envelope preserved");
	});

	await check("a tier that names the gateway itself is refused, not recursed", async () => {
		const host = mockHost();
		const cfg = {
			...rootConfig,
			tiers: { ...rootConfig.tiers, opus: { provider: "model-route", model: "auto" } },
		};
		apply(host.ctx, cfg);
		const adapter = mockHost.registered.adapter;
		await assert.rejects(
			async () => collect(adapter.stream({ ...baseOptions(), model: "opus" })),
			/points at the gateway itself/,
		);
		assert.equal(host.streams.length, 0, "no upstream dispatch happened");
	});

	await check("all candidates exhausted fails explicitly", async () => {
		const host = mockHost({ upstreamFailures: 99 });
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		await assert.rejects(
			collect(adapter.stream(baseOptions())),
			/every candidate for tier "sonnet" failed/,
		);
	});

	await check("auxiliary purpose routes directly to haiku", async () => {
		const host = mockHost();
		apply(host.ctx, rootConfig);
		const adapter = mockHost.registered.adapter;
		await collect(adapter.stream({ ...baseOptions(), purpose: "session-title" }));
		const served = host.requests.filter((r) => r.provider === "aiapi").map((r) => r.model);
		assert.deepEqual(served, ["deepseek-v4-flash"]);
	});
// ------------------------------------------------------------- judgment nodes

await check("tool continuations stay frozen: a failed tool does not re-judge", async () => {
	judgeReply = { choice: "sonnet", confidence: 0.97, none: 0.004 };
	const host = mockHost();
	apply(host.ctx, rootConfig);
	const adapter = mockHost.registered.adapter;
	const first = baseOptions();
	await collect(adapter.stream(first));
	judgeReply = { choice: "opus", confidence: 0.97, none: 0.004 };
	const continuation = {
		...first,
		messages: [...first.messages,
			{ role: "assistant", content: [{ type: "tool-call" }], source: { kind: "model", provider: "model-route", model: "auto" } },
			{ role: "tool", content: [{ type: "tool-result", text: "error: tests failed" }], isError: true }],
	};
	await collect(adapter.stream(continuation));
	const served = host.requests.filter((request) => request.provider === "aiapi").map((request) => request.model);
	assert.deepEqual(served, ["glm-5.3-flash", "glm-5.3-flash"], "the frozen tier is reused");
});

await check("a rebuilt history re-judges through the adapter", async () => {
	judgeReply = { choice: "sonnet", confidence: 0.97, none: 0.004 };
	const host = mockHost();
	apply(host.ctx, rootConfig);
	const adapter = mockHost.registered.adapter;
	const first = baseOptions();
	await collect(adapter.stream(first));
	judgeReply = { choice: "opus", confidence: 0.97, none: 0.004 };
	const rebuilt = {
		...first,
		messages: [
			{ role: "assistant", content: [{ type: "text", text: "摘要：此前在改 README。" }] },
			first.messages[first.messages.length - 1],
		],
	};
	await collect(adapter.stream(rebuilt));
	const served = host.requests.filter((request) => request.provider === "aiapi").map((request) => request.model);
	assert.deepEqual(served, ["glm-5.3-flash", "glm-5.3"], "compaction forces a fresh decision");
});

await check("route_tier registers a delegation tool that returns a model", async () => {
	judgeReply = { choice: "opus", confidence: 0.9, none: 0.004 };
	const host = mockHost();
	apply(host.ctx, rootConfig);
	const tool = mockHost.tool;
	assert.ok(tool, "route_tier registered");
	assert.equal(tool.name, "route_tier");
	const value = await tool.execute({ task: "重构整个调度层", context: "只改 crates/scheduler" }, { agent: null });
	assert.equal(value.tier, "opus");
	assert.equal(value.provider, "aiapi");
	assert.equal(value.model, "glm-5.3");
	assert.equal(value.fallback, false);
	assert.match(value.usage_hint, /provider="aiapi"/);
});

await check("route_tier honours max_tier and reports a fallback when judging fails", async () => {
	judgeReply = { choice: "opus", confidence: 0.9, none: 0.004 };
	const host = mockHost();
	apply(host.ctx, rootConfig);
	const tool = mockHost.tool;
	const capped = await tool.execute({ task: "扫描日志找错别字", max_tier: "haiku" }, { agent: null });
	assert.equal(capped.tier, "haiku");
	assert.equal(capped.model, "deepseek-v4-flash");
	judgeReply = { choice: null, confidence: 0, none: 0.9 };
	const failed = await tool.execute({ task: "另一个任务", context: "different" }, { agent: null });
	assert.equal(failed.fallback, true);
	assert.equal(failed.tier, "sonnet");
});

	await check("a volatile delegate config edit swaps the tool without a reload", async () => {
		const host = mockHost();
		// emulate a live config ref: the same apply() sees new values on .get()
		let live = { enabled: true, toolName: "route_tier" };
		const config = { ...rootConfig, delegate: { get: () => live } };
		apply(host.ctx, config);
		assert.equal(mockHost.tool?.name, "route_tier", "initial tool name");
		live = { enabled: true, toolName: "pick_model" };
		mockHost.listeners["loader/volatile-update"]();
		assert.equal(mockHost.tool?.name, "pick_model", "tool swapped in place");
		live = { enabled: false, toolName: "pick_model" };
		mockHost.listeners["loader/volatile-update"]();
		assert.equal(mockHost.tool, undefined, "disabled config withdraws the tool");
	});

} finally {
	globalThis.fetch = originalFetch;
}

console.log(`adapter: ${passed} checks passed${failed ? `, ${failed} failed` : ""}`);
