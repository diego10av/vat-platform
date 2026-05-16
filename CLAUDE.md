# cifra — Claude Code onboarding

**Read this file first in every new session.** Single source of truth
for what cifra is, how Diego works with Claude, and the non-negotiable
rules. Everything else (`docs/*`, `src/*`) is detail.

> **⚠️ Mandatory session-start audit — before doing anything else:**
>
> 1. `git log --oneline -10` — what landed since last session.
> 2. Diff recent commits against §4 (Current state) + §7 (Known
>    quirks) + §8 (YAGNI). Anything contradicted or missing?
> 3. If yes → **fix CLAUDE.md first, in its own commit, then start
>    Diego's task.** No permission, no announcement.
> 4. Same rule mid-conversation: if Diego says something that
>    contradicts a living doc, update silently in the same stint.

> **Deeply-held position checkpoint**: if Diego's new direction would
> REVERSE something deliberated (a hard rule §11/§13/§14, a shipped
> architectural decision) — one-line confirmation before overwriting:
> *"Espera — esto revertiría [X] que acordamos en [Y]. ¿Confirmas el
> pivote, o te he entendido mal?"* If Diego is thinking out loud the
> position stands.

---

## 1 · What cifra is

**Diego's personal Luxembourg compliance workspace.** Single user
(Diego), dogfood-first, no plans to sell soon. The product makes
Diego's day-to-day VAT compliance + CRM tracking + Tax-Ops monitoring
faster than what he had before (Notion + Excel).

Three modules, intentionally independent (Rule §14):

- **VAT** — Diego's VAT prep tool. Invoices → AI extractor → deterministic
  classifier (32+ LTVA/CJEU rules) → eCDF XML + EC Sales List + AED
  letters. The original module.
- **Tax-Ops** — compliance tracker for the entities Diego manages.
  Matrices for CIT, NWT, VAT, WHT, BCL, FATCA/CRS, Subscription Tax.
  Status, deadlines, sign-off, audit trail.
- **CRM** — Diego's personal commercial book (companies, contacts,
  matters, opportunities, tasks, billing).

**Live at** `https://app.cifracompliance.com` (Vercel, eu-central-1
Supabase). Repo: `github.com/diego10av/cifra`.

---

## 2 · Hard rules (non-negotiable)

### Rule §11 — **Actionable-first** (2026-04-18)

> *"Todo lo que se ve tiene que tener una lógica y razón detrás para
> estar en un determinado sitio, tiene que aportar algún tipo de valor,
> información; sino es mejor que no esté."*

Every UI element passes: **"If this number/block changes, does Diego
act differently?"** If not, kill it. No vanity KPIs, no decorative
dashboards.

### Rule §12 — **Execute, don't delegate** (2026-04-18)

Diego is non-technical. If Claude can do something with reasonable
security, DO IT — no multi-step tutorials.

- **Execute without asking**: git ops, npm scripts, applying migrations
  (Diego approved upfront), local config tweaks, commits + pushes,
  tests/lint/typecheck.
- **Ask first**: money operations, customer-facing communications,
  legal/tax interpretation.
- **Secrets**: ask once, use once, never repeat back.

### Rule §13 — **Design uniformity across modules** (2026-04-26)

> *"El diseño tiene que ser uniforme a través de cifra."*

cifra is one product visually. Tax-Ops, VAT, CRM share one look.
**`docs/DESIGN_SYSTEM.md` is the source of truth.** CI lint guard
(`npm run lint:design`) enforces:

- Type scale: `text-{2xs|xs|sm|base|lg|xl|2xl|3xl}`. Never `text-[Xpx]`.
- Colour: only tokens. Never `border-[#hex]` or `bg-[#hex]`.
- Hover canon: `hover:bg-surface-alt/50`.
- Focus halo: `globals.css` owns it.
- Pages wrap `<PageContainer>` and open with `<PageHeader>`.
- Tables: `<DataTable>` for vanilla lists, `<TaxTypeMatrix>` for matrices.
- Forms: `<Field>` wraps `<Input>` / `<Select>` / `<Textarea>` / `<SearchableSelect>`.
- Drawers/Popovers/Modals: primitives in `src/components/ui/`.

If a primitive doesn't fit, **extend it, don't escape**.

### Rule §14 — **Strict module independence** (2026-05-04)

cifra is one product visually but **three modules data-wise**, kept
strictly separate:

- **CRM** owns Diego's personal contacts/companies.
- **Tax-Ops** owns the firm's entities + csp_contacts.
- **VAT** owns its own clients/entities/declarations.

Each module owns its own contacts/companies/entities lists. Diego
**accepts manual duplication** as the cost.

