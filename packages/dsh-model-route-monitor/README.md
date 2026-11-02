---
description: "Companion right-sidebar dashboard for ModelRoute: live per-tier usage across all sessions and cost economics versus routing everything through Opus."
kind: "package-reference"
---

# @jiangshilong/dsh-model-route-monitor

English | [中文](README.zh.md)

A companion to [`@jiangshilong/dsh-llm-model-route`](../dsh-llm-model-route/README.md). It registers a **ModelRoute cost** tab in the Harness right sidebar and reports, live:

- requests, sessions, input/output/cache-read tokens for `opus`, `sonnet`, and `haiku`, with the actual serving model on each tier card (`+N` when failover used more than one);
- actual cost from per-tier input, output, and cache-read unit prices;
- the all-Opus baseline for the same tokens, savings, and savings rate;
- session ranking, recent judge/route decisions, savings rate, and 1h/24h/7d/all windows;
- an inline editor for the three unit prices, re-pricing history immediately.

## Open it

After installation, refresh the Harness page once so the browser half registers the sidebar tab and header button.

Install this directory as a bundle. Open the monitor with the chart icon in the Session header, or from the right-sidebar guide: **ModelRoute cost monitor**. The tab can be docked, split, floated, or shown fullscreen like any other sidebar page.

## Layout and one-click config

The panel is now a single-column, scrollable view: a fixed summary header above the overview, tier rows, sessions, and recent decisions. Tier cards use the full row width with larger type and a thick share meter; sessions show the first four and recent decision rows the first six, with **Show all** to expand, so the panel does not become a wall of tiny text. Typography follows a report layout: serif display headings and metric values, monospaced uppercase micro-labels, roomier card padding, and wide spacing between blocks.

Prices default to **Auto**: the monitor reads its bundled `data/prices.json`, resolves the current tier models, and applies the new prices on the next two-second refresh when a gateway slot changes. No profile edit is needed. **Edit prices** sits in the **Tier usage** header and opens an inline panel with the **Auto / Manual** switch as its first row.

The hero card shows one number only — the savings amount — and the three figures that matter beside it (requests, sessions, savings rate) sit in the strip directly below, so nothing is stated twice. Recent decisions are grouped by judge/route, not one row per model call; a row's clock follows the turn's newest completed call, so a running turn keeps advancing at the top, and a breathing "In flight" dot appears beside the time range while a gateway call is streaming; the right edge shows confidence (labelled with the tier the judge originally chose when a deterministic escalation raised it), and clicking a row expands the user-message preview, judge model, reason, all three tier probabilities, the top-two margin, escalated-from tier/reason, aggregate cost, and tokens.

The panel opens in the mode currently in force. In **Auto** it only explains where the prices come from; choose **Manual** to reveal the three tier rows, **Save prices** becomes available immediately, and saving writes the tier prices plus `autoPrices: false` in one write, so the values take effect and history is re-priced at once. Manual prices are kept when you switch back to Auto, so the same values return the moment you pick **Manual** again; a manual set that was never filled in is seeded from the auto-resolved prices instead of opening on zeros. The file icon in the page title bar still opens the profile's `cordis.patch.yml` after ensuring a complete `config.prices` template on the `model-route-monitor` row, for direct YAML edits.

## Prices

Prices are **USD per million tokens**; `0` means unset, not free. With the default `autoPrices: true`, automatic prices win; saving prices in the panel switches to Manual (equivalent to `autoPrices: false`), and you can also pick **Manual** or preset the flag in the config. Only records whose actual tier price and Opus baseline price are both set participate in savings, so unpriced calls are never counted as zero cost. Cache writes are billed at the input rate because the requested price model has no separate cache-write field. A failover model is still priced at its tier's rate; if models within one tier differ sharply, set a blended tier price.

Auto prices are not written to the profile. Only when `autoPrices` is disabled (by saving a price, picking **Manual**, or the config) does the monitor use `prices`; those manual prices can be preset in `cordis.patch.yml`.

## Bundled price catalog

Prices are captured in the plugin's [`data/prices.json`](data/prices.json); the runtime never scans sub2api:

