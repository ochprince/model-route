/**
 * The judge client: one small, direct provider call that classifies the
 * current user turn into a tier (haiku / sonnet / opus).
 *
 * Modeled on HiRoute's decision extensions: the host owns the criteria and
 * thresholds, and the judge sees a trimmed structured view of the conversation
 * (`latest_user` + visible history + `history_partial`). Two judge families are
 * supported, both of them structured decision APIs rather than chat
 * completions:
 *
 * - `jev` speaks TypeSafe's System One API (`POST /v1/systemone`), where the
 *   tier is one `choice` question and the answer carries the chosen option and
 *   its probability.
 * - `startlux` speaks the StartLux/Bamboo structured decisions API
 *   (`POST /v1/decisions`), which adds think-mode controls and an explicit
 *   "none of the above" probability.
 *
 * Alternatively a registered provider route can serve the judge as a chat model
 * with a strict-JSON contract (`callJudgeRoute`); that path reuses the provider
 * adapter instead of speaking HTTP here.
 *
 * This module is dependency-free: protocol errors are plain Errors with a
 * `code`; the adapter maps them onto the harness failure taxonomy.
 *
 * A hand-declared endpoint may optionally be reached through an HTTP proxy
 * (`http://` or `https://`, with optional basic auth). HTTPS targets use a
 * CONNECT tunnel, so no third-party proxy agent is required.
 */
import http from "node:http";
import https from "node:https";
import tls from "node:tls";
import { contentText, isTurnStartUser, lastTurnUserIndex, squeeze } from "./util.js";

/** Judge families that speak a structured decision API. */
export const DECISION_KINDS = ["jev", "startlux"];

/**
 * Tier criteria shared by every judge protocol. The provider-route chat judge
 * embeds them in the system prompt; the structured endpoints carry them as the
 * question's `criteria` map, so one wording serves both.
 */
export const TIER_CRITERIA = {
	haiku: "The work is fully determined by the request: its extent is stated, a mistake is visible where it is made, and the result can be checked mechanically.",
	sonnet: "The work is bounded but not mechanical: its extent follows from the request and context, several steps and local choices are needed, yet the contract it must keep is already known and a wrong result usually surfaces during the work.",
	opus: "The extent or the root cause must be discovered while working, or the work must reconcile many interacting constraints, or a mistake can escape the immediate edit and surface elsewhere later.",
};

export class JudgeError extends Error {
	constructor(message, code = "JUDGE_FAILED", status = undefined) {
		super(message);
		this.name = "JudgeError";
		this.code = code;
		this.status = status;
	}
}

/** The default judge system prompt. Abstract principles, no enumerated scenarios. */
export function defaultJudgePrompt() {
	return [
		"You are the routing judge of a model gateway. You choose which execution tier should serve ONE request: the latest user message.",
		"",
		"## Input",
		"- `latest_user`: the request to serve.",
		"- `prior_user_turns`: earlier user messages, oldest first. Context for understanding what the request refers to.",
		"- `previous_tier`: the tier that served the previous turn, or null.",
		"",
		"## The decision",
		"Estimate the capability required to COMPLETE the request, then choose the cheapest tier whose capability meets it.",
		"",
		"Resolve the request before judging it. A request can be short in wording while referring to work, objects, or intentions established earlier; judge the work it actually asks for, not the length of its wording. Equally, a short request that stands on its own is judged on its own.",
		"",
		"## What raises the required capability",
		"- The extent of the work cannot be known in advance and must be discovered while doing it.",
		"- Consequences escape the immediate edit: shared contracts, persistent state, concurrency, security, data integrity.",
		"- Correctness cannot be established cheaply or locally, so a wrong result surfaces late.",
		"- The work requires reconciling many interacting facts rather than transforming one of them.",
		"- The context shows that this request, or the work it continues, has already exceeded a lower capability.",
		"",
		"## What lowers it",
		"- The outcome is fully determined by the request and the context.",
		"- A mistake stays contained and is visible where it is made.",
		"- The result can be checked mechanically.",
		"- The work transforms, retrieves, or repeats something already established.",
		"- The request states its own preference for speed or economy.",
		"",
		"## Judging discipline",
		"- Difficulty belongs to the request, not to the conversation. The amount of prior context, the number of earlier turns, and the tier used before do not make this request harder or easier. A long session does not enlarge a small request; a brief session does not shrink a large one.",
		"- Both directions are expected answers. Choosing a cheaper tier than the previous turn is correct whenever the required capability is lower, and preserving a tier for continuity is wrong. Choosing a more capable tier is correct whenever the required capability is higher.",
		"- `previous_tier` is a record, not a prior. Consult it only for the escalation rule below.",
		"- Escalate above `previous_tier` when the context shows an earlier attempt at this request did not achieve its goal — whether the user states it or the conversation otherwise makes it evident. Continuing earlier work is not by itself such evidence.",
		"- Do not round uncertain cases upward. If the request genuinely cannot be classified, lower your confidence instead of choosing a stronger tier.",
		"- Confidence is your confidence in the chosen tier after this reasoning; probabilities describe the distribution over the three tiers.",
		"",
		"## Tiers",
		`- "haiku": ${TIER_CRITERIA.haiku}`,
		`- "sonnet": ${TIER_CRITERIA.sonnet}`,
		`- "opus": ${TIER_CRITERIA.opus}`,
		"",
		"Answer with STRICT JSON only — no markdown, no prose:",
		'{"task":"<one line: the work this request asks for, in the language of the request>","tier":"haiku|sonnet|opus","confidence":<0..1>,"probabilities":{"haiku":<0..1|null>,"sonnet":<0..1|null>,"opus":<0..1|null>},"reason":"<one short sentence>"}',
	].join("\n");
}

