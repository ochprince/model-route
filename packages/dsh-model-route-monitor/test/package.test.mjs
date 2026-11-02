/**
 * Static bundle checks: manifest, patch, locale metadata, icon, and the two
 * halves' public registration markers. Run: node test/package.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const pkg = JSON.parse(read("package.json"));
const patch = read("cordis.patch.yml");
const zh = JSON.parse(read("locale/zh.json"));
const en = JSON.parse(read("locale/en.json"));
const client = read("lib/client.js");
const host = read("lib/index.js");
const icon = read("icon.svg");

assert.equal(pkg.name, "@jiangshilong/dsh-model-route-monitor");
assert.equal(pkg.type, "module");
assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
assert.equal(pkg.dsh.client.platform, "web");
assert.ok(pkg.exports["./client"]);
assert.ok(pkg.exports["./icon"]);
assert.ok(pkg.files.includes("lib/model.js"));
assert.ok(pkg.files.includes("icon.svg"));
assert.ok(pkg.files.includes("locale/*.json"));
assert.match(patch, /id: model-route-monitor/);
assert.match(patch, /@jiangshilong\/dsh-model-route-monitor/);
assert.ok(zh.meta.title && zh.meta.description);
assert.ok(en.meta.title && en.meta.description);
assert.ok(icon.startsWith("<svg") && icon.includes("</svg>"));
assert.ok(statSync(new URL("icon.svg", root)).size < 256 * 1024);
assert.match(client, /window\.__ModuleLoader__\.load/);
assert.match(client, /id: "@jiangshilong\/dsh-model-route-monitor"/);
assert.match(client, /kind: KIND/);
assert.match(client, /sidebar\.right\.pane\.tab/);
assert.match(client, /conversation\.session\.header\.utilities/);
assert.doesNotMatch(client, /@deepseek-ai\/dsh-client-ui-primitives/);
assert.match(host, /llm\/stream/);
assert.match(host, /model-route-monitor\/snapshot/);
assert.match(host, /model-route-monitor\/open-config/);
assert.ok(existsSync(new URL("data/prices.json", root)));
assert.ok(statSync(new URL("data/prices.json", root)).size > 0);
assert.match(client, /openConfig/);
assert.match(client, /autoPrices/);

console.log("monitor package: static checks passed");