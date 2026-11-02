/**
 * Optional live check against the sub2api checkout that supplies the catalog
 * and code fallbacks. Skips when that project is not present.
 * Run: node test/sub2api.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	parseFallbackPriceSource,
	parseModelPriceTable,
	resolveModelPrice,
} from "../lib/model.js";

const dir = process.env.SUB2API_DIR || join(homedir(), "Workspace/colaorca/sub2api");
const tablePath = join(dir, "backend/resources/model-pricing/model_prices_and_context_window.json");
const codePath = join(dir, "backend/internal/service/billing_service.go");
if (!existsSync(tablePath) || !existsSync(codePath)) {
	console.log(`sub2api live check skipped: ${dir}`);
	process.exit(0);
}

const table = parseModelPriceTable(readFileSync(tablePath, "utf8"));
const fallback = parseFallbackPriceSource(readFileSync(codePath, "utf8"));
assert.ok(table.size > 0, "price catalog should contain entries");
assert.ok(fallback.prices.size > 0, "code fallback prices should be parsed");
assert.ok(fallback.patterns.length > 0, "code family rules should be parsed");

const expected = {
	"glm-5.3": { input: 1, output: 3.2, cacheRead: 0.2, matchedKey: "glm-5" },
	"deepseek-v4.1-flash-1017": { input: 0.14, output: 0.28, cacheRead: 0.0028, matchedKey: "deepseek-v4-flash" },
	"glm-5.3-flash": { input: 1, output: 3.2, cacheRead: 0.2, matchedKey: "glm-5" },
};
for (const [model, want] of Object.entries(expected)) {
	const got = resolveModelPrice(model, table, fallback);
	assert.equal(got.source, "code", model);
	assert.equal(got.matchedKey, want.matchedKey, model);
	assert.equal(got.input, want.input, model);
	assert.equal(got.output, want.output, model);
	assert.equal(got.cacheRead, want.cacheRead, model);
	console.log(`${model} → ${got.source}:${got.matchedKey} $${got.input}/$${got.output}/$${got.cacheRead}`);
}
console.log(`sub2api live check: ${table.size} catalog entries, ${fallback.prices.size} code prices, ${fallback.patterns.length} family rules`);
