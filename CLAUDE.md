# cifra — Claude Code onboarding

**Read this file first in every new session.** It's the single source
of truth for what cifra is, how we work, and the non-negotiable rules.
Everything else (`docs/*`, `src/*`) is detail that only matters when
the task requires it.

> **⚠️ Mandatory session-start audit — before doing anything else:**
>
> 1. `git log --oneline -15` — what landed since I was last here?
> 2. Diff the most recent commits against §4 (Current state) + §7
>    (Known quirks) + §8 (YAGNI). Anything contradicted or missing?
> 3. If yes → **fix this file first, in a commit of its own, then
>    start the task Diego asked for.** Don't ask permission, don't
>    announce it. Just do it.
> 4. Same rule applies mid-conversation: if Diego says something that
>    contradicts a living doc, update it silently in the same stint.
>
> **Exception — the "deeply-held position" checkpoint**: if Diego's
> new direction would REVERSE something we deliberated (a PROTOCOLS
> hard rule, a shipped feature's architectural decision, a section
> of CLAUDE.md §2/§8) — **one-line confirmation before overwriting**:
>
> > *"Espera — esto revertiría [X] que acordamos en [stint Y].
> > ¿Confirmas el pivote, o te he entendido mal?"*
>
> If yes → update as the new baseline. If Diego was thinking out
> loud → the position stands, no edit. For everything incremental
> or first-time expressed, skip the checkpoint and update silently.
>
> Diego should never have to say "update the docs." If he does,
> Claude broke protocol. See PROTOCOLS §13 for the full custody rules.

---

## 1 · What cifra is

Luxembourg tax & compliance workspace. Today it handles VAT preparation
(LTVA, eCDF XML, EC Sales List) and AED communications; roadmap
extends to Peppol e-invoicing (ViDA) and fund-tax filings
(FATCA/CRS, DAC6, subscription tax). SaaS, single-tenant today,
multi-tenant on roadmap.

**Live at** `https://app.cifracompliance.com` (Vercel, eu-central-1
Supabase). Repo: `github.com/diego10av/cifra`.

**One-liner pitch**: *"Luxembourg tax & compliance, in one workspace.
AI reads, humans review. Starting with VAT."* — the load-bearing
phrase is "starting with VAT": owns today's credibility without
closing tomorrow's doors.

**Audience**: Big 4 firms, boutique tax advisors, law firms with
VAT practice, fiduciaries, in-house fund teams. Beachhead is
boutique tax/fiduciary firms (5-50 staff) — fastest procurement.

---

## 2 · Hard rules (non-negotiable)

These come from Diego himself. If a task conflicts with them,
push back BEFORE executing.

### Rule §11 — **Actionable-first** (2026-04-18)

> *"Todo lo que se ve tiene que tener una lógica y razón detrás
> para estar en un determinado sitio, tiene que aportar algún
> tipo de valor, información; sino es mejor que no esté."*

Every UI element must pass: **"If this number/block changes, does
the user act differently?"** If not, it's vanity. Kill it. No
decorative KPIs, no "look at how much we have" dashboards, no
items that just inform without triggering work.

Applied retroactively 2026-04-18: removed 4 KPI cards from
`/entities`, removed "Active clients" + "AI accuracy" placeholders
from home, replaced the bell icon with an actionable Inbox.

### Rule §12 — **Execute, don't delegate** (2026-04-18)

Diego is a non-technical founder with limited time. If Claude can
do something directly with reasonable security, DO IT — don't
hand back multi-step tutorials.

- **Execute without asking**: git operations, npm scripts, applying
  migrations the user has approved, local config tweaks, commits
  + pushes, running tests, lint, typecheck.
- **Ask first**: money operations, destructive prod-data ops
  (DELETE/TRUNCATE in prod), customer-facing communications, legal
  or tax interpretation, hiring/firm decisions.
- **Secrets**: ask once, use once, never repeat back. Remind the
  user they can rotate for extra hygiene.

The test: *"Could I do this with a single Bash call if Diego just
gave me the one secret?"* — if yes, do it.

### Rule — **Claude is the executor, Diego is the decider**

Claude (me) does code, migrations, reviews, drafts. Diego does:
customer calls, strategic decisions, domain-expert VAT judgements,
and the two things only a founder can do: talking to customers +
deciding what to build next.

### Rule — **Next.js 16 breaking changes**

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, and file
structure may all differ from your training data. Read the
relevant guide in `node_modules/next/dist/docs/` before writing
any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

Specific gotchas we've hit:
- `middleware.ts` is being renamed to `proxy.ts` (warning during
  dev). Still works, migration is on the backlog.
- Turbopack + path with spaces in cwd causes tailwind resolution
  warnings — not fatal.
