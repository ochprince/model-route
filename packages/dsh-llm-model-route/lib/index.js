/**
 * @deepseek-ai harness plugin: model-route gateway (智能模型网关).
 *
 * Registers ONE provider route that exposes the three tier aliases
 * (`opus` / `sonnet` / `haiku`) plus `auto`. Each request is routed by a
 * HiRoute-style decision layer:
 *
 *   purpose calls ──► auxiliary tier mapping (no judge)
 *   explicit tier ─► that tier's configured model (no judge)
 *   auto           ─► frozen decision (same turn) → prefix memo → judge model
 *
 * Upstream dispatch re-enters `ctx.llm.stream` so every registered provider
 * route keeps its own adapter, credentials, protocol handling, and image
 * projection. Candidates per tier are tried in order (bounded failover).
 *
 * All model-management functionality (API addresses, model discovery,
 * multi-protocol endpoints) stays with the standard provider adapter
 * (`@deepseek-ai/dsh-llm-pi-ai`), which this bundle mounts alongside.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LlmAdapter, LlmError, attributionHeaders, assertUsableApiKey, freezeMessage } from "@deepseek-ai/dsh-llm";
import { launchEnvironmentOf } from "@deepseek-ai/dsh-launch-environment";
import z from "@deepseek-ai/schemastery";
import {
	candidatesForTier,
	createStore,
	decisionRecord,
	normalizeAlias,
	planRequest,
} from "./plan.js";
import {
	JudgeError,
	buildJudgePayload,
	callJudgeRoute,
	parseJudgeReply,
} from "./jev.js";
import { JUDGE_KINDS, judgeFamily, judgeKeyEnvOf, judgeKindOf } from "./judges.js";
import { createDelegateStore, delegateOptions, planDelegation } from "./delegate.js";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { contentText, isTurnStartUser, lastTurnUserIndex, ref, squeeze } from "./util.js";

const name = "llm-model-route";
const inject = ["llm"];
const NS = "llm-model-route";

//#region judge test route
const JUDGE_TEST_PATH = "/model-route/judge-test";

/** One draft router config from the panel's test request, validated by shape. */
function judgeRouterDraft(body) {
	const text = (value, fallback = "") => (typeof value === "string" ? value : fallback);
	const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
	return {
		kind: body?.kind === "startlux" ? "startlux" : "jev",
		baseURL: text(body?.baseURL),
		model: text(body?.model),
		proxy: text(body?.proxy),
		provider: text(body?.provider),
		prompt: text(body?.prompt),
		temperature: number(body?.temperature) ?? 0,
		timeoutMs: number(body?.timeoutMs) ?? 20000,
		maxRequestChars: number(body?.maxRequestChars) ?? 24000,
		thinkMode: body?.thinkMode,
		thinkBudget: number(body?.thinkBudget),
		gate: number(body?.gate),
		mix: number(body?.mix),
		noneThreshold: number(body?.noneThreshold),
	};
}

