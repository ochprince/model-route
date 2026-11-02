# @jiangshilong/dsh-llm-model-route

**Smart model routing for the DeepSeek Harness: one judge call per turn decides haiku, sonnet, or opus.**

English | [中文](README.zh.md)

## Summary

The plugin adds one provider route (default `model-route`) whose model picker advertises a single entry: **`auto`**. With `auto`, a small judge model reads the current user turn, decides whether it looks like `haiku`, `sonnet`, or `opus` work, and routes to whichever upstream model you mapped to that tier. Which provider and model sit behind each tier is entirely up to you; API addresses and the model catalog come from the Harness model management you already use.

The explicit tier aliases still work, they are just not advertised:

| You pick | Behaviour |
| --- | --- |
| `auto` | The judge classifies the turn, then routes to that tier's configured model |
| `opus` / `sonnet` / `haiku` | Uses that tier's model directly; no judge call |

## Where judgments happen

A decision is made at exactly three nodes, and nowhere else:

| Node | When it judges | Why |
| --- | --- | --- |
| **New user turn** | On each new user message | The task may have changed |
| **Rebuilt history** | When the stored message tail no longer sits at its recorded position (compaction, summarization, reprojection) | The frozen decision was made on context that no longer exists |
| **Delegation** | A `route_tier` call | The subagent's context is fresh and unrelated to this conversation's size |

Tool continuations inside a turn do **not** judge: one model serves the whole turn, so the provider's prefix KV cache keeps hitting.

### Why judgment is not finer-grained

A judgment per model call — or per N tool calls — sounds more precise. It is not:

- **Scale is not difficulty.** A turn that has run eight tool calls is *long*, not *harder*; the request the judge classified has not changed.
- **It fires at the most expensive moment.** By then the context is at its largest, so a tier change rebuilds the biggest possible prefix cache.
- **A failed tool call is in-turn evidence.** `turnFreeze` already keeps one model for the turn; whether a failed attempt deserves a stronger tier is decided at the next turn, from the user's own wording.

For a judgment per request instead of per turn, set `cache.turnFreeze: false` — the cost is losing prefix-cache reuse.

The measurements behind this choice are recorded in [design notes](../../docs/design-notes.md).

## Delegation-time routing

HiRoute selects a plan when a Worker task is submitted rather than re-judging every message inside that Worker. The gateway exposes the same idea as a tool:

```text
route_tier(task="refactor the scheduler", context="crates/scheduler only, keep the public API", max_tier="opus")
→ { tier: "opus", provider: "aiapi", model: "glm-5.3", alternatives: [...], usage_hint: "..." }
```

- It judges the **task**, not the size of the current conversation.
- The returned `provider` / `model` can be passed straight to the `subagent` tool when that tool enables `modelSelectionSettings`; otherwise the child inherits the parent model and `usage_hint` says so.
- `max_tier` caps the answer (pass `haiku` for a cheap read-only sweep); identical tasks reuse the previous answer within the TTL.
- A judge failure still returns the fallback tier flagged `fallback: true`, so delegation never fails on routing.

The child only runs on the chosen route once the Host preference allows it:

```yaml
- id: subagent-model-selection-settings
  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"
  config:
    enabled: true
    allowedModels:            # must cover every route a tier can resolve to
      - { provider: aiapi, model: glm-5.3 }
      - { provider: aiapi, model: deepseek-v4.1-flash-1017 }
      - { provider: aiapi, model: glm-5.3-flash }
```

The shipped `preset-cordis` already mounts `subagent` with `modelSelectionSettings` inside a **preset scope**; enabling this Host preference is what turns the route fields on. Do not set `modelSelectionSettings: true` on the Host-level `tool-subagent` row — it requires a scoped preset context and throws at load. Routes outside the list are refused by the tool, so keep it in sync with the tier table.

## Features

- **Per-turn tier choice**: cheap models for simple work, strong models for hard work, without switching by hand.
- **Free tier mapping**: each tier points at any upstream model, with ordered failover candidates.
- **Kind to upstream caches**: the tier is frozen for the whole turn (tool continuations included), and an identical request prefix reuses the previous decision instead of judging again.
- **Guarded model switches**: changing tiers across turns requires a confident verdict or a wide gap, so the prefix cache is not thrown away every turn.
- **The verdict is final**: no implicit escalation floor and no switch gate; upgrades and downgrades both follow the judgment.
- **Graceful degradation**: a failed, timed-out, or "no tier fits" verdict falls back to `fallbackTier`; the user request still completes.
- **Auxiliary calls go direct**: compaction and session titles use a fixed tier and never hit the judge.
- **Two judge families**: JEV (TypeSafe System One) and StartLux (structured decisions), switchable in the panel.