- `instrumentation.ts` lives at repo root (not `src/`).

---

## 3 · Architecture at a glance

### Stack

- **Next.js 16.2.3** (App Router, Turbopack) + React 19
- **Supabase** (Postgres 17, EU region) for DB + storage. Project
  id `jfgdeogfyyugppwhezrz`. Connection via `DATABASE_URL`
  (server role, bypasses RLS — see §6 below).
- **Anthropic API** (Haiku 4.5 for hot paths, Opus 4.5 for
  validator / opt-in chat). Budget-guarded per firm + per user.
- **Vercel** for hosting + auto-deploy on push to `main`.
- **Sentry** + **PostHog** for observability (see §7 known quirks).
- **Playwright** for E2E (scaffold only, not in CI yet).

### Data model

Top-level hierarchy:
```
clients → entities → declarations → invoices → invoice_lines
                   ↘ entity_approvers          ↘ invoice_attachments
                   ↘ aed_communications
                   ↘ registrations
                   ↘ precedents
```

- **`clients`**: end_client / csp / other. Rich VAT contact.
- **`entities`**: LU-registered entities (SOPARFIs, AIFMs,
  SCSps…). `ai_mode` = full | classifier_only (compliance toggle).
- **`declarations`**: per entity × period. States: created →
  uploading → review → approved → filed → paid.
- **`invoice_lines`**: AI-extracted + classified. Stores BOTH the
  current `treatment` and the original `ai_suggested_treatment`
  (frozen at first classification — never overwritten) so every
  override is defensible in the audit log.
- **`invoice_attachments`**: contracts / engagement letters /
  advisor emails linked to an invoice, with optional AI analysis
  + citations from the legal-sources index.

### Key directories

- `src/app/api/*` — 68+ route handlers
- `src/lib/` — pure-ish business logic (classify.ts, ecdf.ts,
  validator.ts, deadlines.ts, audit-trail-pdf.ts, sentry-send.ts…)
- `src/config/` — canonical config: treatment-codes.ts,
  classification-rules.ts (32+ rules with LTVA/CJEU citations),
  legal-sources.ts, ecdf-boxes.ts
- `migrations/` — SQL migrations 001-010, all idempotent
- `src/__tests__/` — 502 unit tests + 60-fixture synthetic corpus
- `e2e/` — Playwright specs (5 read-only flows)
- `docs/` — strategy, protocols, positioning, ROADMAP/TODO

---

## 4 · Current state (keep this section fresh on each stint)

**As of 2026-04-19, 11th stint in progress.** Status:

### Shipped (by stint)
- ✅ Tier 1 hardening (stint 10, 2026-04-19): Sentry (custom envelope
  sender bypasses SDK bug), PostHog, classifier-accuracy dashboard,
  onboarding banner, Playwright scaffold.
- ✅ AI-override audit PDF + bulk edit + Excel import + contract
  attach L1+L2+L3 (stints 8-9, 2026-04-18).
- ✅ Clients/entities/approvers restructure Fase 1 (stint 6).
- ✅ Inbox replaces the bell (Fase 3, stint 6).
- ✅ `ai_mode` toggle per entity for compliance-sensitive clients.
- ✅ 10 migrations applied, RLS on every public table.
- ✅ Governance: PROTOCOLS §13 living-docs custody (with deeply-held-position checkpoint).

### Shipped in stint 11 (2026-04-19 overnight)
- ✅ Classification: independent directors (natural = OUT_SCOPE per
  C-288/22 TP, legal = taxable + CONTESTED flag per AED Circ. 781-2),
  SPV passive-holding LU domestic leg (RULE 15P → LUX_17_NONDED),
  carry interest (substance test), waterfall distributions,
  cost-sharing cross-border (RULES 35 / 35-lu / 35-ok per Kaplan
  C-77/19 + DNB Banka / Aviva).
- ✅ Pro-rata computation + UI (Art. 50 LTVA) — `src/lib/prorata.ts`
  + API endpoints + ProrataPanel on `/declarations/[id]` with
  three-card headline (total / deductible / non-deductible) +
  formula trail + missing-config banner. 11 new unit tests.
- ✅ Multi-contact per client + auto-inherit to entity approvers
  (migration 012 `client_contacts` + ApproversCard picker).