/**
 * Build the judge view of one request.
 *
 * Only what the decision needs is sent: the request itself, the earlier user
 * messages that give it meaning, and the tier that served the previous turn.
 * Assistant output, tool traffic, the agent's system prompt, and any derived
 * flags are deliberately absent — each of them competes with the request for
 * the judge's attention without informing how hard the request is.
 *
 * @returns {{system: string, user: string, state: object}}
 */
export function buildJudgePayload(options, { maxRequestChars = 12000, messagePreviewChars = 600, priorUserTurns = 3 } = {}, routing = {}) {
	const messages = Array.isArray(options.messages) ? options.messages : [];
	const cut = lastTurnUserIndex(messages);
	const latestUser = cut >= 0 ? contentText(messages[cut]?.content).slice(0, 6000) : "";

	// Earlier user turns only: they resolve what the request refers to. Walk
	// backwards so the nearest turns survive the budget.
	const prior = [];
	let dropped = 0;
	for (let index = cut - 1; index >= 0; index -= 1) {
		if (!isTurnStartUser(messages[index])) continue;
		const text = squeeze(contentText(messages[index]?.content)).slice(0, messagePreviewChars);
		if (text === "") continue;
		if (prior.length < priorUserTurns) prior.unshift(text);
		else dropped += 1;
	}

	// Trim the oldest prior turns until the body fits; the request itself is
	// never trimmed below its own cap, because it is the unit of judgment.
	let body = { latest_user: latestUser, prior_user_turns: prior, previous_tier: routing?.previousTier ?? null };
	let serialized = JSON.stringify(body);
	let trimmed = 0;
	while (serialized.length > maxRequestChars && body.prior_user_turns.length > 0) {
		body = { ...body, prior_user_turns: body.prior_user_turns.slice(1) };
		trimmed += 1;
		serialized = JSON.stringify(body);
	}
	body.history_partial = dropped > 0 || trimmed > 0;

	return {
		system: defaultJudgePrompt(),
		user: JSON.stringify(body),
		state: body,
	};
}

/**
 * Parse the judge reply. Tolerates fenced JSON and prose around a balanced
 * object; rejects anything that does not name a valid tier.
 */
export function parseJudgeReply(text) {
	const raw = String(text ?? "");
	const start = raw.indexOf("{");
	if (start < 0) throw new JudgeError(`judge reply has no JSON object: ${raw.slice(0, 120)}`, "INVALID_JUDGE_REPLY");
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < raw.length; index += 1) {
		const char = raw[index];
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{") depth += 1;
		else if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				const candidate = raw.slice(start, index + 1);
				let parsed;
				try {
					parsed = JSON.parse(candidate);
				} catch {
					break;
				}
				return normalizeDecision(parsed);
			}
		}
	}
	throw new JudgeError(`judge reply has no parsable JSON object: ${raw.slice(0, 120)}`, "INVALID_JUDGE_REPLY");
}