- `catalog`: 195 LiteLLM entries converted from USD per token to USD per million;
- `fallbacks.prices`: 52 code fallback prices;
- `fallbacks.patterns`: 30 ordered family rules from `billing_service.go`;
- metadata records the generation time and source paths.

Auto pricing resolves each tier in this order:

1. exact match in the bundled catalog;
2. exact match in the bundled code fallbacks;
3. the bundled ordered family rules, e.g. `glm-5.3` → `glm-5`, `glm-5.3-flash` → `glm-5`;
4. DeepSeek V4 version/build normalization, e.g. `deepseek-v4.1-flash-1017` → `deepseek-v4-flash`;
5. manual prices when the catalog has no match.

Changing a gateway slot model updates the effective price on the next two-second refresh; no `cordis.patch.yml` edit is required.

Regenerate the file when sub2api adds models:

```bash
node scripts/build-price-catalog.mjs
```

The script reads `~/Workspace/colaorca/sub2api` by default (or `SUB2API_DIR`) only when regenerating; normal runtime reads `data/prices.json`.

Current auto matches: `glm-5.3` → code fallback `glm-5` ($1.00 / $3.20 / $0.20), `deepseek-v4.1-flash-1017` → code fallback `deepseek-v4-flash` ($0.14 / $0.28 / $0.0028), `glm-5.3-flash` → code fallback `glm-5` ($1.00 / $3.20 / $0.20).

## Standalone preview URL

The plugin also serves a standalone preview that renders the same `MonitorBody` with the current `lib/client.js` and live snapshot data, without the Harness login page:

```text
http://127.0.0.1:<current Harness port>/model-route-monitor/preview?width=400&height=1000
```

Adjust `width` and `height` to check narrow sidebars, scrolling, and clipping. The preview uses Preact from a CDN as a React-compatible development runtime; the real sidebar still uses Harness React.

If the preview looks correct but the real sidebar is stale, the page has not loaded the new client bundle; fully refresh or restart Harness.

## Data and attribution

The Host half observes the `llm/stream` waterfall and records only calls that enter the gateway route. When the gateway forwards an `auto` call to an upstream `provider/model`, the nested call is used to attribute the outer call to the tier whose live mapping names that route. The mapping is read through the config editor from the model-route row, so changing the gateway mapping needs no monitor change. Ambiguous mappings are shown as **Unrecognized** instead of guessed.

Each call records only metadata and token counters: session id, tier, upstream provider/model, purpose, duration, and finish reason. Message content and prompts are never stored. Records append to `$DSH_HOME/logs/model-route-monitor.jsonl` (5,000 records, 8 MB rotation); set `persist: false` to keep them in memory only.

## Config

| Field | Default | Meaning |
| --- | --- | --- |
| `prices.*.{input,output,cacheRead}` | `0` | Unit prices per million tokens |
| `currency` | `USD` | Display currency |
| `autoPrices` | `true` | Resolve current tier models from the bundled catalog; disable to use `prices` |
| `gatewayPackage` | `@jiangshilong/dsh-llm-model-route` | Package whose row supplies the tier mapping |
| `gatewayRoute` | `model-route` | Fallback route when the row cannot be read |
| `persist` | `true` | Append records to JSONL |
| `maxRecords` | `5000` | Retained records (100–50000) |

## Limits

- Only this Host process's gateway calls are counted; direct upstream calls and other Host processes are not.
- The browser polls a same-origin snapshot every two seconds; on failure it keeps the last data and resumes automatically.
- If the gateway config or `configEditor` is unavailable, `auto` calls may appear as **Unrecognized** rather than being attributed incorrectly.
- Only the three standard tiers have prices; custom tier aliases are counted as **Unrecognized**.
- Recent decision details prefer the gateway JSONL route records (including the user-message preview), then fall back to the inspect provider. With neither available, the panel reports that no decision records are available.

## Development

```bash
node test/monitor.test.mjs
node test/sub2api.test.mjs
node --check lib/index.js
node --check lib/client.js
```

`lib/model.js` is the dependency-free catalog/matching and aggregation model; `lib/index.js` reads the bundled catalog and serves the Host collector/snapshot route; `lib/client.js` is the React sidebar page, guide entry, and header button; `data/prices.json` is the captured price catalog.