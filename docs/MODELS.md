# Claude model matrix — which model we use for what, why, and when to swap

> Source of truth for every "which Claude do we call here?" decision.
> Claude (the assistant) is responsible for keeping this current and
> proposing upgrades whenever a better model lands. Diego is responsible
> for the commercial decision of *when to pull the upgrade trigger*.
>
> Every task that calls an Anthropic model must reference this file in
> its code comment, not hardcode a rationale.
>
> Last reviewed: **2026-04-17**
> Next review due: **2026-07-17** (quarterly), or immediately after any
> Anthropic release that introduces a new Haiku/Sonnet/Opus tier.

---

## 1. Current assignments

Each cifra agent = one call path = one model choice. The choice is
driven by three dimensions:

- **Reasoning depth** — does this task require multi-step legal
  reasoning, contradiction detection, or argumentative chains?
- **Throughput** — how many calls/day at peak? Latency budget?
- **Cost per 1k operations** — what's the blended margin after VAT?

| Agent / call | Model today | Why this tier | Monthly spend (10 clients) |
|--------------|-------------|---------------|------------------------------|
| **Triage** (classify uploaded doc: invoice / statement / AED letter / contract) | `claude-haiku-4-5-20251001` | Simple classification from first page. No legal reasoning. Must be fast. | ~€2 |
| **Extractor** (parse invoice → invoice_lines rows) | `claude-haiku-4-5-20251001` | Structured extraction with a tight JSON schema. Haiku 4.5 matches Opus on parse tasks at 1/15th the cost. | ~€6 |
| **Drafter** (declaration cover narrative + email to client) | `claude-haiku-4-5-20251001` | Short, constrained template-filling. Not the legal reasoning engine. | ~€3 |
| **Classifier RULES 1-31** (applied on each invoice_line) | *Deterministic TypeScript* | Not a model call. Pure code in `src/lib/classifier.ts`. | €0 |
| **Validator** (second-opinion pass on a prepared declaration) | `claude-opus-4-5-20250929` | This IS the legal reasoning. Jurisprudence, contradiction detection, argumentative counter-proposals. Worth the 15× cost. | ~€15 |
| **Chat** (in-product assistant, not yet shipped) | **Planned: Haiku 4.5 default + "Ask Opus" escalation button** | See §4 below. | ~€5-15 |
| **AED letter upload** (classify the AED's letter, extract deadline + reference) | `claude-haiku-4-5-20251001` | Same pattern as Triage. Fast, cheap. | ~€1 |

**Total blended cost at 10 clients: ~€30/mo.** Budget guard is €75/mo.
Headroom is for burst load (quarterly filings) and chat.

## 2. Pricing reference (Apr 2026)

All prices in EUR per million tokens. Source:
`src/lib/anthropic-wrapper.ts` (keep that table in sync with this one
— tests should fail if they drift).

| Model | Input | Output | Cache read | Cache write |
|-------|-------|--------|------------|-------------|
| Haiku 4.5 (`claude-haiku-4-5-20251001`) | €0.80 | €4.00 | €0.08 | €1.00 |
| Sonnet 4.5 (`claude-sonnet-4-5-20250929`) | €2.50 | €12.00 | €0.25 | €3.00 |
| Opus 4.5 (`claude-opus-4-5-20250929`) | €14.00 | €70.00 | €1.40 | €17.50 |

**Ratios** — what matters for swap decisions:
- Haiku → Sonnet: **3.1× input, 3× output**. Typically worth it for
  mid-complexity reasoning tasks. Not for classification.
- Sonnet → Opus: **5.6× input, 5.8× output**. Worth it only when
  contradiction-detection or jurisprudence-weighted reasoning is the
  core value.
- Haiku → Opus: **~18× end-to-end**. Almost never justified for
  parsing/classification/drafting tasks.

**Prompt caching** — Anthropic's 5-minute cache reduces repeated
input tokens by 90%. Every code-path that calls the API in rapid
succession (validator turns, chat threads) MUST use caching. Without
cache, costs are 10× what's above.

---

## 3. Upgrade policy — when we switch

Claude (the assistant) MUST propose a swap when any of these triggers fire:

1. **New tier ships.** Anthropic releases Haiku 5.x / Sonnet 5.x /
   Opus 5.x → propose swap with a side-by-side: latency, cost delta,
   quality delta on our synthetic corpus (253-test fixture in
   `src/__tests__/classification-rules.test.ts`).

2. **Inference-time cost drops on an existing tier.** Anthropic has
   quietly cut prices several times in 2024-2025. If the cost ratio
   to the tier above us shrinks, re-evaluate.

3. **New smaller/faster tier ships below Haiku.** E.g. a hypothetical
   "Claude Nano" — move Triage + Extractor + AED-upload down, save
   budget for more Opus on Validator.

4. **Accuracy regression observed in production.** If Diego reports
   an extractor or classifier mistake caused by a model limitation
   (not a prompt bug), propose a tier bump for that specific call
   path with the regression data attached.

5. **Competitor releases a better model.** GPT-5 / Gemini 3 / open
   models at similar price with better Lux-VAT accuracy → evaluate
   on the same 253-test corpus. We are not locked to Anthropic. But
   the default is Anthropic unless there's a clear win, because
   multi-provider orchestration adds operational cost.

**Swap mechanics:**
- One PR per swap. Model constant changes in the single file that
  owns that agent (e.g. `src/lib/validator.ts`).
- Update this matrix + `src/lib/anthropic-wrapper.ts` pricing table
  in the same commit.
- Run the full synthetic corpus and record before/after accuracy
  in the commit message.
- If the swap affects cost, run the budget simulator: `npm run
  budget:simulate` (TODO: add this script).

**Never change a model silently.** Every swap is a commit with a
one-line justification in the message.

---

## 4. Chat model choice — the pending decision

cifra will ship an in-product chat assistant (ROADMAP P0 #9). The
model choice is commercially consequential. Options:

### Option A (recommended) — Haiku default + "Ask Opus" button

- Default model: Haiku 4.5 → ~€0.08 per 10-turn conversation
- User-triggered escalation: a "Ask Opus" button that re-runs the
  last question with Opus 4.5, costing ~€1.40 extra
- Includes a small toast: *"This answer used Opus — €0.X"* so the
  user sees the cost lever

Pros: covers 80% of questions at 1/15th the cost. Reserves Opus for
when user explicitly needs it. Transparent about the cost tradeoff.
Pros for the unit-economics: 10 clients × 5 chats/mo × €0.08 = €4/mo
total. Chat does not meaningfully dent the €75 budget.

Cons: quality ceiling on default Haiku might disappoint for edge
cases. Mitigation: clear "Ask Opus" escalation path.

### Option B — Sonnet default (balanced)

- Default: Sonnet 4.5 → ~€0.25 per conversation
- No escalation needed; Sonnet handles most LU-VAT reasoning well

Pros: no two-tier UX. Predictable quality.
Cons: ~3× cost of Option A. At 10 clients × 5 chats/mo = €12.50/mo.
At 100 clients × 10 chats/mo = €250/mo — starts eating margin.

### Option C — Opus default (premium only)

- Default: Opus 4.5 → ~€1.40 per conversation
- Implied pricing: chat is a €99+/mo "Pro tier" feature

Pros: best answers. Differentiates Pro plan.
Cons: economically nonviable on a €99/mo plan. Needs Enterprise
pricing or tight per-user quotas.

### Decision matrix by plan tier (proposal)

| Plan | Base price | Chat default | Escalation | Monthly chat quota |
|------|-----------|--------------|------------|---------------------|
| Basic | €99/mo | Haiku | — | unlimited |
| Pro | €299/mo | Sonnet | "Ask Opus" button, 20/mo included | unlimited Sonnet; 20 Opus |
| Enterprise | €599/mo | Opus | — | unlimited Opus |

This is the plan cifra should commit to when the chat ships. Pricing
tiers in `docs/BUSINESS_PLAN.md` get updated to match.

---

## 5. Recent changes

| Date | Change | Rationale |
|------|--------|-----------|
| 2026-04-17 | Matrix document created. Established quarterly review cadence. Chat-model decision deferred to ship-time. | Diego instruction: automatic model upgrades + transparent cost tracking. |
| (Historical) | Extractor moved from Opus 4 → Haiku 4.5 | Haiku 4.5 release; accuracy parity on parse tasks at 1/15 cost. |
| (Historical) | Validator kept on Opus 4.5 | Reasoning depth justifies cost. |

*Append newest-first when making swaps.*

---

## 6. References

- Anthropic pricing page: https://www.anthropic.com/pricing
- Our pricing table in code: `src/lib/anthropic-wrapper.ts`
- Budget guard: `src/lib/budget-guard.ts` (hard cap at €75/mo; configurable via `BUDGET_MONTHLY_EUR`)
- Synthetic test corpus: `src/__tests__/fixtures/synthetic-corpus.ts` (253 cases covering every classifier rule)
- Metrics dashboard: `/metrics` (live cost per agent + daily sparkline)