const TIER_KEYS = ["haiku", "sonnet", "opus"];

/** Normalize the optional per-tier probabilities a judge may report. */
function normalizeProbabilities(raw) {
	if (!raw || typeof raw !== "object") return null;
	const out = {};
	let any = false;
	for (const tier of TIER_KEYS) {
		const number = Number(raw[tier]);
		if (!Number.isFinite(number)) continue;
		out[tier] = Math.min(1, Math.max(0, number));
		any = true;
	}
	return any ? out : null;
}

/**
 * Top-two separation: how much the leading tier beats the runner-up. This is a
 * better "is the choice decisive?" signal than absolute confidence alone.
 */
function distributionOf(probabilities, choice) {
	if (!probabilities) return { probabilities: null, topAlternative: null, margin: null };
	const sorted = Object.entries(probabilities).sort((left, right) => right[1] - left[1]);
	const top = sorted[0];
	const second = sorted[1];
	const chosen = choice ? probabilities[choice] : undefined;
	// Only a choice that actually leads its distribution gets a positive
	// margin. An inconsistent reply must not be treated as decisive.
	const leads = Number.isFinite(chosen) && Math.abs(chosen - top[1]) < 1e-9;
	const alternative = leads ? second : top;
	const margin = second === undefined ? null : leads
		? Math.round(Math.max(0, chosen - second[1]) * 1e6) / 1e6
		: 0;
	return {
		probabilities,
		topAlternative: alternative?.[0] ?? null,
		margin,
	};
}

function normalizeDecision(parsed) {
	if (!parsed || typeof parsed !== "object") throw new JudgeError("judge reply is not an object", "INVALID_JUDGE_REPLY");
	const tier = String(parsed.tier ?? "").toLowerCase();
	if (!["haiku", "sonnet", "opus"].includes(tier)) {
		throw new JudgeError(`judge named unknown tier "${String(parsed.tier).slice(0, 40)}"`, "INVALID_JUDGE_REPLY");
	}
	let confidence = Number(parsed.confidence);
	if (!Number.isFinite(confidence)) confidence = 0.5;
	confidence = Math.min(1, Math.max(0, confidence));
	const distribution = distributionOf(normalizeProbabilities(parsed.probabilities), tier);
	return {
		tier,
		confidence,
		...distribution,
		task: typeof parsed.task === "string" ? parsed.task.slice(0, 300) : "",
		reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 300) : "",
	};
}

/**
 * The decision endpoint for one family and hand-declared baseURL.
 *
 * JEV always talks System One, so a bare base gains `/v1/systemone`; a full
 * endpoint already ending in `/systemone` is used as given. StartLux adds
 * `/v1/decisions`, but also accepts its `/systemone` compatibility alias.
 */
export function endpointUrl(kind, baseURL) {
	const base = String(baseURL ?? "").trim().replace(/\/+$/, "");
	if (!base) throw new JudgeError("judge baseURL is empty", "INVALID_CONFIG");
	if (kind === "jev") {
		if (/\/systemone$/i.test(base)) return base;
		const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
		return `${root}/systemone`;
	}
	if (kind === "startlux") {
		if (/\/(decisions|systemone)$/i.test(base)) return base;
		const root = /\/v\d+$/.test(base) ? base : `${base}/v1`;
		return `${root}/decisions`;
	}
	throw new JudgeError(`judge kind "${kind}" is not supported; expected one of ${DECISION_KINDS.join(", ")}`, "INVALID_CONFIG");
}

/** The one `choice` question both structured families ask, named `tier`. */
function tierQuestion() {
	return {
		tier: {
			type: "choice",
			instructions: "根据这段对话，应由哪个档位的模型处理？选择成本最低但仍能完成的档位。",
			criteria: { ...TIER_CRITERIA },
		},
	};
}

/**
 * The TypeSafe System One request body: model, state, and the tier question.
 * System One has no think-mode or none-probability controls; adding them would
 * describe an API JEV does not implement.
 */
export function buildSystemOneBody({ model, state }) {
	return { model, state, questions: tierQuestion() };
}

/**
 * The StartLux structured decision request: the same tier question plus its
 * think-mode and none-check extensions.
 * @param decision - think_mode / think_budget / gate / mix overrides.
 */