**Anti-patterns** — refuse to build:
- Auto-sync of contacts between modules.
- Cross-module foreign keys (e.g. legacy `crm_companies.entity_id` →
  removed in stint 67.F).
- Cross-module widgets (e.g. tax filings on CRM "Upcoming this week").

**Documented exception** (stint 92): `/crm/calendar` UNIONs Tax-Ops
`tax_filings` deadlines into a single temporal view. No cross-module
FK, no auto-sync, no mixed lists — read-only UNION at the query
layer for a single calendar surface. Diego's call: a calendar is a
lens, not a dependency. See `docs/SOFTWARE_AUDIT_2026-05-16.md` §4.

### Rule §15 — **Mac performance hygiene** (2026-05-05)

Diego's dev Mac is 8 GB RAM. Before opening dev server, kill orphan
node/tsc processes; check `vm_stat` if it feels slow. See
`docs/PROTOCOLS.md §15` for the full rules.

### Rule — **Next.js 16 breaking changes**

<!-- BEGIN:nextjs-agent-rules -->
This version has breaking changes — APIs, conventions, file structure
may differ from training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing code.
<!-- END:nextjs-agent-rules -->

Specific gotchas hit:
- `middleware.ts` is being renamed to `proxy.ts` (warning during dev).
  Migration deferred.
- Turbopack + path with spaces in cwd causes tailwind resolution
  warnings — not fatal.

---

## 3 · Architecture at a glance

### Stack

- **Next.js 16** (App Router, Turbopack) + React 19
- **Supabase** (Postgres 17, EU). Project id `jfgdeogfyyugppwhezrz`.
  `DATABASE_URL` is service-role (bypasses RLS — see §6).
- **Anthropic API** — Haiku 4.5 for hot paths (extract, draft),
  Opus for validator.
- **Vercel** for hosting + auto-deploy on push to `main`.
- **No telemetry** (Sentry + PostHog removed in reset 2026-05-05).
- **Playwright** for E2E (scaffold only, not in CI).

### Data model

```
clients → entities → declarations → invoices → invoice_lines
                                              ↘ invoice_attachments
                   ↘ aed_communications
                   ↘ registrations
                   ↘ precedents
```

- `clients`: end_client / csp / other.
- `entities`: LU-registered (SOPARFIs, AIFMs, SCSps…). `ai_mode` =
  full | classifier_only.
- `declarations`: per entity × period. States: created → uploading
  → review → approved → filed → paid.
- `invoice_lines`: stores both `treatment` (current) and
  `ai_suggested_treatment` (frozen at first classification — never
  overwritten) so every override is defensible in the audit log.

CRM tables are completely separate (Rule §14): `crm_companies`,
`crm_contacts`, `crm_matters`, `crm_opportunities`, `crm_tasks`,
`crm_billing`.

Tax-Ops tables: `tax_entities`, `tax_obligations`, `tax_filings`,
`tax_filing_signoff`, `tax_assessments`, `tax_ops_tasks`.

### Key directories

- `src/app/api/*` — route handlers
- `src/lib/` — business logic (classify.ts, ecdf.ts, validator.ts,
  deadlines.ts, audit-trail-pdf.ts, prorata.ts…)
- `src/config/` — canonical config (treatment-codes.ts,
  classification-rules.ts with LTVA/CJEU citations, legal-sources.ts,
  ecdf-boxes.ts, ecdf-xsd-config.ts)
- `migrations/` — SQL migrations 001-081, idempotent
- `src/__tests__/` — 614 unit tests + 60-fixture synthetic corpus
- `docs/` — ROADMAP, TODO, PROTOCOLS, DESIGN_SYSTEM, classification-research

---

## 4 · Current state

**As of 2026-05-05** — post-reset to dogfood-first single-user.

### Reset 2026-05-05 (5 fases)

Diego pivoted from "voy a vender pronto" to "dogfood-first". Five
phases of cleanup pushed in the same day:

- **Fase 1** (`99524dd`): 10 scheduled tasks deleted (morning brief,
  legal-watch scan, 5 CRM scheduled, 2 tax-ops scheduled, model-tier-watch).
  Unused deps dropped (@notionhq/client + better-sqlite3). Memory
  pointer cleaned.
- **Fase 2** (`4932165`): Sentry + PostHog completely removed (4 sentry
  configs + sentry-send.ts custom helper + PostHogProvider + 1 tracking
  call + 2 npm packages + CSP cleanup).
- **Fase 3** (`b3f5ba1`): auth multi-user → single-user.
  `ADMIN_PASSWORD` env var + cookie HMAC simple. Deleted /settings/users
  + /api/users + two-person rule. 12 routes refactored
  (requireRole → requireSession). Migration 080 dropped `users` table.
