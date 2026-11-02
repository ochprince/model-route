# @jiangshilong/dsh-client-ui-model-route

**The configuration card for the ModelRoute gateway, rendered inside the Harness Models page.**

English | [中文](README.zh.md)

## Summary

Adds a card to the `model-route` provider row: tier slots, the decision-model endpoint and its
credential, the auxiliary-purpose tiers, and a one-shot judge test.

It is optional — the gateway works with plain YAML — and it never invents configuration: every
field it saves is a field the gateway already reads.

## Quick start

1. Install the gateway first: [`@jiangshilong/dsh-llm-model-route`](../dsh-llm-model-route/README.md).
2. Install this directory as a bundle.
3. Refresh the Harness page and open **Models → ModelRoute**.

## What the card configures

| Area | What it edits | Notes |
| --- | --- | --- |
| Tier slots | `tiers.{opus,sonnet,haiku}.provider` + `.model` | Choices come from the live catalog of configured provider models; the gateway's own route is excluded because routing to itself would recurse |
| Judge endpoint | `enableRouter`, `router.<family>.baseURL`, `router.<family>.model` | Two families, JEV and StartLux, each keeping its own entry, so switching one does not overwrite the other |
| Judge credential | credential `JEV_API_KEY` / `BAMBOO_API_KEY` | Written straight to the credential store and never echoed back |
| Judge proxy | `router.<family>.proxy` | Applies to judge requests only |
| Auxiliary tiers | `auxiliary.compaction`, `auxiliary.session-title` | These purposes skip the judge |
| Test button | — | Runs a real judge call with the values staged in the form, including an unsaved key |

## What it leaves to YAML

Fallback candidates, reasoning effort, judge timeout and context budget, a custom prompt,
credential reference names, the decision cache, and the access log are configuration-file only.
See the gateway's [configuration reference](../dsh-llm-model-route/README.md#configuration).

## Behaviour worth knowing

- Selecting a judge family only retargets the form; saving writes `enableRouter` with the family
  you had selected, so the family you saved is the one that runs.
- A tier with only a provider, or a half-filled fallback candidate, is refused instead of being
  saved partially.
- The card writes only the fields you changed, so a YAML section it does not manage survives
  untouched.
- The test call spends one judge request on a synthetic prompt; it never sends your conversation.

## Limits

- Requires the gateway package; the card renders only on that provider row.
- Model choices come from the harness catalog. A model present in YAML but absent from the
  catalog still displays, but cannot be picked from the dropdown.
- The test button needs the judge endpoint to be reachable.

## Development

```bash
node test/bundle.test.mjs
```

## License

Apache-2.0. See [LICENSE](../../LICENSE).