export function buildDecisionBody({ model, state, thinkMode = "auto", thinkBudget, gate, mix, noneCheck = true }) {
	const body = {
		...(model ? { model } : {}),
		state,
		questions: tierQuestion(),
		think_mode: thinkMode,
	};
	if (noneCheck) body.none_check = true;
	if (Number.isInteger(thinkBudget) && thinkBudget >= 1 && thinkBudget <= 4096) body.think_budget = thinkBudget;
	if (Number.isFinite(gate)) body.gate = gate;
	if (Number.isFinite(mix)) body.mix = mix;
	return body;
}

/**
 * Read the structured decision answer. A null choice or a `none_probability`
 * at or above the configured threshold means "no listed option fits": both are
 * surfaced as JUDGE_UNCERTAIN so the caller can fall back deliberately.
 *
 * `none_probability` is a StartLux extension; JEV replies carry only the choice,
 * its probabilities, and confidence, so the none check simply does not apply.
 */
export function readDecisionReply(json, { kind = "startlux", noneThreshold = 0.2 } = {}) {
	const answer = json?.answers?.tier;
	if (!answer || typeof answer !== "object") throw new JudgeError(`${kind} reply has no answers.tier`, "INVALID_JUDGE_REPLY");
	const rawChoice = answer.choice;
	const choice = rawChoice === null || rawChoice === undefined ? "" : String(rawChoice).toLowerCase();
	// `null`/absent means "not reported": Number(null) is 0, which would read as a
	// real zero confidence or a zero none probability.
	const optional = (value) => {
		if (value === null || value === undefined || value === "") return undefined;
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	};
	const none = optional(answer.none_probability);
	const probabilities = answer.probabilities && typeof answer.probabilities === "object" ? answer.probabilities : {};
	const noneText = none === undefined ? "n/a" : none.toFixed(3);
	if (!choice) throw new JudgeError(`${kind} chose no listed tier${none === undefined ? "" : ` (none_probability ${noneText})`}`, "JUDGE_UNCERTAIN");
	if (!["haiku", "sonnet", "opus"].includes(choice)) throw new JudgeError(`${kind} named unknown tier "${choice}"`, "INVALID_JUDGE_REPLY");
	if (none !== undefined && none >= noneThreshold) {
		throw new JudgeError(`${kind} none_probability ${noneText} ≥ ${noneThreshold}; no listed tier fits`, "JUDGE_UNCERTAIN");
	}
	// Each family owns its confidence scale. TypeSafe returns a calibrated
	// `confidence` derived from the option distribution, so JEV uses it. StartLux's
	// separate `confidence` is a self-report; the probability share of the chosen
	// option is the number that means the same thing, so StartLux uses the share.
	// Both fall back to the other number, then to 0.5, so a sparse reply still routes.
	const share = optional(probabilities[choice]);
	const reported = optional(answer.confidence);
	const preferred = kind === "jev" ? reported : share;
	const fallback = kind === "jev" ? share : reported;
	let confidence = preferred ?? fallback;
	if (!Number.isFinite(confidence)) confidence = 0.5;
	const shareText = share === undefined ? "p ?" : `p ${share.toFixed(3)}`;
	const distribution = distributionOf(normalizeProbabilities(probabilities), choice);
	return {
		tier: choice,
		confidence: Math.min(1, Math.max(0, confidence)),
		...distribution,
		reason: `${kind}: ${choice} ${confidence.toFixed(3)} (${shareText}${none === undefined ? "" : `, none ${noneText}`})`,
		noneProbability: none ?? null,
	};
}

function errorForStatus(status, snippet) {
	if (status === 401 || status === 403) return new JudgeError(`judge endpoint rejected the credential (HTTP ${status}): ${snippet}`, "INVALID_CREDENTIAL", status);
	if (status === 429) return new JudgeError(`judge endpoint rate limited (HTTP 429): ${snippet}`, "RATE_LIMIT", status);
	if (status === 400 || status === 422) return new JudgeError(`judge endpoint rejected the request shape (HTTP ${status}): ${snippet}`, "INVALID_CONFIG", status);
	return new JudgeError(`judge endpoint failed (HTTP ${status}): ${snippet}`, "JUDGE_FAILED", status);
}

function parseReply(text) {
	try {
		return JSON.parse(text);
	} catch {
		throw new JudgeError(`judge reply is not JSON: ${text.slice(0, 200)}`, "INVALID_JUDGE_REPLY");
	}
}