/** The synthetic turn a test judges: one short user message. */
function judgeTestOptions(route, sample) {
	const text = typeof sample === "string" && sample.trim() !== ""
		? sample.trim().slice(0, 2000)
		: "把 README 里的错别字改掉，并补一句用法说明。";
	return {
		provider: route,
		model: "auto",
		messages: [{ role: "user", content: [{ type: "text", text }] }],
		sessionId: "judge-test",
	};
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

function respondJson(res, status, payload) {
	res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
	res.end(JSON.stringify(payload));
}
//#endregion

//#region config schema
const CandidateSchema = z.object({
	provider: z.string().required().description("上游 provider 路由名（如 aiapi）"),
	model: z.string().required().description("上游模型 id"),
	reasoningEffort: z.string().description("可选：覆盖推理档位"),
});
const TierSchema = z.object({
	provider: z.string().required().description("主候选上游 provider 路由名"),
	model: z.string().required().description("主候选上游模型 id"),
	reasoningEffort: z.string().description("可选：主候选推理档位"),
	fallbacks: z.array(CandidateSchema).default([]).description("有界故障转移候选（按顺序尝试）"),
});
/** One judge endpoint's config. `router` holds one entry per family (keyed by
 *  kind), so each family keeps its own endpoint and a switch just edits the
 *  other entry — no shadow copies, no restore logic. */
const RouterEntrySchema = z.object({
	baseURL: z.string().default("").description("判定模型地址（jev：https://api.typesafe.ai/v1；startlux：https://api.bamboonode.dev/v1）；留空可用 provider 引用"),
	model: z.string().default("").description("判定模型 id（jev 用 jev-latest；startlux 用其 decisions 模型）"),
	proxy: z.string().default("").description("判定请求的 HTTP(S) 代理，如 http://127.0.0.1:7897；留空直连（仅判定端点，不含上游模型请求）"),
	provider: z.string().default("").description("备选：复用已注册 provider 路由来调用判定模型（baseURL 优先）"),
	temperature: z.number().default(0).description("判定采样温度（仅 provider 路由判定使用；结构化端点没有该参数）"),
	timeoutMs: z.number().default(20000),
	maxRequestChars: z.number().default(24000).description("判定请求的上下文字符预算（超出从最旧截断）"),
	prompt: z.string().default("").description("自定义判定提示词（仅 provider 路由判定使用；结构化端点的标准由问题 criteria 给出）"),
	thinkMode: z.union(["auto", "always", "never"]).default("auto")
		.description("仅 startlux 条目使用：思考触发时机"),
	thinkBudget: z.number().description("仅 startlux 条目使用：思考预算 1..4096（省略用服务端默认）"),
	gate: z.number().default(0.6).description("仅 startlux 条目使用：auto 模式下触发思考的置信度阈值"),
	mix: z.number().default(0.75).description("仅 startlux 条目使用：思考后读数权重 (1-mix)*首次 + mix*思考后"),
	noneThreshold: z.number().default(0.2).description("仅 startlux 条目使用：none_probability 达到该值时视为无合适档位并回退"),
});
const LogSchema = z.object({
	enabled: z.boolean().default(false).description("把每次路由决策与结果追加到 JSONL 访问日志（调试/分析用）"),
	path: z.string().default("").description("日志文件路径；留空用 $DSH_HOME/logs/model-route.jsonl"),
	maxBytes: z.number().default(16 * 1024 * 1024).description("单文件上限，超过后轮转为 .1"),
	previewChars: z.number().default(400).description("route 行记录的待判定用户消息预览长度（0 = 不记内容）"),
});
const DelegateSchema = z.object({
	enabled: z.boolean().default(true)
		.description("注册 route_tier 工具：委派子智能体前，为这个子任务选择模型"),
	toolName: z.string().default("route_tier").description("工具名"),
	defaultMaxTier: z.union(["", "haiku", "sonnet", "opus"]).default("")
		.description("委派判定的默认上限档位（空 = 不设上限）"),
	memo: z.boolean().default(true).description("相同子任务复用上一次判定"),
	cacheTtlMs: z.number().default(3600000).description("委派判定缓存 TTL"),
	maxCandidates: z.number().default(3).description("返回的候选模型数量上限"),
});

const CacheSchema = z.object({
	enabled: z.boolean().default(true).description("启用决策缓存（回合冻结 + 前缀备忘）"),
	turnFreeze: z.boolean().default(true).description("同一回合内（工具续跑）冻结决策，保证前缀 KV 缓存命中"),
	memoTtlMs: z.number().default(6 * 60 * 60 * 1000).description("前缀备忘 TTL"),
	memoMaxEntries: z.number().default(512),
	replayRewrite: z.boolean().default(true).description("将本网关产出的 assistant 历史改写到上游路由，尽量保留上游原生 replay"),
});
const Config = z.object({
	route: z.string().default("model-route").description("对外 provider 路由名"),
	displayName: z.string().default("ModelRoute 智能模型路由"),
	tiers: z.dict(TierSchema).default({}).volatile()
		.description("档位映射：opus/sonnet/haiku 各自的上游模型（键可为任意档位别名）"),
	enableRouter: z.union(["jev", "startlux"]).default("jev").volatile()
		.description("启用的判定模型家族；router 字典按家族（jev / startlux）各存一份端点配置"),
	router: z.dict(RouterEntrySchema).default({}).volatile()
		.description("判定模型（决策模型）端点配置，键为家族名（jev / startlux）"),
	fallbackTier: z.union(["haiku", "sonnet", "opus"]).default("sonnet")
		.description("判定模型不可用或失败时的兜底档位"),
	relayToPrimary: z.boolean().default(true)
		.description("低档候选耗尽后是否中继到请求档位（ceiling）的候选"),
	auxiliary: z.dict(z.union(["haiku", "sonnet", "opus"])).default({ compaction: "haiku", "session-title": "haiku" }).volatile()
		.description("辅助调用（压缩/标题等 purpose）直接使用的档位，不经判定模型"),
	delegate: DelegateSchema.default({}).volatile(),
	cache: CacheSchema.default({}).volatile(),
	log: LogSchema.default({}).volatile(),
	logDecisions: z.boolean().default(true).description("把每次路由决策写入日志（联调用）"),
});
//#endregion

//#region decision log
/** The turn text the decision was made on, squeezed and truncated for review. */
function previewOf(options, chars) {
	const messages = Array.isArray(options.messages) ? options.messages : [];
	const index = lastTurnUserIndex(messages);
	let text = index < 0 ? "" : squeeze(contentText(messages[index]?.content));
	// A step request can carry only tool/assistant context (or an ambient user
	// injection); fall back to the newest non-empty user text so the monitor
	// still has a meaningful preview instead of an unexplained blank.
	if (text === "") {
		for (let cursor = messages.length - 1; cursor >= 0; cursor -= 1) {
			if (!isTurnStartUser(messages[cursor])) continue;
			const candidate = squeeze(contentText(messages[cursor]?.content));
			if (candidate !== "") {
				text = candidate;
				break;
			}
		}
	}
	return text.slice(0, chars);
}

/**
 * Append-only JSONL access log. One `route` line per routing decision and one
 * `result` line per completed relay, both carrying the session, the alias, the
 * chosen tier, its source (judge / frozen / memo / fixed / fallback /
 * auxiliary), and the upstream model actually served.
 *
 * Disabled unless `log.enabled` is set. A write failure can never fail the
 * request: the first failure is reported once and further ones stay silent.
 * The file rotates to `<path>.1` once it exceeds `log.maxBytes`.
 */
function createDecisionLog({ config, logger }) {
	let warned = false;
	let openedPath = null;
	const resolvePath = () => {
		const entry = config().log ?? {};
		const custom = String(entry.path ?? "").trim();
		if (custom) return custom;
		const home = process.env.DSH_HOME || join(homedir(), ".dsh");
		return join(home, "logs", "model-route.jsonl");
	};
	return (record) => {
		const entry = config().log ?? {};
		if (entry.enabled !== true) return;
		try {
			const file = resolvePath();
			if (openedPath !== file) {
				mkdirSync(dirname(file), { recursive: true });
				const limit = Number(entry.maxBytes) || 16 * 1024 * 1024;
				try {
					if (statSync(file).size > limit) renameSync(file, `${file}.1`);
				} catch {
					// absent file: nothing to rotate
				}
				openedPath = file;
			}
			appendFileSync(file, `${JSON.stringify(record)}\n`);
		} catch (error) {
			if (warned) return;
			warned = true;
			logger.warn(`model-route: access log write failed (${error?.message ?? error}); further failures are silent`);
		}
	};
}
//#endregion

//#region snapshot
function snapshot(config) {
	const tiersRaw = ref(config.tiers, {});
	const tiers = {};
	for (const [key, value] of Object.entries(tiersRaw ?? {})) {
		tiers[key] = {
			provider: ref(value?.provider, ""),
			model: ref(value?.model, ""),
			reasoningEffort: ref(value?.reasoningEffort, "") || undefined,
			fallbacks: (Array.isArray(value?.fallbacks) ? value.fallbacks : []).map((candidate) => ({
				provider: ref(candidate?.provider, ""),
				model: ref(candidate?.model, ""),
				reasoningEffort: ref(candidate?.reasoningEffort, "") || undefined,
			})),
		};
	}
	const routerRaw = ref(config.router, {});
	// Resolve the enabled family's entry and flatten it into the router shape
	// the planner and judge families consume; the other entries stay inert.
	const kind = ref(config.enableRouter, "jev") === "startlux" ? "startlux" : "jev";
	const entryRaw = (routerRaw !== null && typeof routerRaw === "object" && !Array.isArray(routerRaw))
		? ref(routerRaw[kind], {}) ?? {}
		: {};
	const delegateRaw = ref(config.delegate, {});
	const auxRaw = ref(config.auxiliary, {});
	const cacheRaw = ref(config.cache, {});
	const logRaw = ref(config.log, {});
	return {
		route: ref(config.route, "model-route"),
		displayName: ref(config.displayName, "ModelRoute 智能模型路由"),
		tiers,
		router: {
			kind,
			baseURL: ref(entryRaw?.baseURL, ""),
			model: ref(entryRaw?.model, ""),
			proxy: ref(entryRaw?.proxy, ""),
			provider: ref(entryRaw?.provider, ""),
			temperature: ref(entryRaw?.temperature, 0),
			timeoutMs: ref(entryRaw?.timeoutMs, 20000),
			maxRequestChars: ref(entryRaw?.maxRequestChars, 24000),
			prompt: ref(entryRaw?.prompt, ""),
			thinkMode: ref(entryRaw?.thinkMode, "auto"),
			thinkBudget: ref(entryRaw?.thinkBudget, undefined),
			gate: ref(entryRaw?.gate, 0.6),
			mix: ref(entryRaw?.mix, 0.75),
			noneThreshold: ref(entryRaw?.noneThreshold, 0.2),
		},
		fallbackTier: ref(config.fallbackTier, "sonnet"),
		relayToPrimary: ref(config.relayToPrimary, true),
		auxiliary: Object.fromEntries(Object.entries(auxRaw ?? {}).map(([key, value]) => [key, ref(value, "sonnet")])),
		log: {
			enabled: ref(logRaw?.enabled, false),
			path: ref(logRaw?.path, ""),
			maxBytes: ref(logRaw?.maxBytes, 16 * 1024 * 1024),
			previewChars: ref(logRaw?.previewChars, 400),
		},
		cache: {
			enabled: ref(cacheRaw?.enabled, true),
			turnFreeze: ref(cacheRaw?.turnFreeze, true),
			memoTtlMs: ref(cacheRaw?.memoTtlMs, 6 * 60 * 60 * 1000),
			memoMaxEntries: ref(cacheRaw?.memoMaxEntries, 512),
			replayRewrite: ref(cacheRaw?.replayRewrite, true),
		},
		delegate: {
			enabled: ref(delegateRaw?.enabled, true),
			toolName: ref(delegateRaw?.toolName, "route_tier"),
			defaultMaxTier: ref(delegateRaw?.defaultMaxTier, ""),
			memo: ref(delegateRaw?.memo, true),
			cacheTtlMs: ref(delegateRaw?.cacheTtlMs, 3600000),
			maxCandidates: ref(delegateRaw?.maxCandidates, 3),
		},
		logDecisions: ref(config.logDecisions, true),
	};
}
//#endregion

//#region adapter

class TierGatewayAdapter extends LlmAdapter {
	constructor(deps) {
		super();
		this.deps = deps; // { ctx, config, store, resolveApiKey, decisions }
	}

	providerInfo(provider) {
		return { id: provider, name: this.deps.config().displayName || provider };
	}

	/** GUI catalog: only `auto`. Explicit tier aliases still resolve on request
	 *  (backward compatible) but are not advertised — pick concrete upstream
	 *  models from their own providers instead. */
	listModels(provider) {
		return Promise.resolve([{
			provider,
			id: "auto",
			name: "auto",
			description: "",
		}]);
	}

	async resolveModel(provider, model, _signal) {
		const alias = normalizeAlias(model);
		return {
			provider,
			id: alias,
			name: alias,
		};
	}

	async *stream(options) {
		const cfg = this.deps.config();
		const plan = await this.deps.plan(options, cfg);
		const alias = normalizeAlias(options.model);

		// Bounded failover chain (HiRoute-style): the decided tier's candidates
		// in order, then — only when relaying is enabled and the ceiling tier is
		// more capable — the ceiling tier's candidates. Economy may relay to
		// primary; a primary selection stays within primary.
		const chain = [...candidatesForTier(cfg, plan.tier)];
		const seen = new Set(chain.map((candidate) => `${candidate.provider}/${candidate.model}`));
		if (cfg.relayToPrimary !== false && plan.ceiling && plan.ceiling !== plan.tier) {
			for (const candidate of candidatesForTier(cfg, plan.ceiling)) {
				const key = `${candidate.provider}/${candidate.model}`;
				if (!seen.has(key)) {
					seen.add(key);
					chain.push(candidate);
				}
			}
		}
		if (chain.length === 0) {
			throw new LlmError(
				`model-route: no upstream configured for tier "${plan.tier}" (alias "${alias}"); configure tiers.${plan.tier}.{provider,model}`,
				"INVALID_CONFIG",
			);
		}
		// A tier that names this gateway would recurse: refuse instead of looping.
		const selfRoute = cfg.route;
		const usable = chain.filter((candidate) => candidate.provider !== selfRoute);
		if (usable.length !== chain.length) {
			this.deps.ctx.logger.warn(`model-route: tier "${plan.tier}" names the gateway itself as an upstream; ignoring that candidate`);
		}
		if (usable.length === 0) {
			throw new LlmError(
				`model-route: tier "${plan.tier}" points at the gateway itself ("${selfRoute}"); configure another provider route`,
				"INVALID_CONFIG",
			);
		}

		const judgeMs = plan.decision?.judgeMs ?? null;
		const reqId = randomUUID();
		const startedAt = Date.now();

		let lastFailure = null;
		let attempt = 0;
		for (const candidate of usable) {
			attempt += 1;
			const dispatched = this.dispatchOptions(options, cfg, candidate);
			const iterator = this.deps.ctx.llm.stream(dispatched)[Symbol.asyncIterator]();
			let first = await iterator.next();
			if (first.done) {
				lastFailure = `upstream ${candidate.provider}/${candidate.model} produced an empty stream`;
				continue;
			}
			const chunk = first.value;
			if (chunk?.type === "finish" && chunk.reason?.kind === "aborted") {
				yield chunk;
				this.result({ reqId, attempt, turn: plan.turn, usage: null, finish: "aborted", ms: Date.now() - startedAt });
				return;
			}
			if (chunk?.type === "finish" && chunk.reason?.kind === "error") {
				lastFailure = `${candidate.provider}/${candidate.model}: ${chunk.reason.failure?.message ?? "unknown failure"}`;
				this.deps.ctx.logger.warn(`model-route: candidate failed (${lastFailure}); trying next`);
				this.record({ options, plan, candidate: null, judgeMs, error: lastFailure, reqId, attempt });
				continue;
			}
			this.record({ options, plan, candidate, judgeMs, reqId, attempt });
			let usage = null;
			let finish = null;
			const observe = (value) => {
				if (value?.type === "usage") usage = value.usage ?? null;
				else if (value?.type === "finish") finish = value.reason?.kind ?? null;
			};
			observe(chunk);
			yield chunk;
			while (true) {
				const next = await iterator.next();
				if (next.done) break;
				observe(next.value);
				yield next.value;
			}
			this.result({ reqId, attempt, turn: plan.turn, usage, finish, ms: Date.now() - startedAt });
			return;
		}
		this.record({ options, plan, candidate: null, judgeMs, error: lastFailure ?? "exhausted", reqId, attempt });
		throw new LlmError(
			`model-route: every candidate for tier "${plan.tier}" failed (alias "${alias}")${lastFailure ? `; last failure: ${lastFailure}` : ""}`,
			"NO_ADAPTER",
		);
	}

	/** Build the upstream options: alias → upstream identity, replay rebase. */
	dispatchOptions(options, cfg, candidate) {
		const next = { ...options, provider: candidate.provider, model: candidate.model };
		// Reasoning effort only travels when this candidate declares one; the
		// upstream adapter re-validates against its exact model.
		if (candidate.reasoningEffort) next.reasoningEffort = candidate.reasoningEffort;
		else delete next.reasoningEffort;
		if (cfg.cache.replayRewrite === false) return next;
		let changed = false;
		const messages = (Array.isArray(options.messages) ? options.messages : []).map((message) => {
			if (message?.role !== "assistant") return message;
			const source = message.source;
			if (source?.kind !== "model" || source.provider !== options.provider) return message;
			changed = true;
			// Keep the replay envelope intact: it was produced by the upstream
			// adapter for that route, and rebasing lets the runtime's ownership
			// check retain it instead of degrading the assistant history.
			return freezeMessage({
				...message,
				source: { ...source, provider: candidate.provider, model: candidate.model },
			});
		});
		return changed ? { ...next, messages } : next;
	}

	/** One `result` line per completed relay: usage, latency, and finish kind. */
	result({ reqId, attempt, turn, usage, finish, ms }) {
		this.deps.log?.({
			kind: "result",
			reqId,
			attempt,
			turn: turn ?? null,
			at: Date.now(),
			usage: usage ?? null,
			finish: finish ?? "ok",
			ms,
		});
	}

	record({ options, plan, candidate, judgeMs, error, reqId, attempt }) {
		// A frozen continuation reuses this turn's decision: the turn's single
		// `route` line already carries it, and the per-call fact is the matching
		// `result` line. Only a failure changes the story, so only it logs here.
		if (plan.source === "frozen" && !error) return;
		const entry = decisionRecord({ options, plan, candidate, judgeMs, error });
		this.deps.decisions.push(entry);
		if (this.deps.decisions.length > 200) this.deps.decisions.splice(0, this.deps.decisions.length - 200);
		const previewChars = Number(this.deps.config().log?.previewChars) || 0;
		this.deps.log?.({
			kind: "route",
			reqId: reqId ?? null,
			attempt: attempt ?? null,
			preview: previewChars > 0 ? previewOf(options, previewChars) : null,
			...entry,
		});
		if (this.deps.config().logDecisions && candidate) {
			this.deps.ctx.logger.info(
				`model-route: ${entry.alias} → ${entry.tier} (${entry.source}${entry.boundary ? ` @${entry.boundary}` : ""}${entry.escalatedFrom ? ` from ${entry.escalatedFrom}` : ""}${entry.confidence !== null ? `, confidence ${entry.confidence.toFixed(2)}` : ""}) → ${entry.upstream.model}@${entry.upstream.provider}${entry.judgeMs !== null ? `, judge ${entry.judgeMs}ms` : ""}${entry.escalationReason ? `, ${entry.escalationReason}` : ""}`,
			);
		}
	}
}
//#endregion

//#region plugin
function apply(ctx, config) {
	const settingsNs = ctx.fiber?.entry?.options?.id ?? NS;
	const store = createStore();
	const decisions = [];

	const cfg = () => snapshot(config);

	/** Resolve the judge API key through the harness credential seam. */
	const resolveApiKey = async (router) => {
		const name2 = judgeKeyEnvOf(router);
		const credentials = ctx.get("credentials");
		const hit = credentials !== undefined
			? (await credentials.resolve(name2))?.value
			: launchEnvironmentOf(ctx).get(name2)?.value;
		if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, NS, name2);
		throw new LlmError(
			`${NS}: judge credential ${name2} is not set — store it through the credentials service (the web Models page writes it) or export it in the launching environment`,
			"MISSING_CREDENTIAL",
		);
	};

	/** One judge call: hand-declared endpoint, else a registered route. */
	/**
	 * Run one judge call for an explicit router config. The adapter passes the
	 * live config; the panel's test route passes the values currently staged in
	 * the form (plus an unsaved key, so a fresh key can be tried before saving).
	 */
	const runJudge = async (router, options, { overrideKey, previousTier } = {}) => {
		const started = Date.now();
		const useEndpoint = Boolean(router.baseURL);
		if (!useEndpoint && !router.provider) {
			throw new JudgeError("judge router has neither baseURL nor provider route", "INVALID_CONFIG");
		}
		const built = buildJudgePayload(options, {
			maxRequestChars: router.maxRequestChars,
		}, { previousTier });
		const system = router.prompt || built.system;
		const user = built.user;
		const signal = options.signal ?? undefined;
		let decision;
		if (useEndpoint) {
			const apiKey = overrideKey ?? await resolveApiKey(router);
			const family = judgeFamily(judgeKindOf(router));
			decision = await family.call({ router, built, apiKey, signal, attribution: attributionHeaders() });
		} else {
			const text = await callJudgeRoute({
				streamLlm: async (request) => {
					const collected = await collectText(ctx.llm.stream({
						provider: request.provider,
						model: request.model,
						messages: [
							{ role: "system", content: [{ type: "text", text: request.system }] },
							{ role: "user", content: [{ type: "text", text: request.user }] },
						],
						temperature: request.temperature,
						maxTokens: 512,
						signal: request.signal,
					}));
					return collected.text;
				},
				provider: router.provider,
				model: router.model,
				temperature: router.temperature,
				system,
				user,
				signal,
			});
			decision = parseJudgeReply(text);
		}
		decision.judgeMs = Date.now() - started;
		return decision;
	};

	const judge = async ({ options, previousTier }) => {
		try {
			return await runJudge(cfg().router, options, { previousTier });
		} catch (error) {
			// A judge failure degrades to the fallback tier; say so once per
			// session so a misconfigured endpoint is visible instead of silent.
			const reason = String(error?.message ?? error);
			if (judgeFailure.last !== reason) {
				judgeFailure.last = reason;
				ctx.logger.warn(`model-route: judge unavailable (${reason}); routing falls back to "${cfg().fallbackTier}" inside the ceiling`);
			}
			throw error;
		}
	};
	const judgeFailure = { last: null };


	/** Collect text deltas from one chunk stream; throws on error finishes. */
	async function collectText(stream) {
		let text = "";
		const iterator = stream[Symbol.asyncIterator]();
		while (true) {
			const next = await iterator.next();
			if (next.done) return { text };
			const chunk = next.value;
			if (chunk?.type === "text-delta" && typeof chunk.text === "string") text += chunk.text;
			if (chunk?.type === "finish") {
				if (chunk.reason?.kind === "error") {
					throw new JudgeError(`judge route failed: ${chunk.reason.failure?.message ?? "unknown"}`, "JUDGE_FAILED");
				}
				if (chunk.reason?.kind === "aborted") {
					throw new JudgeError("judge route aborted", "ABORTED");
				}
			}
		}
	}

	const plan = async (options, current) => {
		return planRequest({ options, cfg: current, store, judge });
	};

	const log = createDecisionLog({ config: cfg, logger: ctx.logger });
	const adapter = new TierGatewayAdapter({ ctx, config: cfg, store, decisions, plan, log });

	let registration;
	let registeredRoute;
	const ensureRegistration = () => {
		const route = cfg().route;
		if (registration === undefined) {
			registration = ctx.llm.registerAdapter([route], adapter);
			registeredRoute = route;
		} else if (registeredRoute !== route) {
			registration.replace([route]);
			registeredRoute = route;
		}
	};
	ensureRegistration();

	/** Models-page row for the gateway route (config edited at the root path). */
	let directory;
	let directoryFacts;
	const ensureDirectory = () => {
		const current = cfg();
		const entry = {
			provider: current.route,
			displayName: current.displayName || current.route,
			settingsNs,
			settingsPath: [],
			declared: true,
		};
		const facts = JSON.stringify(entry);
		if (facts === directoryFacts) return;
		if (directory === undefined) directory = ctx.llm.registerConfigurableProviders([entry]);
		else directory.replace([entry]);
		directoryFacts = facts;
	};
	ensureDirectory();

	/** Discovery offer: the catalog is synthetic (only `auto`), no network needed. */
	ctx.llm.registerModelDiscovery(settingsNs, async (request) => {
		const current = cfg();
		if (request.provider && request.provider !== current.route) return [];
		return adapter.listModels(request.provider ?? current.route);
	});

	/**
	 * Delegation-time routing (HiRoute Worker-plan analogue): before delegating,
	 * the agent asks which tier the *task* needs and gets a concrete
	 * provider/model pair back. Registered only when a tools registry exists and
	 * the config keeps it enabled.
	 */
	const delegateStore = createDelegateStore(cfg());
	let delegateTool = { name: null, dispose: null };
	const ensureDelegationTool = () => {
	try {
		const delegateCfg = delegateOptions(cfg());
		const tools = ctx.get("tools");
		const toolName = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(delegateCfg.toolName) ? delegateCfg.toolName : "route_tier";
		const wanted = delegateCfg.enabled && tools?.register !== undefined ? toolName : null;
		// Volatile config edits (enabled / toolName) take effect without a plugin
		// reload: withdraw the previous registration before installing the next.
		if (delegateTool.name !== wanted) {
			delegateTool.dispose?.();
			delegateTool = { name: null, dispose: null };
		}
		if (wanted !== null && delegateTool.dispose === null) {
			const dispose = tools.register(defineTool({
				name: toolName,
				description: [
					"Choose the model tier for a task BEFORE delegating it to a subagent.",
					"Returns the tier plus a concrete provider/model you can pass to the subagent tool's provider/model fields (when that tool exposes model selection).",
					"Call it once per delegation with a short task statement; identical tasks reuse the previous answer.",
				].join(" "),
				parameters: {
					task: {
						type: "string",
						required: true,
						description: "The delegated task, stated as the outcome the subagent must produce (one or two sentences).",
					},
					context: {
						type: "string",
						description: "Optional context the subagent will not see in its own prompt: files, constraints, why the work exists.",
					},
					max_tier: {
						type: "string",
						enum: ["haiku", "sonnet", "opus"],
						description: "Optional ceiling: never pick above this tier (e.g. pass haiku for a cheap read-only sweep).",
					},
					preset: {
						type: "string",
						description: "Optional subagent preset id the task will run under, if that changes its difficulty.",
					},
				},
				output: {
					schema: {
						type: "object",
						additionalProperties: false,
						properties: {
							tier: { type: "string", required: true, enum: ["haiku", "sonnet", "opus"] },
							provider: { type: "string", required: true },
							model: { type: "string", required: true },
							reasoning_effort: { type: "string" },
							alternatives: {
								type: "array",
								required: true,
								items: {
									type: "object",
									additionalProperties: false,
									properties: {
										tier: { type: "string", required: true },
										provider: { type: "string", required: true },
										model: { type: "string", required: true },
									},
								},
							},
							confidence: { type: "number" },
							reason: { type: "string", required: true },
							fallback: { type: "boolean", required: true },
							usage_hint: { type: "string", required: true },
						},
					},
					render: (_args, value) => [{
						type: "text",
						text: `委派档位：${value.tier} → ${value.model}@${value.provider}${value.fallback ? "（判定不可用，已用兜底档位）" : ""}\n${value.usage_hint}`,
					}],
				},
				async execute(args, exec) {
					const current = cfg();
					const started = Date.now();
					const delegation = await planDelegation({
						cfg: current,
						store: delegateStore,
						judge: async (request) => judge({ options: request.options, mode: "delegate" }),
						task: args.task,
						context: args.context,
						preset: args.preset,
						maxTier: args.max_tier,
					});
					const usageHint = delegation.provider && delegation.model
						? `委派时传 provider="${delegation.provider}" model="${delegation.model}"${delegation.reasoningEffort ? ` reasoning_effort="${delegation.reasoningEffort}"` : ""}（需该 subagent 工具已开启 modelSelectionSettings；否则子智能体沿用父模型）`
						: "没有可用的上游候选：请先配置 tiers 与上游 provider 路由，子智能体将沿用父模型。";
					const record = {
						kind: "delegate",
						at: Date.now(),
						task: squeeze(String(args.task ?? "")).slice(0, Number(current.log?.previewChars) || 200),
						tier: delegation.tier,
						provider: delegation.provider,
						model: delegation.model,
						confidence: delegation.confidence,
						source: delegation.source,
						reason: delegation.reason,
						fallback: delegation.fallback,
						ms: Date.now() - started,
					};
					decisions.push(record);
					if (decisions.length > 200) decisions.splice(0, decisions.length - 200);
					log?.({ ...record, kind: "delegate" });
					if (current.logDecisions) {
						ctx.logger.info(`model-route: delegate "${record.task}" → ${delegation.tier} → ${delegation.model}@${delegation.provider} (${delegation.source})`);
					}
					void exec;
					return {
						tier: delegation.tier,
						provider: delegation.provider ?? "",
						model: delegation.model ?? "",
						...(delegation.reasoningEffort ? { reasoning_effort: delegation.reasoningEffort } : {}),
						alternatives: delegation.alternatives.map((candidate) => ({
							tier: candidate.tier,
							provider: candidate.provider,
							model: candidate.model,
						})),
						...(Number.isFinite(delegation.confidence) ? { confidence: delegation.confidence } : {}),
						reason: String(delegation.reason ?? ""),
						fallback: delegation.fallback === true,
						usage_hint: usageHint,
					};
				},
			}));
			delegateTool = { name: wanted, dispose: () => void dispose() };
		}
	} catch (error) {
		ctx.logger.warn(`model-route: delegation routing tool registration skipped (${error?.message ?? error})`);
	}
	};
	ensureDelegationTool();
	ctx.effect(() => () => delegateTool.dispose?.());

	/** Optional observability: recent decisions through the inspect registry. */
	try {
		const inspect = ctx.get("cordisInspect");
		if (inspect?.register !== undefined) {
			const dispose = inspect.register({
				manifest: {
					id: "model-route",
					description: "ModelRoute 路由决策记录：最近 200 次请求的档位判定、缓存来源与上游选择。",
					methods: [{
						name: "listDecisions",
						description: "List recent routing decisions, newest first.",
						inputSchema: { type: "object", properties: { limit: { type: "number" } }, additionalProperties: false },
						outputSchema: { type: "object", properties: { decisions: { type: "array", items: { type: "object" } } }, required: ["decisions"], additionalProperties: false },
					}],
				},
				query: async (method, input) => {
					if (method !== "listDecisions") throw new Error(`unknown method ${method}`);
					const limit = Math.max(1, Math.min(200, Number(input?.limit) || 50));
					return { decisions: decisions.slice(-limit).reverse() };
				},
			});
			ctx.effect(() => dispose);
		}
	} catch (error) {
		ctx.logger.warn(`model-route: inspect provider registration skipped (${error?.message ?? error})`);
	}

	/**
	 * The panel's "test" button needs a real judge call with the values staged in
	 * the form (including a key that is not saved yet). The browser cannot make
	 * that call — the credential lives on the host — so the host exposes one
	 * same-origin route that runs the same `runJudge` a request would.
	 */
	try {
		ctx.inject(["webServer"], (webCtx) => {
			webCtx.effect(() => webCtx.webServer.register({
				kind: "exact",
				path: JUDGE_TEST_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") {
						res.writeHead(405);
						res.end();
						return;
					}
					if (String(req.headers["sec-fetch-site"] ?? "") === "cross-site" || !String(req.headers["content-type"] ?? "").includes("application/json")) {
						respondJson(res, 403, { ok: false, error: "same-origin JSON requests only" });
						return;
					}
					let body;
					try {
						body = await readJsonBody(req);
					} catch (error) {
						respondJson(res, 400, { ok: false, error: String(error?.message ?? error) });
						return;
					}
					const started = Date.now();
					try {
						const key = typeof body.key === "string" && body.key.trim() !== "" ? body.key.trim() : undefined;
						const decision = await runJudge(judgeRouterDraft(body), judgeTestOptions(cfg().route, body.sample), { overrideKey: key });
						respondJson(res, 200, {
							ok: true,
							ms: Date.now() - started,
							tier: decision.tier,
							confidence: decision.confidence ?? null,
							task: decision.task ?? null,
							reason: decision.reason ?? "",
						});
					} catch (error) {
						respondJson(res, 200, {
							ok: false,
							ms: Date.now() - started,
							code: error?.code ?? null,
							error: String(error?.message ?? error),
						});
					}
				},
			}), "model-route: judge test route");
		});
	} catch (error) {
		ctx.logger.warn(`model-route: judge test route registration skipped (${error?.message ?? error})`);
	}

	ctx.on("loader/volatile-update", () => {
		try {
			ensureRegistration();
			ensureDirectory();
			ensureDelegationTool();
		} catch (error) {
			ctx.logger.error("model-route: configuration conflicts with an existing provider route");
			ctx.logger.error(error);
		}
	});
}

//#endregion

export { Config, apply, inject, name, TierGatewayAdapter };
