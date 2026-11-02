<div align="center">

# ModelRoute

**Route every turn to the cheapest model that can still do the job.**

A smart model-routing plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) —
one small judge call per turn decides `haiku` / `sonnet` / `opus`, so routine work stops
paying premium-model prices.

[Quick start](#quick-start-2-minutes) · [How it saves money](#how-it-saves-money) · [How it works](#how-it-works) · [Configuration](#configuration) · [中文](README.zh.md)

</div>

---

## The problem

A long coding session is 90% routine work: renaming a variable, reading a file, fixing a typo,
running the tests again. If every one of those turns runs on your strongest model, you pay
premium prices for work a much cheaper model finishes correctly.

Manually switching models does not survive contact with a real session — you forget, or the
task changes mid-turn, or you just leave it on the expensive one "to be safe".

## The idea

ModelRoute registers **one** provider route with a single model: `auto`.

```
your request ─► judge model (~1s, cheap) ─► haiku | sonnet | opus ─► the model you mapped to that tier
```

- The **judge** reads the request and the earlier user messages, and picks the cheapest tier
  that can complete it.
- The **tiers are yours**: map `opus`, `sonnet`, `haiku` to any provider/model you already have.
- **One model serves the whole turn.** Tool continuations reuse the decision, so the provider's
  prefix cache keeps hitting — routing does not throw away your cache.

## How it saves money

Prices below are an illustrative set (input / output / cached-input per 1M tokens). The same
137k-token turn, mostly cache reads, one tier apart:

| Tier | Price (in / out / cached) | Cost of the turn | vs. opus |
| --- | --- | --- | --- |
| `opus` | $1.40 / $4.40 / $0.26 | **$0.0489** | baseline |
| `haiku` | $0.15 / $0.50 / $0.03 | **$0.0055** | ~9× cheaper |
| `sonnet` | $0.15 / $0.60 / $0.006 | **$0.0026** | ~19× cheaper |

Your own tier mapping and prices decide the multiplier — run the built-in
[cost monitor](#see-what-you-save) and it tells you your real number.

The point is not that every turn gets cheaper. It is that **the expensive tier is reserved for
the turns that need it**, instead of being the default for all of them.

## Quick start (2 minutes)

**1. Clone**

```bash
git clone https://github.com/ochprince/model-route.git
cd model-route
```

**2. Install the three bundles** — ask the Harness agent:

> Install these bundles for me:
> `/absolute/path/to/model-route/packages/dsh-llm-model-route`
> `/absolute/path/to/model-route/packages/dsh-client-ui-model-route`
> `/absolute/path/to/model-route/packages/dsh-model-route-monitor`

(or install them from the Harness plugin manager one by one — the first is required, the other
two are optional: a settings card and a cost dashboard.)

**3. Add this to your profile patch** (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) and
replace the two endpoints with your own models:

```yaml
- id: llm-model-route
  name: "@jiangshilong/dsh-llm-model-route"
  config:
    route: model-route
    tiers:
      opus:   { provider: my-provider, model: strong-model }
      sonnet: { provider: my-provider, model: mid-model }
      haiku:  { provider: my-provider, model: cheap-model }
    enableRouter: jev
    router:
      jev:
        baseURL: https://api.typesafe.ai/v1   # the decision model endpoint
        model: jev-latest
```

`provider` is any provider route you already configured in the Harness Models page — ModelRoute
does not ask you to re-declare endpoints, keys, or protocols.

**4. Point the default model at it**

```yaml
- id: agent-default-model
  name: "@deepseek-ai/dsh-agent-default-model"
  config:
    provider: model-route
    model: auto
```

Restart the Harness once. New sessions start on `auto`; the model picker shows
**ModelRoute**.

> No judge key yet? Leave `router.jev.baseURL` empty: every turn then runs on
> `fallbackTier` (default `sonnet`) — still cheaper than always-opus, and you can switch the
> judge on later without touching anything else.

## See what you save

The monitor bundle adds a right-sidebar panel: live spend by tier, savings versus an all-opus
baseline, plus the last 24 routing decisions with the judge's tier, confidence, and reason.
Toggle **auto prices** to resolve unit prices from a public catalog instead of entering them
by hand.

Every decision is also written to `$DSH_HOME/logs/model-route.jsonl` if you enable `log.enabled`.

## How it works

Three packages, independent and separately installable:

| Package | What it is |
| --- | --- |
| [`dsh-llm-model-route`](packages/dsh-llm-model-route/README.md) | The gateway. Registers the `model-route` provider, judges each turn, dispatches to the chosen tier. |
| [`dsh-client-ui-model-route`](packages/dsh-client-ui-model-route/README.md) | The settings card on the provider row: tiers, judge endpoint, API key, live test button. |
| [`dsh-model-route-monitor`](packages/dsh-model-route-monitor/README.md) | The cost dashboard: spend by tier, savings, decision trail. |

### When a decision is made

A judgment runs at exactly three points, and nowhere else:

| Node | Why |
| --- | --- |
| **A new user turn** | The task may have changed. |
| **A rebuilt history** | Compaction replaced the context the frozen decision was based on. |
| **Delegation** (`route_tier`) | A subagent task deserves its own tier, independent of this conversation's size. |

Tool continuations inside a turn do **not** re-judge. That is deliberate: one model per turn
keeps the provider's prefix cache warm, and in-turn signals such as tool-call counts or context
growth describe how much work has happened — not how hard it is.

### What the judge sees

Only what the decision needs — the request, the earlier user messages, and the previous tier:

```json
{
  "latest_user": "rename the config field and update the call sites",
  "prior_user_turns": ["fix the failing test in parser", "…"],
  "previous_tier": "sonnet"
}
```

Not the assistant's answers, not tool input/output, not the agent's system prompt, and no
derived flags. Each of those competes with the request for the judge's attention without
telling it how hard the request is.

The prompt states principles (what raises required capability, what lowers it, how to weigh
history) rather than enumerating scenarios. Read it — with the measurements behind these
choices — in [`docs/judge-prompt.md`](docs/judge-prompt.md) and
[`docs/design-notes.md`](docs/design-notes.md).

### The verdict is final

No hidden escalation floor, no confidence gate, no "stay on the previous tier" rule. If the
judge says `haiku`, the turn runs on `haiku`. A wrong call costs one retry; a cheap model
re-reading the whole context still costs less than a strong model reading its cache.

If the judge is unreachable, the turn runs on `fallbackTier` (default `sonnet`) — never a
failed request.

## Configuration

```yaml
- id: llm-model-route
  name: "@jiangshilong/dsh-llm-model-route"
  config:
    route: model-route                # provider route name shown in the picker
    tiers:                            # required: your three upstreams
      opus:   { provider: aiapi, model: glm-5.3, fallbacks: [{ provider: aiapi, model: backup }] }
      sonnet: { provider: aiapi, model: glm-5.3-flash }
      haiku:  { provider: aiapi, model: deepseek-v4-flash }
    enableRouter: jev                 # jev | startlux
    router:
      jev: { baseURL: https://…, model: jev-latest, proxy: "" }
    fallbackTier: sonnet              # used when the judge fails
    auxiliary:                        # compaction / session titles skip the judge
      compaction: haiku
      session-title: haiku
    cache:
      turnFreeze: true                # one model per turn (prefix-cache friendly)
      memoMaxEntries: 512
    delegate:
      toolName: route_tier            # the delegation-time judgment tool
      maxCandidates: 3
    log:
      enabled: false
```

| Field | Default | Meaning |
| --- | --- | --- |
| `tiers` | — | `opus` / `sonnet` / `haiku` → provider + model, optional ordered `fallbacks` |
| `enableRouter` | `jev` | Which judge family is active |
| `router.<family>` | — | Judge endpoint (`baseURL`, `model`, optional `proxy`) or a registered `provider` route |
| `fallbackTier` | `sonnet` | Tier used when the judge fails |
| `auxiliary` | compaction/session-title → `haiku` | Purpose calls that skip judging |
| `cache.turnFreeze` | `true` | One model per turn; `false` judges every request |
| `delegate.toolName` | `route_tier` | Name of the delegation-time tool |

Full reference: [`packages/dsh-llm-model-route/README.md`](packages/dsh-llm-model-route/README.md).

## Delegation routing

Before delegating to a subagent, the agent can ask for the right tier for **that task**:

```
route_tier(task="refactor the scheduler", context="crates/scheduler only, keep the public API")
→ { tier: "opus", provider: "aiapi", model: "glm-5.3", alternatives: [...], usage_hint: "…" }
```

The returned `provider`/`model` can be passed straight to the `subagent` tool when it exposes
model selection. The judge reads the *task*, not the size of the current conversation.

## Requirements

- DeepSeek Harness (desktop or web) with a profile you can edit
- Any provider route for your three tiers — the Harness Models page handles endpoints, keys,
  protocols and model discovery
- A decision model endpoint that speaks TypeSafe System One (`jev`) or StartLux structured
  decisions (`startlux`); any OpenAI/Anthropic-compatible chat route can also serve as judge
  via `router.<family>.provider`

## FAQ

**Does this break prompt caching?**
No. One model serves the whole turn; the decision is frozen for tool continuations, and a
rebuild (compaction) re-judges because the cache was already gone.

**Will it downgrade work that needs the strong model?**
The judge reads the request, not the conversation's length, and it is told that "continuing
earlier work" is not evidence of difficulty. If it gets one wrong, you see it in the decision
trail and the retry costs one turn — cheaper than running everything on `opus`.

**Does it work without the panel or the monitor?**
Yes. The gateway package alone is enough; configuration is plain YAML.

**Do I have to use JEV?**
No. The judge is pluggable: JEV, StartLux, or any chat model through a registered provider route.

## Development

```bash
npm run test          # gateway: decision core (no Harness runtime needed)
npm run test:panel    # settings panel
npm run test:monitor  # cost model
```

`packages/dsh-llm-model-route/test/adapter.test.mjs` additionally exercises the real Harness LLM
seam and needs the `@deepseek-ai/*` peer packages that ship inside the Harness app.

## License

Apache-2.0. See [LICENSE](LICENSE).