/**
 * Normalize one proxy setting. Blank means "direct"; a bare `host:port` is
 * treated as HTTP. SOCKS proxies are refused explicitly instead of failing
 * later with an opaque socket error.
 */
function proxyUrlOf(raw) {
	const text = String(raw ?? "").trim();
	if (!text) return undefined;
	const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
	let url;
	try {
		url = new URL(withScheme);
	} catch {
		throw new JudgeError(`invalid judge proxy URL "${text}"`, "INVALID_CONFIG");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new JudgeError(`judge proxy "${text}" must use http:// or https:// (SOCKS is not supported)`, "INVALID_CONFIG");
	}
	return url;
}

/**
 * POST through an HTTP(S) proxy without a proxy-agent dependency.
 * Plain HTTP targets use absolute-form requests; HTTPS targets open a CONNECT
 * tunnel and run TLS to the target over the returned socket.
 */
function postJsonViaProxy({ url, headers, body, timeoutMs, signal, proxy }) {
	const proxyUrl = proxyUrlOf(proxy);
	const target = new URL(url);
	if (target.protocol !== "http:" && target.protocol !== "https:") {
		throw new JudgeError(`judge endpoint "${url}" must use http:// or https://`, "INVALID_CONFIG");
	}
	const timeout = Number.isFinite(timeoutMs) ? timeoutMs : 20000;
	const targetPort = target.port || (target.protocol === "https:" ? "443" : "80");
	const payload = Buffer.from(body);

	return new Promise((resolve, reject) => {
		let settled = false;
		let request = null;
		let socket = null;
		let timer = null;

		const cleanup = () => {
			if (timer !== null) clearTimeout(timer);
			if (signal) signal.removeEventListener("abort", onAbort);
			if (socket !== null) {
				try { socket.destroy(); } catch { /* already closed */ }
			}
			if (request !== null) {
				try { request.destroy(); } catch { /* already closed */ }
			}
		};
		const fail = (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		};
		const done = (value) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};
		const onAbort = () => fail(new JudgeError("judge call aborted", "ABORTED"));

		timer = setTimeout(() => fail(new JudgeError(`judge timed out after ${timeout}ms`, "JUDGE_TIMEOUT")), Math.max(1000, timeout));
		if (signal) {
			if (signal.aborted) {
				onAbort();
				return;
			}
			signal.addEventListener("abort", onAbort, { once: true });
		}

		const proxyAuth = proxyUrl.username || proxyUrl.password
			? { "proxy-authorization": `Basic ${Buffer.from(`${decodeURIComponent(proxyUrl.username)}:${decodeURIComponent(proxyUrl.password)}`).toString("base64")}` }
			: {};
		const requestHeaders = { ...headers, host: target.host, "content-length": String(payload.length) };
		const onResponse = (response) => {
			const chunks = [];
			response.on("data", (chunk) => chunks.push(chunk));
			response.on("end", () => done({ status: response.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
			response.on("error", (error) => fail(new JudgeError(`judge reply read failed: ${error?.message ?? String(error)}`, "JUDGE_UNREACHABLE")));
		};

		if (target.protocol === "http:") {
			const requestFn = proxyUrl.protocol === "https:" ? https.request : http.request;
			request = requestFn({
				host: proxyUrl.hostname,
				port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
				method: "POST",
				path: target.href,
				headers: { ...requestHeaders, ...proxyAuth },
			}, onResponse);
			request.on("error", (error) => fail(new JudgeError(`judge endpoint unreachable via proxy: ${error?.message ?? String(error)}`, "JUDGE_UNREACHABLE")));
			request.end(payload);
			return;
		}

		// HTTPS target: CONNECT tunnel through the proxy, then TLS to the target.
		const connectFn = proxyUrl.protocol === "https:" ? https.request : http.request;
		const connectReq = connectFn({
			host: proxyUrl.hostname,
			port: proxyUrl.port || (proxyUrl.protocol === "https:" ? 443 : 80),
			method: "CONNECT",
			path: `${target.hostname}:${targetPort}`,
			headers: { host: `${target.hostname}:${targetPort}`, ...proxyAuth },
		});
		request = connectReq;
		connectReq.on("connect", (response, connectedSocket) => {
			if (response.statusCode !== 200) {
				connectedSocket.destroy();
				fail(new JudgeError(`judge proxy CONNECT failed (HTTP ${response.statusCode})`, "JUDGE_UNREACHABLE"));
				return;
			}
			socket = connectedSocket;
			const tlsSocket = tls.connect({ socket: connectedSocket, servername: target.hostname });
			socket = tlsSocket;
			tlsSocket.on("error", (error) => fail(new JudgeError(`judge proxy TLS tunnel failed: ${error?.message ?? String(error)}`, "JUDGE_UNREACHABLE")));
			// `createConnection` on the request options is ignored by Node; a
			// per-request Agent that hands back the tunneled TLS socket is the
			// supported way to keep the request on this CONNECT tunnel.
			const agent = new https.Agent({ keepAlive: false });
			agent.createConnection = () => tlsSocket;
			request = https.request({
				host: target.hostname,
				port: targetPort,
				method: "POST",
				path: `${target.pathname}${target.search}`,
				headers: requestHeaders,
				agent,
			}, onResponse);
			request.on("error", (error) => fail(new JudgeError(`judge endpoint unreachable via proxy: ${error?.message ?? String(error)}`, "JUDGE_UNREACHABLE")));
			request.end(payload);
		});
		connectReq.on("error", (error) => fail(new JudgeError(`judge proxy unreachable: ${error?.message ?? String(error)}`, "JUDGE_UNREACHABLE")));
		connectReq.end();
	});
}

/**
 * POST one JSON body and return the parsed reply. Shared by every judge
 * endpoint: timeout arithmetic, caller-abort composition, and status mapping
 * live here once.
 */
async function postJson({ url, headers, body, timeoutMs, signal, fetchImpl, proxy }) {
	const payload = JSON.stringify(body);
	if (proxyUrlOf(proxy) !== undefined) {
		const reply = await postJsonViaProxy({ url, headers, body: payload, timeoutMs, signal, proxy });
		if (reply.status < 200 || reply.status >= 300) throw errorForStatus(reply.status, reply.text.slice(0, 200));
		return parseReply(reply.text);
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new JudgeError(`judge timed out after ${timeoutMs}ms`, "JUDGE_TIMEOUT")), Math.max(1000, timeoutMs));
	const onAbort = () => controller.abort(signal?.reason);
	if (signal) {
		if (signal.aborted) throw new JudgeError("caller aborted before the judge call", "ABORTED");
		signal.addEventListener("abort", onAbort, { once: true });
	}
	let response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers,
			body: payload,
			signal: controller.signal,
		});
	} catch (error) {
		if (signal?.aborted) throw new JudgeError("judge call aborted", "ABORTED");
		if (error?.code === "JUDGE_TIMEOUT") throw error;
		throw new JudgeError(`judge endpoint unreachable: ${error?.message ?? String(error)}`, "JUDGE_UNREACHABLE");
	} finally {
		clearTimeout(timer);
		if (signal) signal.removeEventListener("abort", onAbort);
	}
	const text = await response.text().catch(() => "");
	if (!response.ok) throw errorForStatus(response.status, text.slice(0, 200));
	return parseReply(text);
}