## Quick start

1. **Install**: add this package and its panel plugin `@jiangshilong/dsh-client-ui-model-route` to the profile as bundles (plugin manager `install_bundle` for each directory, or list both in `dsh.profile.bundles`), then restart the Harness. The gateway alone works too, but then the config is YAML-only.
2. **Configure**: open the Models page, find the "ModelRoute" card, fill in the judge and the three tiers, save.
3. **Use it**: point the default model at the gateway, or pick `auto` in the model picker.

```yaml
# profile cordis.patch.yml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: model-route
    model: auto
```

That last block is optional: `auto` shows up in the picker once the gateway is installed, and picking it once makes it the default for later sessions. Sessions that already made a request keep the model they used.

## The configuration panel

Everything user-facing lives on the gateway's Models-page card:

- **Three tiers**: `opus` / `sonnet` / `haiku`, each a provider + model dropdown pair limited to what the catalog actually offers.
- **Judge**: pick the family (JEV / StartLux), then the API address, model id, and API key (stored in the credentials service, never echoed). Each family keeps its own endpoint, so switching back and forth does not overwrite the other.
- **Proxy (optional)**: judge requests only, collapsed at the bottom of the card; when set, only the target host is shown.
- **Auxiliary calls**: pick a tier for compaction and for session titles.
- **Test**: the button beside Save runs one real judge call with the values currently in the form (unsaved edits and a freshly pasted key included) and reports tier, confidence, and latency. Use it right after configuring.
- **Save**: writes into the profile config and hot-reloads; no restart.

Pointing a tier back at the gateway itself is rejected — that would recurse.

## Configuration file (advanced)

Anything the panel does not expose goes straight into the profile's `cordis.patch.yml`:

```yaml
- id: llm-model-route
  name: "@jiangshilong/dsh-llm-model-route"
  config:
    route: model-route
    tiers:
      opus:   { provider: aiapi, model: glm-5.3 }
      sonnet: { provider: aiapi, model: glm-5.3-flash, fallbacks: [{ provider: aiapi, model: deepseek-v4-flash }] }
      haiku:  { provider: aiapi, model: deepseek-v4-flash }
    enableRouter: jev
    router:
      jev:
        baseURL: https://api.typesafe.ai/v1
        model: jev-latest
        timeoutMs: 20000
        # proxy: http://127.0.0.1:7897
      # startlux:
      #   baseURL: https://api.bamboonode.dev/v1
      #   model: startlux-decision-27b-autothink
    fallbackTier: sonnet
    auxiliary:
      compaction: haiku
      session-title: haiku
    cache:
      enabled: true
      turnFreeze: true
    log:
      enabled: false
```

`tiers.<tier>`: `provider` + `model` are required, `reasoningEffort` optionally overrides the upstream reasoning level, and `fallbacks` are tried in order when a candidate fails before its first chunk.

`router.<family>` (only the one selected by `enableRouter` is used):

| Field | Default | Meaning |
| --- | --- | --- |
| `baseURL` / `model` | empty | Judge endpoint and model id; either empty disables judging. `jev` appends `/v1/systemone`, `startlux` appends `/v1/decisions`; a full path is used as given |
| `proxy` | empty | HTTP(S) proxy for judge requests; `http://user:pass@host:port` works, SOCKS does not |
| `provider` | empty | Alternative: call the judge through a registered provider route as a chat model (`baseURL` wins) |
| `temperature` | `0` | Judge sampling temperature (`provider` mode only) |
| `timeoutMs` | `20000` | Judge timeout |
| `maxRequestChars` | `24000` | Judge context budget in characters; older history is dropped |
| `prompt` | empty | Custom judge prompt (`provider` mode only) |
| `thinkMode` / `thinkBudget` / `gate` / `mix` / `noneThreshold` | `auto` / omitted / `0.6` / `0.75` / `0.2` | `startlux` only: when to think and with what budget, the confidence that triggers thinking, the post-thinking weight, and the "no tier fits" threshold |

`fallbackTier` (default `sonnet`): used when the judge is unavailable or fails. With no judge endpoint configured (empty `baseURL` and `model`), `auto` uses it directly, so sessions keep working before the judge is provisioned.

`relayToPrimary` (default `true`): after every candidate of a lower tier failed, whether to keep trying the requested tier's candidates.

`auxiliary` (default `{ compaction: haiku, session-title: haiku }`): the tier each auxiliary purpose uses directly.

