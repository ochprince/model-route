# Design notes

Measurements that shaped the design, kept out of the README so the product documentation does
not read like a changelog. Each note records when and where it was observed, because these are
observations from one installation — not controlled experiments.

## In-turn re-judgment signals (2026-10, one installation)

**Question.** Should the gateway re-judge a turn when in-turn conditions change — a failed tool
result, a number of accumulated tool calls, or a large context growth?

**How it was measured.** The gateway logged every decision with its source and boundary. Over
194 decisions collected from daily use of one installation (about two weeks), the three
in-turn signals fired 14 times.

**Result.**

| Signal | Triggers | Tier changes | Judge latency spent |
| --- | --- | --- | --- |
| tool-result count (every 8) | 10 | 0 | 13.2 s |
| failed tool result | 3 | 0 | ~3 s |
| context growth (60k chars) | 1 | 0 | ~1 s |
| rebuilt history | 0 | 0 | — |

Every trigger produced the same tier the turn had already been served on. The single tier
change that occurred inside those turns came from the cross-turn escalation rule that existed
at the time, not from the in-turn signal.

**Why.** The signals describe scale, not difficulty: after eight tool calls the request the
judge classified has not changed, only the amount of work behind it. They also fire at the most
expensive moment — the context is at its largest, so a tier change there rebuilds the largest
possible prefix.

**Decision.** Remove the three in-turn signals. Keep a rebuilt history as the only in-turn
re-judgment, because a frozen decision made on context that compaction replaced cannot be
inherited.

**Caveats.** One installation, one provider set, one judge model, and a small sample (14
triggers). A different workload could plausibly produce different numbers; the mechanism
argument above is the part that generalizes, the counts are illustrative.

## Judge payload composition (2026-10, one installation)

**Question.** What should the judge see?

**Observation.** The first version sent the recent transcript with a per-message character cap
and no role weighting. In a realistic long turn (six prior turns plus three tool round-trips),
the payload was roughly 2% user text and 72% assistant text, because assistant replies are much
longer than user messages and both were capped at the same length.

**Decision.** Send only what the decision needs: the request, the earlier user messages, and
the previous tier. Assistant output, tool traffic, the agent system prompt, and derived flags
were removed.

**Caveat.** The percentages describe that one payload shape; they are not a property of all
sessions.

## Deterministic escalation floor (removed 2026-10)

**What it was.** A regex over recent user turns detected rejection wording ("still wrong",
"not fixed", ...) and forced at least one tier above the previous turn, overriding the judge.

**Why it was removed.** The same regex result was already supplied to the judge as evidence and
in the prompt as an instruction, so the floor re-applied a judgement the model had just made —
and overrode it when the model disagreed. It also matched wording whose target was not the
model's answer at all: a message containing "the refresh button has no effect" was read as a
rejection of the previous attempt and escalated the turn to the strongest tier.

**Decision.** Delete the floor. The judge's verdict is final; a failed judge call falls back to
`fallbackTier`. Negative-judgement capability lives in the prompt, where it can use the
conversation rather than a substring.