- **Fase 4** (`ab8c3ad`): purga masiva. Borrado: chat in-product
  (4 routes + components + libs + tests), inbox, marketing, portal,
  approvers + contacts, email drafter, onboarding seed, Vercel cron
  stuck-followups, iCal feed. Migration 081 dropped `entity_approvers`,
  `client_contacts`, `chat_threads`, `chat_messages`. Budget cap
  default 75€ → 20€.
- **Fase 5**: docs reescritos (este archivo + ROADMAP + TODO + PROTOCOLS).
  3 docs estratégicos borrados (positioning, BUSINESS_PLAN,
  go-to-market). 2 one-shot docs archivados.

### Tests baseline

614/614 verde. Era 707 antes del reset.

### Pending (que Diego ejecuta)

- Vercel env vars: añadir `ADMIN_PASSWORD`, borrar `AUTH_USERS`,
  `AUTH_PASS_*`, `NEXT_PUBLIC_SENTRY_*`, `SENTRY_*`,
  `NEXT_PUBLIC_POSTHOG_*`, `BUDGET_MONTHLY_EUR` (queda 20€ default),
  `CRON_SECRET`, `CIFRA_ICAL_TOKEN`. Mantener `AUTH_SECRET`,
  `DATABASE_URL`, `ANTHROPIC_API_KEY`, Supabase keys.
- (Migrations 080 + 081 ya aplicadas en Supabase via MCP — no requiere
  acción.)

**Real-time check**: `git log --oneline -10` + `docs/TODO.md` top
section tell you what shipped since this doc was written.

---

## 5 · Working protocol

How Diego ↔ Claude iterate. See `docs/PROTOCOLS.md` for the long form.

1. **Living docs auto-maintained**: after every commit that ships a
   ROADMAP item or surfaces a new task, update `docs/ROADMAP.md` +
   `docs/TODO.md` in the same or next commit. Diego shouldn't have to
   say "update the docs."
2. **Commits**: descriptive messages, explain WHY not just WHAT.
   Co-authored with Diego. Push every commit (CI runs typecheck +
   tests + build on Vercel auto-deploy).
3. **Autonomy default**: run autonomously, commit + push, summarize
   at end. Diego intervenes only when explicitly asked.
4. **Budget**: respect `BUDGET_MONTHLY_EUR` (default 20€). Hard-blocks
   at 100%, soft-warns at 80%.
5. **Language**: Diego writes in Spanish; mirror him. Code, commits,
   docs in English.

---

## 6 · Security posture

- **Single password auth** (reset 2026-05-05). `ADMIN_PASSWORD` env var
  in Vercel; cookie HMAC over `AUTH_SECRET`. Sin roles, sin usuarios
  múltiples. The login route at `src/app/api/auth/login/route.ts`
  rate-limits 10/15min per IP.
- **CSP + HSTS + X-Frame-Options + Permissions-Policy** all set in
  `next.config.ts`. Allowlisted: Supabase, Anthropic, ECB, Vercel
  Live. NO Sentry, NO PostHog (removed).
- **RLS on every public table** (mig 006). `service_role` and
  `postgres` roles bypass via BYPASSRLS; anon and authenticated get
  deny-all. Safe single-user, single-tenant.
- **Rate-limiting** (token bucket per IP × path) on `/api/agents/*`
  and `/api/invoices/*/attachments/*/analyze`.
- **AI calls respect per-entity `ai_mode = classifier_only`** kill-
  switch — no Anthropic for those entities' extract / validate /
  attachment-analyze.

---

## 7 · Known quirks

### The Excel import path uses AI column mapping

Built 2026-04-18 because the xlsx files Diego receives are
heterogeneous. Haiku maps columns → canonical schema; Diego confirms
in a preview. Falls back to a heuristic (EN/FR/DE/ES header aliases)
when budget exhausted.

### The classifier is AI-free

`src/lib/classify.ts` + `src/config/classification-rules.ts` do not
call Anthropic. Deterministic rules engine with 32+ rules citing LTVA
articles + CJEU cases. The 60-fixture corpus
(`src/__tests__/fixtures/synthetic-corpus.ts`) is the regression
benchmark — dashboard at `/settings/classifier` shows pass rate live.

**Do not** add AI calls to the classifier without Diego's signal.
Determinism is the moat.

### AI override log is the compliance backbone

On every invoice_line, `ai_suggested_treatment` is frozen at first
classification — never overwritten. When Diego changes `treatment`,
the diff becomes a "USER OVERRIDE" event in the audit trail,
exportable as PDF via `src/lib/audit-trail-pdf.ts`. This is the
backbone for any future audit by AED.

---

## 8 · What NOT to do (YAGNI list)