/**
 * Call one structured decision endpoint. `kind` picks the wire shape (System
 * One for `jev`, decisions for `startlux`); `decision` carries the StartLux
 * think-mode overrides. `attribution` carries the harness attribution headers;
 * `signal` combines the caller's abort with the timeout.
 */
export async function callDecisionEndpoint({ kind = "jev", baseURL, apiKey, model, timeoutMs, signal, state, decision = {}, attribution = {}, fetchImpl = fetch, proxy = "" }) {
	const url = endpointUrl(kind, baseURL);
	const headers = { "content-type": "application/json", ...attribution };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;
	const body = kind === "jev"
		? buildSystemOneBody({ model, state })
		: buildDecisionBody({ model, state, ...decision });
	const json = await postJson({ url, headers, body, timeoutMs, signal, fetchImpl, proxy });
	return readDecisionReply(json, { kind, noneThreshold: decision.noneThreshold });
}

/**
 * Call a judge served through a registered provider route (nested llm stream).
 * `streamLlm` is `({provider, model, system, user, temperature, signal}) => text`.
 */
export async function callJudgeRoute({ streamLlm, provider, model, temperature, system, user, signal }) {
	if (!provider || !model) throw new JudgeError("judge route needs provider and model", "INVALID_CONFIG");
	return streamLlm({ provider, model, temperature, system, user, signal });
}