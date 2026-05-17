# cifra · TODO

> Concrete tasks for this week. Diego dogfoods; cifra makes his
> work faster. When something breaks during use, write it here.
> When something is fixed, move it to "Done this week" → archive
> on Mondays.
>
> Last updated: **2026-05-05** (post-reset Phases 1-10 + dogfood polish).

---

## 🔥 This week

### Diego — manual steps (3 Vercel clicks, nothing else)

- [ ] **Vercel env vars** (3 minutes):
  - Settings → Environment Variables.
  - **Add**: `ADMIN_PASSWORD` with a string ≥ 12 chars.
  - **Delete**: `AUTH_USERS`, `AUTH_PASS_DIEGO` and any `AUTH_PASS_*`,
    `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`,
    `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`,
    `BUDGET_MONTHLY_EUR` (default 20€ stays in code), `CRON_SECRET`,
    `CIFRA_ICAL_TOKEN`.
  - **Keep**: `AUTH_SECRET`, `DATABASE_URL`, `ANTHROPIC_API_KEY`,
    Supabase keys, `DEBUG_SECRET`.
  - Then: redeploy from the Vercel dashboard → confirm login at
    `app.cifracompliance.com` with the new `ADMIN_PASSWORD`.

### Claude (next sessions)

- [ ] **Full visual QA pass**: walk each route with preview tools,
      produce a prioritised list (JS console errors, broken layouts,
      500s, design inconsistencies). Diego reviews and picks priorities.
- [ ] **Bug-fix sprint** over the QA list, by priority.

---

## 🧊 Pending decisions

- [ ] Decide whether pages / features Diego only uses "sometimes"
      should stay (e.g. `/closing` dashboard, `/legal-watch` manual
      page, `/audit` log explorer). If they go unused for 2-3 weeks,
      candidates to remove.

---

## ✅ Done this week

**2026-05-17** — Fresh-start cleanup pass (stint 96)

Diego pidió un barrido sistemático de dead weight tras los recortes
previos: "como si empezáramos de cero a iterar con el producto.
teniendo claro que el roadmap a día de hoy es dogfooding". Tres
workstreams, tres commits, una migración (093).

- **Workstream A — Tax-Ops multi-user residuals**:
  - `tax-ops/settings/team` (UI + `/api/tax-ops/team` endpoint) y
    `tax_team_members` (mig 093). Era un roster de 8 short_names
    para una práctica de varias personas. `assigned_to` sigue como
    free-text donde aplica.
  - `tax-ops/settings/dedupe` — herramienta one-shot del stint 40.A;
    cumplió su propósito.
  - `TaskSignoffCard` — cascada preparer → reviewer → partner; era
    ceremonia para single-user. **Las columnas DB del sign-off se
    mantienen** por si más adelante se reintroduce un flag simple.
  - `/api/crm/debug/self-check` (dev-only nunca usado), alias
    `preparedWithColumn` en matrix-row-columns (jsdoc decía "safe to
    remove"), deps npm muertas (`@neondatabase/serverless`,
    `@types/pg`).
  - Tax-Ops settings index reescrito (drops Team + Dedupe + greyed
    Templates cards).
- **Workstream B — CRM dogfood prune**:
  - `CrmSavedViews` quitado de 4 list pages + componente borrado.
  - `CRM Automations` (page + API + `runAutomations()` runner +
    `crm_automation_rules` tabla en mig 093). 3 reglas hard-coded
    spawneaban tasks que Diego no quería; stage/invoice transitions
    siguen en audit_log.
  - **soft-delete → hard-delete en 4 tablas CRM** (companies,
    contacts, matters, opportunities). `/crm/trash` + `/api/crm/trash`
    fuera. ~40 filtros `WHERE deleted_at IS NULL` removidos en ~20
    endpoints. Confirmación modal antes de cada DELETE; audit_log
    conserva el row histórico. **VAT side intocado** (entities,
    invoice_lines, invoice_attachments mantienen `deleted_at` por
    defensibilidad de auditoría AED).