These were deliberately removed in the 2026-05-05 reset and don't come
back without explicit greenlight:

- **Multi-user / roles** (admin/junior/reviewer) — single-user only.
- **Multi-tenant** (firm A vs firm B) — single-user only.
- **Cliente approval portal** (signed share links) — fuera.
- **Email drafter** post-approval — fuera.
- **Onboarding wizard** / first-run UI — fuera.
- **Landing page / marketing** — fuera. `cifracompliance.com` 308-redirects
  to `app.cifracompliance.com/login` (stint 92). No public surface.
- **Chat in-product** (Ask cifra) — fuera (Diego: "mal construido").
- **Inbox / notifications page** — fuera.
- **Vercel cron jobs** — fuera, sin scheduled tasks.
- **iCal feed / calendar subscription** — fuera.
- **Sentry / PostHog / cualquier telemetría externa** — fuera.
- **Scheduled tasks** (morning brief, legal-watch scan, payment
  reminders, deadline alerts, etc) — todos quitados.
- **ViDA Peppol e-invoicing** — parqueado.
- **AED XSD strict validation** — parqueado, banner amarillo se queda.
- **Mobile / responsive UI** — parqueado.
- **Dark mode + keyboard shortcuts (full)** — parqueado.
- **GDPR tooling** — parqueado.
- **Adjacent jurisdictions (BE/NL/DE)** — parqueado.

If a task feels like it crosses any of these, **push back BEFORE
executing**.

---

## 9 · Live doc index

Every doc in `docs/` is actively maintained. Read as needed:

- **`docs/ROADMAP.md`** — Now / Next / Later / Out-of-scope. Read at
  session start.
- **`docs/TODO.md`** — this week's actions + Done. Read at session start.
- **`docs/PROTOCOLS.md`** — working principles (actionable-first,
  execute-don't-delegate, model matrix, commit hygiene, Mac perf
  hygiene).
- **`docs/MODELS.md`** — Anthropic model matrix (Haiku vs Opus,
  per-agent assignments, cost cap).
- **`docs/DESIGN_SYSTEM.md`** — tokens, primitives, cross-module rules.
  CI guard (`npm run lint:design`) enforces non-negotiables.
- **`docs/PERFORMANCE.md`** — perf profile + N+1 hotspots.
- **`docs/A11Y.md`** — accessibility checklist + deferred items.
- **`docs/TESTING.md`** — manual test plan.
- **`docs/legal-watch.md`** + `docs/legal-watch-triage.md` —
  legal-sources maintenance process (manual now, scheduled scan
  removed).
- **`docs/classification-research.md`** — substantive VAT classification
  reference. Cite when adding/modifying rules.
- **`docs/ltva-procedural-rules.md`** — LTVA filing-cadence rules.
  Read before any feature that creates VAT obligations.
- **`docs/ECDF_XSD_RECONCILIATION.md`** — XSD reconciliation status.
  5 unverified items vs current AED schema; banner warns "for
  inspection only" until resolved.
- **`docs/SECURITY.md`** — auth model, data-flow (who sees what),
  secrets, transport headers, audit log. Living reference.
- **`docs/INCIDENT_RESPONSE.md`** — 1-page playbook for the realistic
  incidents (API-key leak, unauthorised login, Supabase compromise,
  Anthropic spend spike, Vercel outage).
- **`docs/SECURITY_AUDIT_2026-05-16.md`** — snapshot of the 12-dim
  posture audit. Re-run every 6-9 months. Notes the €0 fixes
  applied (CSP tightening, login audit log) and the "costs money"
  backlog Diego declined.
- **`docs/CRM_AUDIT_2026-05-16.md`** — opinionated audit of the
  CRM module (bugs / gaps / clutter / top-5 priorities).
- **`docs/SOFTWARE_AUDIT_2026-05-16.md`** — software-wide audit
  consolidating VAT + Tax-Ops + CRM visual / format / consistency
  findings, plus the Rule §11/§14 scorecard. Re-run every 6-9 months.
- **`docs/VIDA.md`** — ViDA strategic briefing (parked but kept for
  reference).
- **`docs/test-sandbox-design.md`** — test-sandbox design (deferred).
- **`docs/archive/`** — one-shot docs (Gassner audit 2026-04-19,
  Tax-Ops migration 2026-04-24).

---

## 10 · When you start a new session

Checklist for the first 2 minutes:

1. Read this file (done if you're reading it).
2. `git log --oneline -10` — what landed recently?
3. `docs/TODO.md` top section — what's queued this week?
4. If task is code: `npm test && npx tsc --noEmit && npm run lint` —
   confirm baseline green before touching anything.
5. If task is strategic: re-read §2 hard rules before advising.

**Then execute.**
