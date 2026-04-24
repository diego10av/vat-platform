# cifra · Product Roadmap

> Living backlog of everything we know we want to build, organised by
> priority and effort. Updated after every audit or customer
> conversation. When something ships, move it to the "Shipped" section
> at the bottom with the commit hash.
>
> Last updated: 2026-04-24 (night) — Stint 36 closed. Matrix cells
> are now inline-editable: click a status cell to change it, click
> prepared-with or comments to edit in place. Empty cells auto-create
> the filing on first status pick. Excel export added per category
> ("Download as xlsx"). Previously: stint 35 redesigned `/tax-ops`
> from flat filings grid → tax-type-first sidebar + Excel-style
> matrix per category (NWT reclassified as advisory review; 200
> annual filings year-shifted 2026 → 2025). Stint 34 shipped the
> initial `/tax-ops` module.

Priority legend:
- **P0** — blocks selling / shows unprofessionalism in a demo
- **P1** — ships in the first 3-6 months of live product
- **P2** — can wait until we have 10+ paying customers
- **P3** — future product line (separate revenue stream)

Effort: S (< 1 day) · M (1-3 days) · L (3-10 days) · XL (> 10 days)

---

## 🔴 P0 — before cifra is sellable (2-4 weeks)

| # | Item | Effort | Notes |
|---|---|---|---|
| ~~1~~ | ~~**Validator UI integration**~~ | ~~M~~ | ✅ **Shipped 2026-04-16 in commit `4c85c81`.** |
| 2 | **Multi-user + roles (admin / reviewer / junior / client)** | L | **UNPARKED 2026-04-19.** Supabase Auth (free tier). Four-role matrix: `admin` (Diego, full access incl /settings/*), `reviewer` (prepare + approve, no admin pages), `junior` (restricted: only sees client-facing UI — `/clients`, `/entities/[id]`, `/declarations/[id]` review + approve path — NO /settings, NO /metrics, NO /legal-watch, NO cost/budget info, NO /settings/users), `client` (for future multi-tenant — not used today). Diego: *"quiero dar un usuario a mi junior para que testee por su cuenta (y que en su usuario vea solo las cosas que vería ya un cliente final)"*. |
| ~~3~~ | ~~**Onboarding wizard first-run**~~ | ~~M~~ | ✅ **Shipped 2026-04-19 in commit `cd0f93f`** (onboarding banner + one-click demo seed). |
| ~~4~~ | ~~**Client approval portal (signed link)**~~ | ~~M~~ | ✅ **Shipped 2026-04-18.** |
| ~~5~~ | ~~**Sentry error tracking**~~ | ~~S~~ | ✅ **Shipped 2026-04-19 in commit `a64cf35`** — custom envelope helper (bypasses @sentry/nextjs serverless bug). |
| ~~6~~ | ~~**Rate limiting + Anthropic budget alerts**~~ | ~~S~~ | ✅ **Shipped 2026-04-18.** |
| ~~7~~ | ~~**Refactor declaration page**~~ | ~~M~~ | ✅ **Shipped (partial) 2026-04-18** — 37% reduction, 7 modules extracted. |
| 8 | **Pricing validated with 5 customer calls** | M | Not code. Diego's work. |
| ~~9~~ | ~~**In-product chat: Haiku + Ask-Opus**~~ | ~~M~~ | ✅ **MVP Shipped 2026-04-18.** |
| 10 | **ViDA Peppol e-invoicing module — Pillar 1 pre-empt** | L | Moved to P1 timeline (see P1 section) — required for differentiation but not blocker for first customer. |
| 11 | **Multi-contact per client + auto-inherit to entities** | M | **NEW 2026-04-19.** Diego's instruction: *"a un cliente final, pueden ser varios contactos de esa misma empresa. haría falta tener una base de datos de contactos para un mismo cliente — contacto principal + X CCs, reusables al añadir los approvers de cada entidad"*. Migration: new `client_contacts` table (FK client_id, name, email, role, is_main). `entity_approvers` gets optional `client_contact_id` FK so picking "add from client contacts" inherits without duplication. Edit on client_contacts propagates. |
| 12 | **Classification: Independent directors (natural + legal persons)** | M | **NEW 2026-04-19.** LU AED practice changed materially after CJEU C-288/22 TP (2024-02-21): natural-person independent directors are NOT taxable persons → no VAT on their fees. Legal-person directors remain taxable per AED practice (2024 press release, Circ. 781-2) BUT subject to debate — must flag for reviewer. New classification rule; new fixture subset; new legal-source entries for C-288/22 + C-420/18 IO + Circ. 781-1/2. Diego's correction: *"lo de los directores si no me equivoco no es solo persona física pero también jurídica. Pero míralo bien. Quiero que hagas un deep research"*. |
| 13 | **Pro-rata computation + UI (mixed-use fund managers)** | L | **NEW 2026-04-19.** Art. 50 LTVA + Art. 173-175 Directive. Fund managers with mixed activity (taxable management fees + exempt intra-group loans) must apportion input VAT. Two sub-cases: loans INSIDE LU = exempt without deduction (no credit mechanism); loans OUTSIDE LU = Art. 49§2 exception grants full deduction. Migration: `entity_prorata` table (entity_id, period_start, period_end, method, ratio, notes). UI section in `/declarations/[id]`: total input VAT → ratio → deductible (highlighted green) / non-deductible (highlighted red/amber) / method justification (text). Must be "clarísimo" per Diego. Include in audit-trail-pdf. |
| 14 | **Landing page at cifracompliance.com root** | L | **UNPARKED 2026-04-19.** Subdomain `app.` keeps the product; root domain gets a Factorial + Veeva + Linear-inspired landing. Hero ("Luxembourg tax compliance, rebuilt from the law up"), vertical-first framing, product-arc section, real screenshots, legal depth visible, NO company name + NO about-us + NO team + NO marketing distribution (Diego: *"no voy a ir por ahí mandando la página… quiero algo muy top para una primera landing"*). Copy anchors in positioning.md §Landing page. |
| 15 | **SPV passive-holding classification hardening** | S | **NEW 2026-04-19.** Current code has RULE 11P/13P (passive-holding gate) but no dedicated classification path for the passive holding's own outgoing absence of supply + no-deduction status. Add: `entity_type='passive_holding'` explicitly blocks reverse-charge on incoming cross-border + blocks any deduction. New fixtures to regression-test. Cite: Polysar C-60/90, Cibo C-16/00, Marle C-320/17, Larentia+Minerva C-108/14+C-109/14. |
| 16 | **Carry interest + waterfall distribution rules** | S | **NEW 2026-04-19.** Today `PRACTICE.PRAC_CARRY_INTEREST` and `PRAC_WATERFALL_DISTRIBUTION` exist as soft references but no classification rule routes to OUT_SCOPE. Add explicit keyword-triggered rules with flags: carry to a GP-investor → OUT_SCOPE; carry to a pure-service GP → flag for review (may re-characterise to 17% taxable). Waterfall distributions → OUT_SCOPE; "structuring fees" embedded in waterfall → flag (taxable 17%). |

---

## 🧬 Deletion + retention maturity (Veeva-level roadmap)

The Fase 1 items below SHIPPED stint 13 (2026-04-20). Fase 2 + 3 are
the queue for continuing to raise cifra's destructive-action posture
to enterprise / compliance-SaaS standards.

### ✅ Fase 1 — shipped stint 13
- Immutable audit log (trigger blocks UPDATE/DELETE on `audit_log`)
- Admin-only gate on cascade delete endpoints
- Art. 70 LTVA guardrail: cascade refuses if committed declarations
  (approved / filed / paid) are touched, unless the UI passes an
  explicit `acknowledge_filed=true` flag AND the reviewer ticks a
  retention-awareness checkbox
- `/settings/trash`: browsable soft-archived clients + entities
  with one-click restore + retention copy
- Destructive modal copy now mentions audit immutability +
  auto-purge roadmap

### 🟠 P1 — Fase 2 (before 2nd paying customer)
| # | Item | Effort |
|---|---|---|
| D1 | **Export ZIP before cascade delete** | M |
| D2 | **Email-confirmation cooldown** (destructive acts on > 50 rows → confirm link in inbox, 15 min expiry) | M |
| D3 | **Retention policy per-firm** — configurable 30/60/90/365 day auto-purge of archived items (excludes committed declarations) | L |
| D4 | **Scheduled purge job** — cron that enforces the retention policy; dry-run mode + notification preview | L |
| D5 | **Delete reason / justification** — free-text field required when cascade-deleting a client with > 10 entities | S |
| D6 | **Auto-snapshot before delete** — dumps JSON of the target + cascaded children to a cold-storage bucket for 30 days | M |
| D7b | **Intermediary as first-class entity** — today `clients.engaged_via_*` is flat metadata per client. When a firm routes 3+ clients through the same CSP (e.g. JTC), updating JTC's contact means editing every client. Migrate to an `intermediaries` table with FK from `clients`. Data migration: extract distinct engaged_via_name rows, create intermediary records, repoint FKs. UI: "Intermediaries" section in /settings with per-intermediary contact sync across all linked clients. | L |

### 🟡 P2 — Fase 3 (before Big 4 / ALFI presentation)
| # | Item | Effort |
|---|---|---|
| D7 | **Write-once audit bucket** — mirror `audit_log` INSERTs to S3 Object Lock (WORM). Survives even a DB drop. | L |
| D8 | **Hash-chain on audit_log** — each row carries SHA256(prev_row_hash \|\| this_row_cols). Detects tampering even if triggers bypassed. | M |
| D9 | **SOC 2 Type I readiness** — control-mapping doc + change-management log for the triggers | L |
| D10 | **21 CFR Part 11 alignment** — for future pharma-fund customers requiring FDA-grade electronic records | XL |
| D11 | **Granular cascade control** — UI checklist in the delete modal: "delete declarations but keep AED letters", etc. | M |
| D12 | **Dry-run API flag** (`?dry_run=true`) — server runs the transaction then ROLLBACKs + returns exact row counts that would have been affected | S |
| D13 | **Time-delayed account delete** — 72h cooldown on admin-account deletion with email reversal link (AWS pattern) | S |

---

## 🟠 P1 — first 3-6 months of live product

| # | Item | Effort | Notes |
|---|---|---|---|
| P1.1 | **Background job queue (Inngest / QStash)** | L | Extraction is synchronous today. For 200+ doc batches it hits Vercel's 5-minute timeout. Move to a real queue with progress streaming, retry, cancel. |
| P1.2 | **ViDA Peppol e-invoicing module — Pillar 1** | L | Structured e-invoice generator (Peppol-BIS / EN-16931 XML). LU clients with FR / BE / IT / PL subsidiaries need this today. Pre-empts ViDA 2030 for LU. Also: incoming Peppol ingestion — parse structured XML directly, skip OCR entirely, zero error rate. See `docs/VIDA.md`. Strategic: Diego's fiduciary clients ask about e-invoicing today; cifra can cross-sell this to every VAT customer. |
| P1.3 | **Per-client billing / fee schedule** | L | Fee schedule per client (fixed per decl / hourly / value-based). Time tracking per declaration. Generate invoice to the end client from cifra itself. Massive stickiness multiplier. |
| P1.4 | **Bulk import entities (CSV)** | M | Firms onboarding from Excel need to migrate 20-200 entities at once. |
| P1.5 | **Responsive mobile read-only** | M | Tables collapse to stacked cards below 720px. Everything viewable on iPad (CSP office visits). |
| P1.6 | **Command palette ⌘K with actions** | M | Extend search to actions: "Create new declaration", "Upload AED letter", "Run validator", "Go to settings". Linear pattern. |
| P1.7 | **Practitioner analytics dashboard** | M | Reinforce `/metrics`: time per declaration, client profitability, AI accuracy over time, flagged-rate evolution, API cost per client. |
| P1.8 | **Illustrated empty states** | S | Small SVG illustrations (≤100px). Distinguishes "prototype" from "product". |
| P1.9 | **Inline legal tooltips** | M | Every treatment / box / rule reference hover-able with the `legal-sources.ts` entry. Converts legal-watch asset into felt value. |
| P1.10 | **E2E tests in CI** | S | 12 tests already written (commit `0c05ee4`). Unblock by configuring a staging Supabase project. |
| P1.11 | **Drafter integrated into approval flow** | S | After approval, auto-draft the client email. |
| P1.12 | **Database backups + restore plan** | M | Art. 70 LTVA retention is 10 years. |
| P1.13 | **AUTH_SECRET rotation mechanism** | S | Dual-secret validation with grace period. |
| P1.14 | **Staging environment** | M | Separate Supabase project + Vercel preview. |
| P1.15 | **Validator budget control (cache + confirmation)** | S | Don't re-run if lines unchanged. |
| P1.16 | **In-house mode (org_type switch)** | M | `firms.org_type = 'csp' \| 'in_house'`. When `in_house`, hide Clients sidebar + entities are direct children. Required for AIFM / holding group ICPs. |
| P1.17 | **Cost-sharing exemption (IGP / Art. 44§1 y)** | S | Formal classifier rule citing Kaplan C-77/19 — cross-border cost-sharing does NOT qualify. Narrow but high-signal. |
| P1.18 | **Subscription tax (taxe d'abonnement) — module 6** | L | Quarterly UCITS/SIF/RAIF/SICAR filings. See positioning.md product-arc section. First fund-specific module post-VAT stability. |
| ~~P1.19~~ | ~~**RULE 11X — EU supplier charged foreign VAT on a service**~~ | — | **✅ SHIPPED stint 23, 2026-04-23.** Covers EU and non-EU suppliers; cites Art. 44/196 Directive + Art. 17§1 LTVA + C-333/20 Wilo Salmson + Art. 49 LTVA. F105/F106 flipped from NO_MATCH; F111 added (non-EU branch); F112 added (goods-vs-service regression guard). |
| ~~P1.20~~ | ~~**Legal-watch — direct curia.europa.eu RSS fetcher**~~ | — | **✅ SHIPPED stint 23, 2026-04-23.** `src/lib/legal-watch-curia.ts` hits the official "Latest rulings" RSS, pre-filters on multilingual VAT markers, feeds the same triage/drafter/dedup pipeline. Scanner default source list is now `['curia', 'vatupdate']`. |
| P1.21 | **Legal-watch — AED impotsdirects.public.lu scraper** | M | AED has no RSS. A scheduled HTML diff of the Circulaires page + Bulletin d'information would surface new circulars within 24h. Part of the "living classifier" principle; queues hits in `legal_watch_queue` with `source='aed'`. |

---

## 🟡 P2 — when 10+ paying customers

| # | Item | Effort | Notes |
|---|---|---|---|
| P2.1 | **Multi-tenant (firm A vs firm B isolation)** | XL | Row-level Supabase RLS + tenant_id on every table. |
| P2.2 | **White-label (logo + color)** | M | Per-firm brand customization on client portal + email drafter. |
| P2.3 | **GDPR tooling** | L | Data export, erasure, rectification, processing register. |
| P2.4 | **Dark mode** | S | CSS tokens centralised. 4h. |
| P2.5 | **Keyboard shortcuts (full)** | S | j/k navigate, a approve, r reopen, ? help. |
| P2.6 | **Knowledge base / inline help** | M | Surfaces `legal-sources.ts` entries inline. |
| P2.7 | **AED XSD real verification** | L | Resolve the 5 🟥 in `docs/legal-watch-triage.md`. Required before any real filing uploads. |
| P2.8 | **FATCA / CRS reporting — module 7** | XL | Fund entities file FATCA + CRS reports annually. Account-level XML. |
| P2.9 | **AIFMD Annex IV — module 8** | L | AIFMs file quarterly Annex IV to CSSF. |
| P2.10 | **Accounting integrations — Sage BOB 50 / Exact / Odoo** | L | Bidirectional connector: pull CoA + suppliers, push journal-entry drafts. Upsell €100-200/mo per connection. |

---

## 🟤 P3 — future product lines (year 2+)

| # | Module | Effort | Why it fits cifra |
|---|--------|--------|-------------------|
| P3.1 | **Direct tax returns — IRC / ICC / NWT** | XL | LU corporate income tax. Form 500. Less automatable but same customer base. |
| P3.2 | **DAC6 reportable arrangements** | M | Cross-border tax arrangements notification. Low volume, high-stakes. Cheap add-on. |
| P3.3 | **KYC / AML onboarding automation** | L | UBO forms, source-of-funds, sanctions screening. Adjacent; careful not to dilute VAT focus. |
| P3.4 | **CBAM quarterly reports** | M | For clients importing steel / aluminium / cement / fertilisers. Narrow but uncontested. |
| P3.5 | **CESOP cross-reference viewer** | S | CESOP data available to AED since 2024 — fiduciaries don't see what AED sees. Self-check before audit. |
| P3.6 | **Expansion to Belgium VAT** | XL | New legal corpus, rules, forms. Year-2 decision. |

**Strategic discipline (Veeva principle):** one new module per quarter
after reaching 20 paying customers. No product launch before the
predecessor is stable + profitable.

---

## 🗑️ To remove / simplify

| Item | Rationale |
|---|---|
| `/registrations` as top-level nav | It's the onboarding state of an entity. Fold into Clients as a "Setup" tab. |
| `/legal-overrides` as top-level nav | Rarely created. Sub-section of `/legal-watch`. (Already folded — verify cleanup.) |
| `/audit` as daily nav item | Raw audit table viewed ~once a year. Inline "last 5 changes" on each entity/declaration + `/audit` becomes export/search. |
| `/deadlines` separate page | Top-5 on Home + per-entity. Redundant. |
| `/metrics` (unless invested in practitioner analytics) | Invest (see P1.7) or demote to Settings > Usage. |
| Legacy `IC_ACQ` code | Migrate to `IC_ACQ_17/14/08/03`, delete the legacy variant. |
| Provider search in SearchBar | Monitor usage; if < 5% of queries, remove. |

---

## 🧱 Technical debt inventory

- Declaration detail page is 1,662 lines (was 2,637 — 37% reduction shipped, more possible)
- Zero observability in production → ✅ resolved by Sentry + PostHog (commit `a64cf35`)
- Extraction is synchronous, tied to Vercel timeout (P1.1)
- No background job queue (P1.1)
- No retry with exponential backoff on failed extractions
- `/metrics` shows only API cost, no practitioner business metrics (P1.7)
- No staging environment (P1.14)
- No test of DB restore procedure (P1.12)
- Single-secret HMAC session cookies (no rotation path) (P1.13)
- FK cascades not consistent across all tables
- `favicon.ico` not regenerated from current `favicon.svg`
- Logo mark is Dribbble-grade; a real designer would iterate

---

## 🎨 Design polish backlog

- Empty states without illustrations — add small vectors
- Typography: consider a display font for H1s (Inter Tight / Geist / General Sans)
- Motion: approval animation, reclassification pulse, filing celebration
- Logomark iteration with a real designer
- Favicon .ico binary update
- Tables responsive breakdown below 720px (P1.5)
- Dark mode (P2.4)

---

## 🧊 Deferred CRM items (stint 31, 2026-04-23)

The CRM rebuild (Fases 1-5) shipped with 5 items consciously deferred because each requires a signal we don't yet have. Reachable — not forgotten. Re-evaluate when the signal changes.

| Item | Why deferred | Trigger to unpark |
|------|--------------|-------------------|
| **Stage velocity report** `/crm/opportunities/velocity` (avg days-per-stage × BD × source × practice) | `stage_entered_at` + audit_log already answer ad-hoc questions via URL filters on the opps list. Full dashboard is a Veeva-style reporting suite (weeks of work). | 2+ BD lawyers ask for the same cross-cut more than once. |
| **`crm_matter_templates`** table (fund_formation / ma_deal / tax_opinion / litigation / regulatory pre-defined structures) | 70% overlap with `crm_task_templates` (mig 043 — stint 30.C). | Diego has opened 5+ matters and can name the pattern that isn't covered by task templates. |
| **`crm_matter_team_members` junction** with role + fee_share_pct | `team_members TEXT[]` adequate until revenue attribution lands. Migrating an array to a junction is mechanical once requirements firm up; speculative builds bake the wrong schema. | Internal revenue attribution by lawyer becomes a workflow need. |
| **Conflict-checker layer with Opus 4.7** false-positive validation | Manual dismiss UI (shipped) catches name matches; Opus adds cost without proven ROI until a real false-positive has cost 10 minutes of review. | 20+ real scans run and false-positive rate is > 50%. |
| **Saved views** (`crm_saved_views` + UI) — save/apply filter+sort state per list | URL params + paginación (shipped stint 12) cover the ~3 repeat filter combos. Saved views are a cross-cutting DB+UI investment that pays off at 10+ simultaneous users. | Multi-user goes live (P0 #2) and Diego sees his junior hunting for the same filter combo twice. |

---

## ✅ Shipped (for historical record)

Recent milestones landed on `main` — see `docs/TODO.md` "Done this week" section for detail per stint.

| Date | Commit | What |
|------|--------|------|
| 2026-04-24 (night) | a1655a3 + this commit | **Stint 36: inline-edit matrix cells + Excel export.** `InlineCellEditor` state machine + 4 concrete cells (Status, Text, Tags, Date) + `matrix-row-columns.tsx` shared column factories + `MatrixToolbar` shared toolbar strip. `applyStatusChange` helper: PATCH existing filing or POST new one (backend gets new POST /api/tax-ops/filings that auto-computes deadline and infers period_year from period_label). New `GET /api/tax-ops/matrix/export` streams an xlsx via exceljs with bold header + frozen first 2 cols. Wired inline edit on all 9 category pages (CIT, NWT, VAT annual/Q/M, WHT monthly/semester/annual, Subscription, BCL SBS/2.16). 4 new unit tests for applyStatusChange covering existing-cell PATCH, empty-cell POST, no-obligation rejection, non-200 error propagation. Gate green: tsc, 626 tests, build 143 pages. |
| 2026-04-24 (evening) | 365b820 → 69035ff (7 commits) | **Stint 35: `/tax-ops` redesign after usage feedback.** Migration 046 adds `service_kind` (filing vs review) to tax_obligations; NWT reclassified as year-end advisory review with its own rule (`fixed_md {month:11,day:30}`). Data-fix script shifted 200 annual filings 2026 → 2025 (Diego reused 2025 book in 2026). Sidebar extends NavItem with `children[]`, new Tax-Ops tree has 10 items + 3 VAT sub-items with localStorage-persisted expand state. `TaxTypeMatrix` primitive (sticky thead + sticky left column + grouped-by-client_group + status-badge cells with tooltip + click-to-filing-detail) powers 9 new category pages: CIT, NWT reviews, VAT annual/quarterly/monthly, Subscription tax, WHT monthly/semester/annual, BCL SBS/2.16, Other (ad-hoc flat list). `/api/tax-ops/matrix` endpoint returns rectangular `entities × periods` shape. `EntityFilingsMatrix` replaces stacked-year sub-tables on `/tax-ops/entities/[id]` with a compact period × tax_type grid auto-sized per row's cadence. Home page gains 7-card category grid + updated subtitle. `⌘K` gets 9 new entries. Old `/tax-ops/filings` renamed "Search filings" (advanced). 10 new unit tests. Gate green: tsc, 622 tests, build 142 pages. |
| 2026-04-24 | d741740 → 4cfec45 (6 commits) | **Stint 34: `/tax-ops` module — live DB replacement for the annual Excels + Notion DB.** 34.A migration 045 (8 tables + 13 deadline rules seed + computeDeadline helper + 18 unit tests). 34.B Excel importer CLI (dry-run + commit, atomic tx, 19 groups · 214 entities · 233 obligations · 263 filings imported from Diego's two books). 34.C home (4 actionable widgets) + filings list/detail (8-dim filters, 5-date timeline, CSP editor, deadline-rule context) + entities master/detail (YTD filed % color-coded, multi-year filings matrix) + year-rollover modal (two-phase preview→commit, idempotent). 34.D settings (team CRUD + editable deadline rules with 3-step editor modal and propagation to open filings, excluding filed/paid/waived/assessment_received). 34.E tasks state-of-art (List ⟷ Kanban toggle with drag-drop, subtasks with inline +Add, dependencies blocked_by + blocking panel, 5-type RecurrenceEditor, linear comments thread, QuickCaptureModal on 'N' shortcut) + daily recurrence-expand cron. 34.F Ask-cifra tax-ops tools (4 read-only) + daily deadline-alerts cron with 14d→7d→3d→overdue escalation + chat-context tax-ops mode. Two crons registered via scheduled-tasks MCP. Docs: PROTOCOLS §9 updated, TODO "Done this week", ROADMAP shipped-row + deferred items. |
| 2026-04-23 | stints 26-31 (30+ commits) | **CRM professional rebuild — Fases 1-5 complete.** Replaces Notion for clients/pipeline/matters/billing. Highlights: full CRUD + audit for 7 entities, soft-delete trash with 30-day purge cron + undo toasts, ⌘K global search, drag-drop kanban + billing dashboards + Excel export + saved-view-by-URL, matter intake wizard (4-step: parties/scope/team/conflict) + time tracker with 75/90/100% budget alerts + disbursements + closing checklist + 7-step gate on status=closed, invoice PDF (pdf-lib) + retainer ledger + credit notes + ECB FX snapshot + approval threshold + payment-reminder cron, engagement-recompute cron + Haiku lead scoring cron + Next Best Action widget + automation rules engine (3 pre-seeded rules) + task templates + Opus meeting-prep briefs + anniversary cron + forecast/WIP home widgets. 5 crons registered via scheduled-tasks MCP. Migrations 028-043. See "Deferred CRM items" above for the 5 consciously deferred follow-ups. |
| 2026-04-23 | bcb4746 + fe682c0 + 2a6cdda + ca092d4 | **Stint 23: RULE 11X + PhaseCTA Reopen + LifecycleStepper click-through + Modify-patch + Curia RSS.** (Slice A) RULE 11X closes the F105/F106 gap for EU/non-EU suppliers charging foreign VAT on services — cites Art. 44/196 Directive + Art. 17§1 LTVA + C-333/20 + Art. 49 LTVA; added F111 (non-EU) + F112 (goods-vs-service regression guard). (Slice B) PhaseCTA gains optional `onReopen` + `CTAGroup`; LifecycleStepper gains `onStepClick` making done steps clickable; unified `handleReopen()` in page.tsx picks confirmation copy based on status (filed/paid get AED-rectification warning). (Slice C) Migration 025 adds `ai_patch_modified_by_human / _at / _by / _original_diff`; new `PATCH update-patch` endpoint re-enforces whitelist; accept-patch emits `human_edited: true` trailer when applicable; `Modificar` button opens textarea, saves via API, shows "Edited by reviewer" chip + stale-tests banner. (Slice D) `src/lib/legal-watch-curia.ts` hits the official CJEU Latest Rulings RSS with multilingual VAT pre-filter; `parseRss` exported + generalised; default scan sources now `['curia', 'vatupdate']`. 579/579 tests green; CI passing. |
| 2026-04-21 | 9011bb3 + d3a7ab7 + 8b18ef2 | **Stint 18: migration 019 + legal-watch feed + corpus expansion.** Migration 019 — CHECK constraint on entities.entity_type (repaired stale 'soparfi' row → active_holding). Migration 020 + 941 LOC — legal-watch automated feed: `legal_watch_queue` table + `src/lib/legal-watch-scan.ts` (VATupdate live fetcher + sample seed + `matchKeywords()` over 90-phrase watchlist) + 3 API routes (`/api/legal-watch/scan \| queue \| queue/[id]`) + `LegalWatchQueueCard` UI section on `/legal-watch` (Scan now + Seed samples + Flag / Escalate / Dismiss triage) + daily 07:15 cron `cifra-legal-watch-scan` injecting into morning brief. Corpus expansion F096–F107 covering construction-RC regression guard, Art. 54 non-deductibility, Art. 199a scrap, Art. 57 franchise, Ludwig sub-agent chain, Skandia/Danske Bank VAT-group cross-border, BlackRock SaaS exclusion, Art. 45 opt-in outgoing, SV pure admin vs. servicer split, NO_MATCH edge cases for EU-supplier-mistakenly-charged-foreign-VAT, carry service-GP substance test. 577/577 tests green, typecheck clean. |
| 2026-04-21 | 9b36384 + f874f73 | **Stint 17: landing Sign in affordance.** TopNav gets "Sign in →" text link + Get-in-touch primary pill, vertical divider separator, crisper backdrop-blur on scroll. Versãofast citation in Depth grid refreshed from the old "referral fees" wording to the actual credit-intermediation ruling. Middleware host-based routing was already in place — no code change needed for when Diego activates the DNS. |
| 2026-04-20 | 382f3c6 + 8cf0e8e + e7ca83d | **Classifier deep-dive: Versãofast T-657/24 + SV entity_type + SOPARFI clarification.** Three-commit stint responding to Diego's instruction to treat the classifier as a living legal artifact. (1) Foundations: classification-research.md §9–§13 (Versãofast credit-intermediation safe harbour, SOPARFI default-not-registered rule, Loi 2004/2022 SV framework, fund-vehicle taxonomy, legal-watch live protocol). legal-sources.ts fix VERSAOFAST misattribution + add LUDWIG / ASPIRO / FRANCK / BBL / WHEELS / SV_LAW_2004 + 4 new PRACTICE entries. New CREDIT_INTERMEDIATION / SECURITIZATION_MGMT / SECURITIZATION_SERVICER keyword families. (2) Classifier: entity_type adds 'securitization_vehicle' via new isQualifyingForArt44D helper (Fiscale Eenheid X extension). RULE 22 Versãofast citation removed (was in wrong family). NEW RULE 36 credit intermediation (LU / EU / non-EU routing) and NEW RULE 37 SV servicer Aspiro-split flag. 24 new regression fixtures F072–F095 covering RULE 36 / 37 / SV / BlackRock single-supply / DB pension non-qualifying / margin scheme. All 553 tests green, typecheck clean. (3) UI: EntityEditCard adds "Securitisation vehicle (Loi 2004/2022)" option, per-type advisory notes, amber warning when a passive_holding entity has VAT identifiers. Seed data + onboarding + extractor prompt fixed to use valid entity_types (removed invalid 'soparfi' literal that slipped prior validation). |
| 2026-04-20 | stint 15 follow-up | **Frequency-change propagation**: diff modal now shouts frequency/regime changes with amber banner + "RESHAPES FILING" badge. Manual `FrequencyChangeModal` + `POST /api/entities/:id/frequency-change` endpoint handles the case where the triggering letter is NOT a VAT registration letter — includes effective date, linked document and notes. Post-upload nudge on non-VAT kinds: "Does this letter change the filing frequency?". |
| 2026-04-20 | stint 15 | **VAT letter storage + versioning** (migration 017, `entity_official_documents`). Upload persists the letter via `/api/entities/:id/official-documents`; OfficialDocumentsCard on `/entities/[id]` lists the current letter + prior versions (`superseded_by` chain). Re-upload runs extractor again, computes a field-by-field diff vs. the live entity, and opens a modal so the reviewer can opt IN per field — nothing auto-applies. Non-VAT docs (articles, engagement letter, other) share the same storage + list surface but skip the diff flow. |
| 2026-04-20 | stint 15 | **Client billing panel** (migration 018, `client_billing`). Per-client fee schedule (monthly/quarterly/annual/annual-summary/VAT-registration/ad-hoc-hourly fees + disbursement % in bps + VAT-on-disbursement flag). Engagement letter upload on top — stored in Supabase Storage at `client-billing/<client_id>/…`, replaceable, deletable. BillingCard on `/clients/[id]` renders a slim empty-state CTA when nothing's captured, a compact summary when populated, and a full edit form. |
| 2026-04-20 | stint 14.5 | Intermediary display + approver-role downstream wiring (share-link, draft-email). Unified new-declaration modal on Home and /declarations. Copy polish on /clients/new. Removed Relationship chips (redundant with intermediary checkbox). |
| 2026-04-19 | a64cf35 | Sentry custom envelope (bypasses SDK bug) — observability live |
| 2026-04-19 | 0c05ee4 | Playwright E2E scaffold + 5 read-only specs |
| 2026-04-19 | cd0f93f | Onboarding banner + one-click demo seed |
| 2026-04-19 | 05fe0db | Classifier accuracy dashboard at /settings/classifier |
| 2026-04-19 | f0135ee | Observability: Sentry + PostHog env-guarded |
| 2026-04-18 | 0b55d77 | Contract attachments L1+L2+L3 + audit PDF |
| 2026-04-18 | 58ef7c3 | Excel ingestion (AI-mapped) |
| 2026-04-18 | 6d96d81 | AI-mode toggle per entity |
| 2026-04-18 | aaaf627 | Bulk edit multi-field |
| 2026-04-18 | 6243ab8 | AI override log + audit PDF |
| 2026-04-18 | [various] | Clients/entities/approvers restructure (Fase 1), Inbox replaces bell (Fase 3), /entities KPI cleanup (Fase 2) |
| 2026-04-18 | [various] | Migrations 001-010, RLS on every public table, FK covering indexes |
| 2026-04-17 | [shipped] | Rate limiting, structured logger, per-user budget, chat MVP, ViDA briefing, MODELS.md |
| 2026-04-16 | 4c85c81 | Strategy docs (ROADMAP, BUSINESS_PLAN, positioning) + Validator UI |
| 2026-04-16 | [various] | UI redesign phases 1-3, CSP + security headers, budget guard, metrics dashboard |
| 2026-04-16 | [various] | Option B (20+ classification rules), Option C (validator), Option D (60-fixture corpus), Option E (legal-watch, prompt rewrites) |

579 unit tests green (as of 2026-04-23). 12 Playwright specs (not in CI yet — staging pending). ~16,500 LOC of platform.
