/**
 * Shared, dependency-free utilities for the model-route gateway plugin.
 *
 * Everything here is plain JavaScript on purpose: the decision, hashing, and
 * trimming logic is exercised by an offline smoke test without loading the
 * dsh host, and the adapter imports it as pure functions.
 */
import { createHash } from "node:crypto";

/** Tier aliases in cost/quality order (ascending). */
export const TIERS = ["haiku", "sonnet", "opus"];

export function isTier(value) {
	return typeof value === "string" && TIERS.includes(value);
}

/** Rank of a tier; unknown values rank as "sonnet". */
export function tierRank(tier) {
	const index = TIERS.indexOf(tier);
	return index < 0 ? 1 : index;
}

/** The cheaper of two tiers ("min" under the haiku < sonnet < opus order). */
export function cheaperTier(left, right) {
	return tierRank(left) <= tierRank(right) ? left : right;
}

/** The more capable of two tiers ("max" under the same order). */
export function expensiveTier(left, right) {
	return tierRank(left) >= tierRank(right) ? left : right;
}

/**
 * Deterministic JSON serialization with sorted object keys.
 * Arrays keep their order; non-JSON values degrade to stable type tags so a
 * hash never depends on insertion order or identity.
 */
export function stableStringify(value) {
	return stringifyValue(value, new Set());
}

function stringifyValue(value, seen) {
	if (value === null) return "null";
	const type = typeof value;
	if (type === "string") return JSON.stringify(value);
	if (type === "number") return Number.isFinite(value) ? String(value) : `"number:${String(value)}"`;
	if (type === "boolean") return value ? "true" : "false";
	if (type === "bigint") return `"bigint:${String(value)}"`;
	if (type === "undefined") return `"undefined"`;
	if (type !== "object") return `"${type}"`;
	if (seen.has(value)) return '"circular"';
	seen.add(value);
	try {
		if (Array.isArray(value)) return `[${value.map((item) => stringifyValue(item, seen)).join(",")}]`;
		const keys = Object.keys(value).sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyValue(value[key], seen)}`).join(",")}}`;
	} finally {
		seen.delete(value);
	}
}

/** SHA-256 hex digest of a stable serialization. */
export function stableHash(value) {
	return createHash("sha256").update(stableStringify(value)).digest("hex");
}

/** A bounded FIFO/LRU-ish map used for session freeze entries and the memo. */
export class BoundedMap {
	constructor(maxEntries) {
		this.maxEntries = Math.max(1, maxEntries | 0 || 1);
		this.map = new Map();
	}
	get(key) {
		const hit = this.map.get(key);
		if (hit === undefined) return undefined;
		// refresh recency
		this.map.delete(key);
		this.map.set(key, hit);
		return hit;
	}
	set(key, value) {
		if (this.map.has(key)) this.map.delete(key);
		this.map.set(key, value);
		while (this.map.size > this.maxEntries) {
			const oldest = this.map.keys().next().value;
			this.map.delete(oldest);
		}
	}
	delete(key) {
		this.map.delete(key);
	}
	get size() {
		return this.map.size;
	}
}

/**
 * Read one possibly-reactive config value. The cordis config projection hands
 * live refs for declared fields; defensive fallbacks keep the adapter usable
 * when a field is absent entirely.
 */
export function ref(value, fallback) {
	if (value !== null && value !== undefined && typeof value.get === "function") {
		const resolved = value.get();
		return resolved === undefined || resolved === null ? fallback : resolved;
	}
	return value === undefined || value === null ? fallback : value;
}

/** Extract plain text from one harness content block array. */
export function contentText(content) {
	if (content === null || content === undefined) return "";
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		// Tool blocks come first: a tool-result often carries `text`, and the
		// plain-text shortcut would flatten it into bare content — hiding both
		// the tool marker the judge reads and the failure marker routing greps.
		if (block.type === "tool-call") {
			parts.push(`[tool-call ${block.name ?? "?"} ${argumentsText(block)}]`);
			continue;
		}
		if (block.type === "tool-result" || block.type === "tool") {
			const body = typeof block.content === "string"
				? block.content
				: contentText(block.content ?? (typeof block.text === "string" ? block.text : ""));
			parts.push(`[tool-result${block.isError === true ? " error" : ""} ${body}]`);
			continue;
		}
		if (typeof block.text === "string" && block.text.length > 0) {
			parts.push(block.text);
			continue;
		}
		if (block.type === "image" || block.type === "file") {
			parts.push(`[${block.type}]`);
		}
	}
	return parts.join(" ");
}

/** One tool call's arguments: assembled blocks carry `arguments`, streamed deltas carry `argumentsDelta`. */
function argumentsText(block) {
	const raw = block.arguments ?? block.argumentsDelta ?? "";
	const text = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
	return squeeze(text).slice(0, 400);
}

/** The index of the last user-role message, or -1. */
export function lastUserIndex(messages) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") return index;
	}
	return -1;
}

/**
 * Whether one message starts a new user turn. Tool results normally ride the
 * "tool" role; some gateways deliver them as user-role content — those carry
 * only tool-result blocks and no visible user text, so they do not start a
 * turn and must not break same-turn recognition.
 */
const AMBIENT_USER_TEXT = /^(?:Time sampled while preparing|Browser time zone for this request:|Elapsed since the preceding|This is an automatically generated checkpoint|Current runtime context\.|<system-reminder>|The available skill catalog changed\.)/;

function isAmbientUserText(text) {
	return AMBIENT_USER_TEXT.test(String(text ?? "").trim());
}

export function isTurnStartUser(message) {
	if (message?.role !== "user") return false;
	// The runtime appends ambient user-role messages to durable history: clock
	// readings (`time-context`), model-switch notices (`model-selection`), and
	// compaction checkpoints. They are not prompts, so they must not move the
	// turn boundary — otherwise every injection re-judges the same turn.
	const source = message.source;
	if (source !== null && typeof source === "object" && source.kind !== "user") return false;
	const content = message.content;
	if (typeof content === "string") return content.trim().length > 0 && !isAmbientUserText(content);
	if (!Array.isArray(content)) return true;
	let hasText = false;
	for (const block of content) {
		if (typeof block === "string") {
			if (block.trim().length > 0 && !isAmbientUserText(block)) return true;
			continue;
		}
		if (!block || typeof block !== "object") continue;
		if (block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0) {
			// A context injection can arrive without its `source.kind` marker
			// after a projection; its known prefix still identifies it.
			if (!isAmbientUserText(block.text)) return true;
			continue;
		}
		if (block.type === "image" || block.type === "file") hasText = true;
	}
	return hasText;
}

/** The index of the last turn-start user message, or -1. */
export function lastTurnUserIndex(messages) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (isTurnStartUser(messages[index])) return index;
	}
	return -1;
}

/** Collapse whitespace to keep judge payloads compact. */
export function squeeze(text) {
	return String(text ?? "").replace(/\s+/g, " ").trim();
}