- **Migración 093**: DROP TABLE tax_team_members CASCADE; DROP TABLE
  crm_automation_rules CASCADE; DROP COLUMN deleted_at en 4 tablas
  CRM. Aplicada en producción Supabase antes del push.

Resultado: 617/617 tests verde, design-lint 0/468, typecheck limpio,
3 commits separados por workstream.

**2026-05-16** — CRM useful follow-ups + landing kill + visual polish + audit doc (stint 92)

- **Landing page eliminada**: `src/app/marketing/` borrado entero;
  `src/middleware.ts` simplificado para 308-redirect del root domain
  a `app.cifracompliance.com/login`. Superficie de ataque reducida.
  CLAUDE.md §14 anti-patterns actualizado.
- **CRM cleanup**: `/crm/outreach` dead redirect borrado;
  `FirstTimeBanner` borrado (onboarding-nudge post-su-utilidad);
  focus halo duplicado en `/declarations` search input quitado.
- **Win/loss reporting widget**: nuevo
  [`WinLossWidget`](../src/components/crm/WinLossWidget.tsx) +
  endpoint `/api/crm/reporting/win-loss`. Surface YTD won/lost,
  win rate, avg won value, top reasons + source. Embebido en /crm
  home, drill-through a listas filtradas.
- **Tax-Ops detail pages** envueltos en `<PageContainer width="medium">`
  (filings/entities/families/tasks `[id]/page.tsx`) — consistente
  con list pages.
- **VAT registrations migrated to primitives**: `PageContainer` +
  `PageHeader` + `Field` + `Input/Select/Textarea` + `Button` +
  `Badge`. Vanity KPI row eliminada (Rule §11).
- **Audit findings que el agente reportó MAL** (verificadas en
  código): `/registrations/[id]` ya existía, `engagement_override` UI
  ya estaba en contact detail. Sin acción.
- **`/crm/calendar`**: documentada como única excepción explícita a
  Rule §14 (es una lente temporal, no una dependencia de datos).
- `docs/SOFTWARE_AUDIT_2026-05-16.md` nuevo — consolida los tres
  audits (CRM ya estaba, VAT + Tax-Ops + visual consistency
  añadidos).

**2026-05-16** — CRM Opportunities fix + audits + free security fixes (stint 91)

- **CRM Opportunities** (commit `7098176`): añadidos pickers
  `company_id` + `primary_contact_id` al modal de New / Edit
  (schema + API ya soportaban, sólo el form no los exponía); nuevo
  `InlineEntitySelect` para edit-in-place de Company en lista +
  Company / Primary contact en detail page; añadido `won_reason` con
  visibleWhen=won (symétrico a loss_reason); extendido
  `entity-select` para soportar `'contact'` como source.
- **CRM audit doc** `docs/CRM_AUDIT_2026-05-16.md`: revisión
  transversal del módulo. Resume bugs concretos (lifecycle bulk
  update missing, engagement_override sin UI, /crm/outreach dead
  redirect), gaps vs estándar (reporting win/loss, velocity por
  etapa, source attribution todos ❌ MISSING), clutter por
  retar (FirstTimeBanner, calendar cross-module, lead_score sin UI,
  /crm/help inflado), y top-5 cambios priorizados — Diego decide
  cuál atacar next.
- **Security audit doc** `docs/SECURITY_AUDIT_2026-05-16.md`:
  posture 12-dim, lo que NO se ejecuta (rotación, MFA, costes),
  lo que SÍ se aplica €0, plantilla email DPA Anthropic, referencia
  a opciones que cuestan dinero (€500 → €25k). Honestly check vs
  Legora/Harvey al final.