- ✅ Multi-user + role gating — cookie format v2 (`role.id.hmac`),
  middleware deny-list for junior on /settings/*, /metrics,
  /legal-watch, /legal-overrides, /audit, /registrations. Three
  password env vars: `AUTH_PASSWORD` / `_REVIEWER` / `_JUNIOR`.
- ✅ Landing page at `/marketing` — Factorial + Linear + Veeva +
  Stripe-inspired. Hero, Why vertical, How it works, 6-stat depth
  grid + 6 case-law chips, 10-item product arc, mailto CTA.
  Static-rendered, noindex/nofollow.
- ✅ Durable research artifact: `docs/classification-research.md`
  (456 lines) — feeds all future director / pro-rata / SPV /
  carry / IGP work.

### Strategic orientation
- **Veeva-style positioning**: vertical-deep (only LU, only
  compliance), premium pricing, multi-product arc (VAT →
  Peppol → subscription tax → FATCA/CRS → AIFMD → direct tax).
  See `docs/positioning.md` for the full framing.
- **Two client-type shapes** supported architecturally:
  CSP (fiduciary serves many end-clients → entities) vs in-house
  (AIFM/holding group → their own entities, no "clients" layer).
  `org_type` toggle hides the Clients sidebar in in-house mode.
- 🟡 Customer discovery: 1 meeting done (2 prospects: bank NL,
  fintech UK), features built from feedback. 2nd meeting TBD.
  Go-to-market is the critical path now.

**Real-time check**: `git log --oneline -10` + `docs/TODO.md` top
section ("Done this week") tell you what shipped since this doc
was written.

---

## 5 · Working protocol

How we iterate. See `docs/PROTOCOLS.md` for the long form.

1. **Morning brief** (automated): every morning at 08:30 CET, a
   scheduled task runs that reads `docs/TODO.md`, `docs/ROADMAP.md`,
   and recent git log, and gives Diego a 5-line briefing in chat.
2. **After every stint**: update `docs/TODO.md` — move shipped
   items to "Done this week", add new tasks surfaced during work.
3. **Commits**: descriptive messages that explain the WHY, not
   just the WHAT. Co-authored with Diego. Push on every commit
   (no local-only work). CI runs typecheck + tests + build.
4. **Autonomy default**: run autonomously, commit + push, summarise
   at the end. Diego intervenes only when explicitly asked.
5. **Budgets**: respect `BUDGET_MONTHLY_EUR` (default 75€) for
   Anthropic spend. Per-user caps enforced via `api_calls` table.
6. **Language**: Diego writes in Spanish; mirror him. Code, commits,
   docs in English.

---

## 6 · Security posture

- Single-password auth today (`AUTH_PASSWORD` env). Multi-user +
  roles is P0 #2 — NOT shipped, waiting for first paying customer.
- HMAC session tokens (`AUTH_SECRET`). Signed approval tokens for
  the client portal (separate HMAC).
- RLS on every public table (migration 006). `service_role` and
  `postgres` roles bypass RLS via BYPASSRLS; anon and authenticated
  get deny-all. Safe until we add user-facing direct DB access.
- CSP + HSTS + X-Frame-Options + Permissions-Policy all set in
  `next.config.ts`. Explicitly allowlisted: Supabase, Anthropic,
  ECB, Sentry, PostHog, Vercel Live.
- Rate-limiting (token bucket, per IP × path) on `/api/agents/*`
  and `/api/invoices/*/attachments/*/analyze`.
- AI calls respect per-entity `ai_mode = classifier_only` kill-
  switch (no Anthropic calls for those entities' extract /
  validate / chat / attachment-analyze).

---

## 7 · Known quirks (things that will trip future sessions)

### `@sentry/nextjs` v10 transport is broken in Vercel serverless

The SDK's `captureException` / `captureMessage` return event ids
but the internal flush hangs between Lambda invocations. Events
never arrive at Sentry. Proven with the `/api/debug/sentry-test`
diagnostic session on 2026-04-19.

**Workaround in place**: `src/lib/sentry-send.ts` is a 180-line
reimplementation that builds a valid Sentry envelope and POSTs
it via plain `fetch` with `keepalive: true`. Proven to deliver
events in 25-80ms. `instrumentation.ts` → `onRequestError` hook
uses it.

**Do not** replace `reportError` / `reportMessage` with
`Sentry.captureException` unless you've verified the SDK flush
actually works in the current Next + Sentry version combo.

### The Excel import path uses AI column mapping

Built 2026-04-18 because clients send cifra's users heterogeneous
xlsx files — no template we hand out will be filled. Haiku maps
columns → canonical schema; reviewer confirms in a preview.
Falls back to a heuristic (EN/FR/DE/ES header aliases) when
`ai_mode = classifier_only` or budget exhausted.

### The classifier is AI-free

`src/lib/classify.ts` + `src/config/classification-rules.ts` do
not call Anthropic. It's a deterministic rules engine with 32+
rules citing LTVA articles + CJEU cases. The 60-fixture corpus
(`src/__tests__/fixtures/synthetic-corpus.ts`) is the regression
benchmark — dashboard at `/settings/classifier` shows pass rate
live.

**Do not** add AI calls to the classifier without discussing
first. Determinism is the product moat.

### AI override log is the headline compliance feature

On every invoice_line, we store `ai_suggested_treatment` frozen
at first classification — never overwritten. When the reviewer
changes `treatment`, the difference becomes a "USER OVERRIDE"
event in the audit trail, surfaced in `/declarations/[id]` "Audit"
tab + exportable as formal PDF via `src/lib/audit-trail-pdf.ts`.

This is the pitch killer against "we can't use AI" objections:
the AI never takes the final call, every human override is
logged as defensible evidence.

---

## 8 · What NOT to do (YAGNI list)

Parking lot. Do not build any of these without explicit greenlight
and customer-signal evidence. Each was deliberated + rejected OR
deferred for a reason.

- **AWS Bedrock / on-prem deployment** — only when an enterprise
  prospect has a signed contract asking for it. Building speculatively
  wastes days. See `ai_mode=classifier_only` as today's answer.
- **Multi-tenant (per-firm isolation)** — P2, build when the
  2nd paying CSP firm is about to onboard. Zero value before.
  NOT the same as multi-user (which IS in flight, stint 11 —
  adds reviewer / junior roles, single-tenant still).
- **Mobile / responsive UI** — parked. Users are desktop-only
  (VAT workflow happens at a desk with 2 monitors). iPad read-only
  is on P1.5 but not yet built.
- **New language coverage** — English only. Switching to FR/DE/ES
  is a distraction before product-market fit.
- **Dark mode + keyboard shortcuts** — nice-to-have. Build when a
  customer asks twice.
- **Custom auth pages** (email magic link, OAuth, etc.) — ties to
  multi-tenant. Same gate.
- **Sentry session replay** — deliberately disabled. Invoice
  contents + provider names are sensitive; re-enable only under
  a signed DPA.
- **GDPR tooling** (data export / erasure UI) — parked until a
  prospect explicitly asks. The underlying data model supports it;
  it's just UI plumbing.
- **Adjacent jurisdictions (BE/NL/DE)** — year-2 decision. Veeva
  principle: go deep in one vertical before going wide. LU must be
  dominant first.
- **Adjacent verticals (HR, CRM, finance-ops SaaS)** — permanently
  off-limits. cifra is Luxembourg compliance. Peer firms pivoting to
  "AI for everything" lose the moat.

### Recently UNPARKED (stint 11, 2026-04-19)

- **Landing page** at `cifracompliance.com` — **unparked**. Diego
  wants a "muy top" first landing, Factorial + Veeva + Linear
  inspired. No public distribution planned yet — it's the private
  artifact he'll show privately to prospects. NO company name / NO
  about-us / NO team section / NO marketing chatbot.
- **Multi-user + roles** — **unparked** (was P0 #2, gated on paying
  customer). Diego wants a junior-role credential to let his junior
  test the app with the restricted view a client would see.
  Supabase Auth free tier (50k MAU) is sufficient; no cost.

See `docs/ROADMAP.md` for the full prioritised backlog.

---

## 9 · Live doc index

Every doc in `docs/` is actively maintained. Read as needed:

- **`docs/TODO.md`** — this week's actions + stint log. **Read at
  every session start.**
- **`docs/ROADMAP.md`** — full backlog, P0 / P1 / P2.
- **`docs/PROTOCOLS.md`** — working principles (actionable-first,
  execute-don't-delegate, model matrix, commit hygiene).
- **`docs/BUSINESS_PLAN.md`** — strategy, financials, pricing
  hypothesis.
- **`docs/positioning.md`** — ICP + pitch script + "what cifra is
  NOT". Read before customer-facing copy changes.
- **`docs/MODELS.md`** — Anthropic model matrix (Haiku vs Opus,
  per-agent assignments, cost cap).
- **`docs/VIDA.md`** — ViDA / Peppol strategic briefing.
- **`docs/PERFORMANCE.md`** — perf profile + N+1 hotspots.
- **`docs/A11Y.md`** — accessibility checklist + deferred items.
- **`docs/TESTING.md`** — 120-step manual test plan (partner-ready).
- **`docs/legal-watch.md`** + `docs/legal-watch-triage.md` —
  legal-sources maintenance process.

---

## 10 · When you start a new session

Checklist for the first 2 minutes:

1. Read this file (done if you're reading this).
2. `git log --oneline -10` — what landed recently?
3. `docs/TODO.md` top section — what's queued this week?
4. If the task is code: `npm test && npx tsc --noEmit && npm run
   lint` — confirm baseline is green before touching anything.
5. If the task is strategic: re-read §2 hard rules before advising.

**Then execute.**