`cache`:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Decision cache master switch |
| `turnFreeze` | `true` | Keep one tier for the whole turn |
| `memoTtlMs` / `memoMaxEntries` | 6 hours / `512` | Prefix memo TTL and capacity |
| `replayRewrite` | `true` | Rebase gateway-produced assistant history onto the upstream route, preserving native replay |

### Confidence and the three-tier distribution

A structured decision (JEV / StartLux) already picks one of three tiers. `confidence` is the confidence of the chosen option: JEV uses the server-calibrated confidence; StartLux uses that option's probability share. The gateway now also keeps the full distribution and writes `probabilities` (haiku/sonnet/opus), `topAlternative`, and `margin` (top-two gap) into the decision log and monitor details.

The verdict is final: nothing overrides it with confidence, tier gap, or continuity. Downgrading is as legitimate as upgrading — if the judge says haiku, the turn runs on haiku.

`log`: `enabled` (default `false`), `path` (empty = `$DSH_HOME/logs/model-route.jsonl`), `maxBytes` (default 16 MB, rotates to `.1`), `previewChars` (default `400`, `0` logs no content). See "Logging and troubleshooting".

Also `displayName` (card title) and `logDecisions` (echo decisions to the Harness logger).

## Routing behaviour

- A new user turn → one judgment.
- Tool continuations in the same turn → the frozen tier; an ambient system refresh does not change the turn identity.
- An identical request prefix → the previous decision (memo).
- A compacted/rebuilt history → judged again, because the frozen decision's context no longer exists.
- The judge's verdict **is** the served tier: upgrades and downgrades both stand, with no confidence gate and no alignment to the previous turn.
- Judge unreachable → `fallbackTier` (sonnet by default), inside an explicit ceiling if one was set.
- An explicit `opus` / `sonnet` / `haiku` → bypasses judging entirely.

## Logging and troubleshooting

Set `log.enabled: true` and the gateway appends decisions and results to JSONL (one `route` line per turn, one `result` line per model call, joined by `turn`):

```json
{"kind":"route","turn":"3f9a1c2e","alias":"auto","tier":"sonnet","source":"judge","upstream":{"provider":"aiapi","model":"glm-5.3-flash"},"confidence":0.61,"probabilities":{"haiku":0.12,"sonnet":0.72,"opus":0.16},"topAlternative":"opus","margin":0.56,"task":"…","reason":"…","judgeMs":2608,"preview":"continue"}
```

`source` says where the tier came from: `judge`, `memo` (prefix memo), `frozen` (same turn), `fallback` (judge failed or found no tier), `fixed` (explicit tier or no judge configured), `auxiliary`.

```bash
# is the judge failing all the time?
jq -r 'select(.kind=="route" and .source=="fallback") | .reason' ~/.dsh/logs/model-route.jsonl | tail -5
# which upstream models actually served
jq -r 'select(.kind=="route" and .error==null) | .upstream.model' ~/.dsh/logs/model-route.jsonl | sort | uniq -c | sort -rn
```

Common issues:

- **Judging never kicks in, log says `fallback`**: the judge address, model, or key is wrong — use the panel's Test button first; a `451` is a regional restriction on the judge service.
- **The tier dropdowns are empty**: the upstream provider catalog is not ready yet; wait for it to refresh or configure models under that provider.
- **Want a fixed tier**: pick a concrete upstream model instead of `auto`.
- **Not seeing the cache benefit**: check that `cache.turnFreeze` is still on.

Log write failures never fail a request and are reported once; the file holds metadata and truncated previews only. Recent decisions collapse to one row per `sessionId + turn`; a blank later preview never hides the first non-empty one.

## Limits

- The first request of each turn pays one extra judge call (a little latency); continuations are covered by the freeze and the memo.
- The verdict takes effect directly, with no corrective layer; a wrong judgment is only corrected on the next turn, at the cost of one retry.
- The judge sees user messages and the previous tier only: a follow-up like "put it back" must be resolved from earlier user messages, because the assistant's actual edit is not in the view. That is the deliberate trade for not letting long answers outweigh the current request.
- The context budget is counted in characters, not tokens; when it is tight the oldest user messages are dropped, never the current request.
- Session recognition relies on `options.sessionId`; without it only the prefix memo applies.

## Development

```bash
node test/smoke.mjs        # decision core, no Harness runtime needed
node test/adapter.test.mjs # the real harness LLM seam (needs the app's @deepseek-ai peers)
```

## Version compatibility

`package.json` declares the supported Harness range in `engines.dsh` (currently `>=0.2.0-rc.2 <0.3.0`). Outside that range the Harness reports the mismatch and disables the entry instead of crashing: update the package and reinstall.

## License

Apache-2.0. See [LICENSE](../../LICENSE).
