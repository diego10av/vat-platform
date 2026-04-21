# Claude model matrix — which model we use for what, why, and when to swap

> Source of truth for every "which Claude do we call here?" decision.
> Claude (the assistant) is responsible for keeping this current and
> proposing upgrades whenever a better model lands. Diego is responsible
> for the commercial decision of *when to pull the upgrade trigger*.
>
> Every task that calls an Anthropic model must reference this file in
> its code comment, not hardcode a rationale.
>
> Last reviewed: **2026-04-22**
> Next review due: **2026-07-22** (quarterly), or immediately after any
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
| **Classifier RULES 1-35** (Tier 1-3, applied on each invoice_line) | *Deterministic TypeScript* | Not a model call. Pure code in `src/lib/classifier.ts` + rules.ts. | €0 |
| **Tier 4 AI proposer** (fires when Tiers 1-3 return NO_MATCH) | **`claude-opus-4-7`** (2026-04-22, was Haiku) | NO_MATCH cases are by definition the hardest — Opus 4.7 gives a defensible proposal at the hard end of the tail (novel cross-border structures, contested post-Versãofast intermediation, substance-over-form carry). ~5-15% of lines, always flagged, always reviewer-confirmed. | ~€4-6 |
| **Validator** (second-opinion pass on a prepared declaration) | **`claude-opus-4-7`** (2026-04-22, was Opus 4.5) | THE legal reasoning engine. Jurisprudence, contradiction detection, argumentative counter-proposals. The pitch-killer agent — 4.7 is strictly better at multi-hop LU-VAT reasoning. | ~€15 |
| **Chat default** | `claude-haiku-4-5-20251001` | See §4 below. | ~€3-5 |
| **Chat "Ask Opus" escalation** | **`claude-opus-4-7`** (2026-04-22, was Opus 4.5) | Explicit user-initiated escalation for complex VAT questions. | ~€2-10 |
| **VAT registration letter extractor** (once per entity creation) | **`claude-opus-4-7`** (2026-04-22, was Haiku) | Diego's feedback 2026-04-21: Haiku was "almost completely wrong" on his first real letter. High-stakes (creates the entire VAT profile), low-volume (1 call per entity lifetime). Opus 4.7's OCR + reasoning justifies the cost for this specific path. Routine invoice extraction stays on Haiku. | <€1 |
| **Attachment L2 analyze — Opus path** (contracts, engagement letters) | **`claude-opus-4-7`** (2026-04-22, was Opus 4.5) | Deep legal read of attached contracts; cites CJEU + LTVA. Haiku fallback covers `ai_mode='classifier_only'` / budget exhaustion. | ~€2 |
| **AED letter upload** (classify the AED's letter, extract deadline + reference) | `claude-haiku-4-5-20251001` | Same pattern as Triage. Fast, cheap. | ~€1 |

**Total blended cost at 10 clients: ~€35-45/mo** (up ~€5-15 after the
2026-04-22 Opus 4.7 upgrades). Budget guard is €75/mo — headroom
remains for burst load + chat.

## 2. Pricing reference (Apr 2026)

All prices in EUR per million tokens. Source:
`src/lib/anthropic-wrapper.ts` (keep that table in sync with this one
— tests should fail if they drift).

| Model | Input | Output | Cache read | Cache write |
|-------|-------|--------|------------|-------------|
| Haiku 4.5 (`claude-haiku-4-5-20251001`) | €0.80 | €4.00 | €0.08 | €1.00 |
| Sonnet 4.5 (`claude-sonnet-4-5-20250929`) | €2.50 | €12.00 | €0.25 | €3.00 |
| Opus 4.5 (`claude-opus-4-5-20250929`) | €14.00 | €70.00 | €1.40 | €17.50 |
| Opus 4.7 (`claude-opus-4-7`) | €14.00† | €70.00† | €1.40† | €17.50† |

† 4.7 pricing pegged to 4.5 as placeholder pending Anthropic's
published rate (verify on next legal-watch / tax-alert refresh). If
4.7 lands higher, cost estimates understate by a bounded %, but the
budget cap stays correct because tokens are logged authoritatively
in `api_calls` and the `BUDGET_MONTHLY_EUR` guard trips on the
true running total.

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

## 4. Chat model choice — **DECIDED 2026-04-17**

cifra will ship an in-product chat assistant (ROADMAP P0 #9).
Decision: **Haiku 4.5 default + "Ask Opus" escalation button**,
with a **hard per-user monthly AI spend cap of €2/user/month** on
the default plan.

### Why Haiku default + Ask Opus

- Haiku 4.5 resolves ~80% of realistic questions (deadlines, rule
  explanations, invoice summaries, "is this supplier EU or foreign?")
  at ~€0.08 per 10-turn conversation — or ~€0.03 with prompt caching.
- The 20% of questions that genuinely need Opus (contradictory
  jurisprudence, complex exemption arguments) are served explicitly
  by the user pressing **Ask Opus**. UI shows: *"This answer used
  Opus — €0.30"* toast, so the cost lever is visible.
- Unit economics: 10 clients × 5 chats/mo × mostly Haiku ≈ €4/mo
  total. Chat does not meaningfully dent the €75/mo budget guard.

### Per-user hard cap — the "crazy user" hedge

Diego's instruction: *"incluso el unlimited no lo haria unlimited
a ver si hay un loco que se lia a poner mensajes y rompe la banca."*

Without a cap, a single user pasting 500k-token documents into the
chat and triggering Opus on every turn can cost €50+/day. So:

- **Default cap: €2 / user / calendar month**, tracked by `user_id`
  in the `api_calls` table. Not by firm — per user. A firm with
  5 users has a firm-wide envelope of €10/mo.
- **When reached**: chat input shows a banner *"Has alcanzado tu
  quota mensual de IA (€2). Vuelve el 1 de [mes siguiente] o pide
  a tu admin que te suba el tope."* Chat becomes read-only.
- **Firm admin can raise a user's cap** from the /settings page
  (costs an extra €X/mo per user, billed pro-rata). Levels:
  €2 (default) → €5 → €10 → €20.
- **Anthropic cost is tracked per call** via the existing
  `anthropic-wrapper.ts` pricing table. Caching reduces the
  effective cost so a user has real headroom even at €2.

### Tier pricing — soft-unlimited with hard caps

| Plan | Base price | Default AI cap (€/user/mo) | Notes |
|------|-----------|------------------------------|-------|
| Starter | €99 | €1 | Haiku only; "Ask Opus" disabled. |
| Firm | €299 | €2 | Haiku default + Ask Opus on-demand. **Current default.** |
| Enterprise | custom | €10 (soft) | Admin can raise per-user up to €30. Includes SSO, SLA, white-label. |

*Soft-unlimited* means the marketing says "unlimited Q&A with the
AI assistant" but each user has a hard monthly ceiling denominated
in LLM spend, not message count. This is how Slack / Notion / every
serious SaaS operates under the hood.

### Implementation requirements (for ROADMAP P0 #9)

When building the chat:
1. Extend `api_calls` table with `user_id` column (currently tracked
   by firm/declaration — need per-user granularity).
2. New function `requireUserBudget(userId)` in `src/lib/budget-guard.ts`
   that SUMs `api_calls.cost_eur` for the user in the current month
   and returns `{ ok, spent, cap, remaining }`.
3. UI: header of chat drawer shows *"€0.47 / €2.00 used this month"*
   — transparent and slightly deterrent.
4. UI: "Ask Opus" button shows estimated cost before firing
   (*"This will cost ~€0.30"*) and deducts from the user's monthly
   cap upfront.
5. Firm-admin route to raise per-user caps lives in `/settings/users`.
6. When cap is reached → 429 response with clear message, not a
   silent failure.

---

## 5. Recent changes

| Date | Change | Rationale |
|------|--------|-----------|
| 2026-04-22 | **Five call paths upgraded to Opus 4.7**: Validator (was 4.5), Chat Ask-Opus (was 4.5), Attachment L2 Opus path (was 4.5), VAT registration letter extractor (was Haiku), Tier 4 AI proposer (was Haiku). | Diego's instruction 2026-04-21: *"si el resultado es mucho mejor, me daría igual [coste], lo que quiero tener es un producto que sea técnicamente casi de 10."* VAT letter extractor was specifically flagged as "almost completely wrong" on his first try; Tier 4 proposer was shipped 2026-04-22 and upgrading to Opus on the same stint avoids a short-lived Haiku bake-in. Net cost impact: ~€5-15/mo at 10 clients — headroom against the €75/mo cap. |
| 2026-04-22 | Tier 4 AI proposer added to the matrix (new agent, shipped `a3cf850` 2026-04-21). | Closes the loop on the 5-15% of lines that Tiers 1-3 return NO_MATCH on. source='ai_proposer' in audit trail keeps defensibility airtight. |
| 2026-04-17 | §4 chat-model DECIDED: Haiku default + Ask-Opus button, €2/user/mo hard cap, soft-unlimited tier pricing with per-plan caps (Starter €1 / Firm €2 / Enterprise €10). | Diego confirmed direction. The "crazy user" hedge is explicit — no true unlimited anywhere. |
| 2026-04-17 | Matrix document created. Established quarterly review cadence. | Diego instruction: automatic model upgrades + transparent cost tracking. |
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