- **Free security fixes aplicados**:
  - CSP producción: dropped `'unsafe-eval'` + `vercel.live` +
    `va.vercel-scripts.com` del `script-src`; mismo con `vercel.live`
    + `vitals.vercel-insights.com` en `connect-src`. Preview deploys
    mantienen el set completo (Vercel toolbar). `'unsafe-inline'`
    permanece por necesidad de Next.js 16.
  - Login audit log (mig 091, table `auth_login_log`): cada POST
    `/api/auth/login` graba IP + user-agent + success + failure_reason.
    Verificado end-to-end con 1 bad_password + 1 success.
  - Docs `docs/SECURITY.md` + `docs/INCIDENT_RESPONSE.md` añadidos
    al índice §9 de CLAUDE.md.


**2026-05-07** — VAT deadlines aligned with LTVA + statutory/effective surface (mig 090)

- **Bug fix**: `rule_vat_annual` had statutory **1 March** N+1, but per
  LTVA Art. 64bis the régime ordinaire is due **1 May** N+1. The
  régime simplifié (Art. 67bis) is the one due 1 March. Both now carry
  the **30 October** AED administrative tolerance as the effective
  deadline. Mig 090 corrects the seed and recomputes `deadline_date` on
  every OPEN VAT filing.
- **Periodic VAT** (`vat_quarterly`, `vat_monthly`): legal deadline
  unchanged (period_end + 15 days, LTVA Art. 64). Admin tolerance
  bumped from 15d to **60d** (~2 months) per Diego's note. Effective
  deadline propagated to OPEN filings.
- **`tax_filings.statutory_deadline_date`** new column. Stores the
  legal date alongside `deadline_date` (= effective). Writers
  (rollover + manual create) populate both; readers (matrix + filing
  detail) expose both.
- `computeDeadline` (`tax-ops-deadlines.ts`) extended so
  `days_after_period_end` rules with `admin_tolerance_days > 0`
  produce a separate `extension` (= effective).
- **`src/lib/deadlines.ts`** legacy quarterly bug fixed: was computing
  "end-of-next-month + 15 days" (15 May for Q1) — now correctly
  `period_end + 15 days` (15 April for Q1, LTVA Art. 64).
- **UI**: `DeadlineWithTolerance` shows the effective date as primary
  (urgency-coloured) and the statutory as a small muted secondary
  line ("legal · YYYY-MM-DD"); tooltip explains both. Applied on
  matrix Deadline + Next-deadline columns. Filing detail page also
  displays the legal date next to the effective.
- **Result**: home dashboard "Tax-Ops overdue filings" badge dropped
  from **31 → 0**. The 30 false-positive annuals (statutory 1 Mar but
  within AED tolerance until 30 Oct) and the 1 Q1 2026 quarterly
  (within +60d tolerance) are no longer flagged. Real overdue stays
  red as soon as effective passes.
- Docs updated: `ltva-procedural-rules.md` §3 documents the
  statutory/effective model with citations.

**2026-05-06** — Persistent alert surface — sidebar badges + tab title (4th commit)

- **Sidebar badges everywhere alerts live**: Tax-Ops > Overview shows
  overdue filings count, Tax-Ops > Tasks shows tasks due today, CRM >
  Tasks shows CRM tasks due today (in addition to the existing
  Declarations + Deadlines badges). Visible from any page in the app.
- **Browser tab title** shows `(N) cifra` when there's anything
  pending — visible even when cifra is in a background tab.
  `deadlinesUrgent` excluded intentionally (projected periods, not
  hanging action items).
- AppShellInner now uses `/api/home` as the single aggregator (was
  fetching three list endpoints just to count). 2 fetches instead of
  3, lighter on the pipe. Same data the home dashboard uses, so the
  badges and Today's focus stay consistent.

**2026-05-06** — Home dashboard alerts now meta-modular (3rd commit)

