/**
 * Rebuild data/prices.json from a sub2api checkout.
 *
 * Usage:
 *   SUB2API_DIR=/path/to/sub2api node scripts/build-price-catalog.mjs
 *
 * The generated file contains the whole LiteLLM-style catalog plus the
 * hard-coded fallback prices and ordered family rules from billing_service.go.
 * The runtime reads only this file; it never scans sub2api on each request.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	BUILTIN_FALLBACKS,
	parseFallbackPriceSource,
	parseModelPriceTable,
} from "../lib/model.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.env.SUB2API_DIR || join(homedir(), "Workspace/colaorca/sub2api");
const tablePath = join(dir, "backend/resources/model-pricing/model_prices_and_context_window.json");
const codePath = join(dir, "backend/internal/service/billing_service.go");

const table = parseModelPriceTable(readFileSync(tablePath, "utf8"));
const fallback = parseFallbackPriceSource(readFileSync(codePath, "utf8"));
const catalog = Object.fromEntries([...table].map(([key, value]) => [key, {
	input: value.input,
	output: value.output,
	cacheRead: value.cacheRead,
}]));
const fallbackPrices = Object.fromEntries([...fallback.prices].map(([key, value]) => [key, {
	input: value.input,
	output: value.output,
	cacheRead: value.cacheRead,
}]));
const payload = {
	version: 1,
	generatedAt: new Date().toISOString(),
	sources: {
		catalog: "backend/resources/model-pricing/model_prices_and_context_window.json",
		code: "backend/internal/service/billing_service.go",
	},
	catalog,
	fallbacks: {
		prices: fallbackPrices,
		patterns: fallback.patterns,
	},
	builtins: BUILTIN_FALLBACKS,
};
mkdirSync(join(root, "data"), { recursive: true });
writeFileSync(join(root, "data", "prices.json"), `${JSON.stringify(payload, null, 2)}\n`);
console.log(`wrote data/prices.json: ${Object.keys(catalog).length} catalog entries, ${Object.keys(fallbackPrices).length} fallback prices, ${fallback.patterns.length} family rules`);