- **Restored CRM tasks visibility on home**. Previous commit replaced
  `crm_tasks` with `tax_ops_tasks` for the "tasks today" card; per
  Diego's clarification (Rule §14 governs data, not the meta-surface),
  the home is exactly where module queues should coexist. Layout now
  has 5 focus cards: overdue filings · AED urgent · Tax-Ops tasks ·
  CRM tasks · declarations in review. Each links to its module's
  filtered list. Grid switched from `lg:grid-cols-4` to `lg:grid-cols-5`.

**2026-05-06** — Tasks alerts surface + Saved Views removal (2nd commit)

- **Removed `Saved Views` Tax-Ops dropdown** + its component file +
  the `currentQuery` plumbing. Diego confirmed never used it. Toolbar
  is now: filter chips · Columns · New.
- **Sub-task rows now show `follow_up_date` alerts** in the engagement
  detail page. Previously only `due_date` was rendered, so chase-
  reminders were invisible until the row was expanded. Both dates now
  switch to `mode='neutral'` once the sub-task is `done/cancelled` —
  consistent with the list-page treatment, no more "stale red" on
  closed work. API `SubtaskRow` query updated to surface the field.
- **Home dashboard `tasks due today` now counts Tax-Ops tasks**
  (was crm_tasks). Diego dogfoods Tax-Ops as primary; previously the
  tile and link were oriented to `/crm/tasks`, leaving compliance
  tasks invisible on home after the `/inbox` removal in the
  2026-05-05 reset. Card now links to `/tax-ops/tasks?preset=overdue`.
  ChaseToday continues to surface stale `waiting_on_*` separately.

**2026-05-06** — Tasks UX polish (1 commit)

- **Tailwind 4 z-index tokens fixed**: `--z-*` → `--z-index-*` in
  `globals.css`. The 5 utilities (`z-popover/modal/drawer/sticky/toast`)
  were silently rendering as `z-index: auto` across 49 files. Visible
  symptom for Diego: Views + Columns dropdowns invisible behind table
  cells. One token rename fixes all popovers, modals, drawers, and
  sticky table headers app-wide.
- **Engagement row indicator**: rows with `subtask_total > 0` now show
  a navy chevron + a small `done/total` chip next to the title. Atomic
  rows keep the muted chevron. Resolves Diego's "no se distingue qué
  filas son engagements".
- **Removed `Templates` toolbar button + placeholder page**: 6 cards
  with disabled "Instantiate (coming soon)" buttons. Failed Rule §11
  (actionable-first). Reinstate when the instantiation flow ships for
  real.

**2026-05-05** — Strategic dogfood-first reset (10 phases)

Diego pivoted from "going to sell soon" to "dogfood-first single-user".
Executed in one long session + follow-on stabilization sessions:

- **Phase 1**: 10 scheduled tasks disabled + deleted (morning brief,
  legal-watch scan, CRM payment reminders / engagement /
  lead-scoring / anniversaries / trash-purge, tax-ops deadline-alerts /
  recurrence-expand, model-tier-watch). Two unused deps removed
  (`@notionhq/client`, `better-sqlite3`). Stale memory file deleted.
- **Phase 2**: Sentry + PostHog removed completely (4 configs +
  custom envelope helper + provider + tracking call + dependencies
  + CSP cleanup + env vars listed for Vercel deletion).
- **Phase 3**: Multi-user auth → single-user (`ADMIN_PASSWORD` env
  var + simple HMAC session cookie). Dropped `/settings/users` +
  `/api/users` + two-person approval rule. Twelve routes refactored
  (`requireRole` → `requireSession`). Migration 080 dropped the
  `users` table.
- **Phase 4**: Bulk delete of sell-features + chat + inbox:
  marketing, portal, approvers, contacts, email drafter,
  onboarding seed, Vercel cron `stuck-followups`, iCal feed, chat
  in-product (4 routes + components + libs + tests), inbox (page +
  endpoint). Migration 081 dropped `entity_approvers`,
  `client_contacts`, `chat_threads`, `chat_messages`. Budget cap
  default 75€ → 20€.
- **Phase 5** (docs): deleted `positioning.md`, `BUSINESS_PLAN.md`,
  `go-to-market-alt-fund-managers.md`. Archived `gassner-audit` and
  `tax-ops-migration-2026-04-24` to `docs/archive/`. Rewrote ROADMAP +
  TODO + PROTOCOLS + CLAUDE to reflect dogfood-first.
- **Phase 6** (QA baseline): smoke pass with preview tools, login
  flow validated, baseline `docs/qa-2026-05-05.md` created with
  manual checklist for Diego.
- **Phase 7** (stabilization): favicon + theme color refresh
  (Phase 7.1), post-login direct redirect to `/tax-ops` (Phase 7.2),
  Modal + Drawer backdrop opacity + blur normalised across the
  primitive plus 8 roll-your-own modals (Phase 7.3).
- **Phase 8** (home dashboard): `/` is now `HomeDashboard` —
  Today's focus (4 actionable cards) + Quick actions (3 primary
  buttons) + Modules (3 cards). New `/api/home` aggregator with
  defensive `safeCount` queries.
- **Phase 9** (landing): `cifracompliance.com` rebuilt with
  intermediate scope — hero + Sign in CTA + 3 module cards. Host-
  based domain split re-introduced in `middleware.ts`.
- **Phase 10** (logo): `Logo` wordmark earns the `·` dot signature
  (option A confirmed). `LogoMark` unchanged. Coherence across
  sidebar / login / landing.

Tests went from 707 → 614 (-93 from the purge), still all green.
Build green, tsc clean, design-lint 0 violations. Migrations 080 +
081 applied to Supabase via MCP.

**2026-05-05** — Pre-dogfood polish (3 commits)

- **Confirm modal sweep**: closed the gap on CIT/NWT opt-out (matrix
  delete-on-first-click); upgraded `window.confirm()` → ConfirmModal in
  5 HIGH-severity pages (companies, contacts, matters, opportunities,
  entities archive). New `useConfirm()` hook gives ConfirmModal the
  ergonomics of a one-liner await.
- **Toast coverage audit**: added `useToast()` feedback to 11 pages
  where mutations were silent — aed-letters upload, client profile
  edit, entity creation/edit, registration creation, legal-override
  delete, feedback triage, prorata config, legal-watch triage,
  rollover commit. Errors that failed silently now surface; success
  confirmations land. Skipped pages with rich inline feedback already
  (FilingEditDrawer, DeadlineRuleEditor, FeedbackWidget, bulk-import).

**2026-05-06** — Pre-dogfood E2E QA + bug fix

- **`scripts/qa-pre-dogfood.ts`** verifies 3 critical flows end-to-end
  (login, upload+extract+classify, AED reader, rollover preview+commit
  +idempotency) against a running dev server. Use a far-future year
  (2099) for rollover tests so QA data stays out of real years.
- **Bug found + fixed**: `/api/tax-ops/rollover?mode=commit` returned
  500 with `RangeError: Invalid time value`. Cause: `computeDeadline`
  for `adhoc_no_deadline` rule_kind returns `effective: ''`; the
  rollover route then passed `''` as `deadline_date` to a DATE column,
  which the postgres-js driver tried to coerce via `Date.toISOString()`
  → throw. Fix: coerce empty string to null at the rollover call site
  (`eff || null`). Regression test in `tax-ops-deadlines.test.ts`
  documents the contract: callers must guard against the empty string.
  Affected tax types: `wht_director_monthly`, `wht_director_adhoc`.
- After fix: all 3 flows pass clean. 614/614 tests, tsc clean,
  design-lint 0.

---

## 📁 Archive

Past weeks archive automatically every Monday into
`docs/archive/TODO-YYYY-WW.md`. Pre-reset there was a "Done this
week" section with ~40 stints (37-67) that no longer applies to
the new positioning; the historical record lives in `git log` +
commit messages, which is where it belongs.
