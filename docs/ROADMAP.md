# cifra · Product Roadmap

> Living backlog of everything we know we want to build, organised by
> priority and effort. Updated after every audit or customer
> conversation. When something ships, move it to the "Shipped" section
> at the bottom with the commit hash.
>
> Last updated: 2026-04-16

Priority legend:
- **P0** — blocks selling / shows unprofessionalism in a demo
- **P1** — ships in the first 3-6 months of live product
- **P2** — can wait until we have 10+ paying customers

Effort: S (< 1 day) · M (1-3 days) · L (3-10 days) · XL (> 10 days)

---

## 🔴 P0 — before cifra is sellable (2-4 weeks)

| # | Item | Effort | Notes |
|---|---|---|---|
| ~~1~~ | ~~**Validator UI integration**~~ | ~~M~~ | ✅ **Shipped 2026-04-16 in commit `4c85c81`.** Button in declaration page action strip + 440px drawer on the right with severity summary, expandable finding cards, legal-refs linking out to Legilux/CURIA, accept/reject/defer actions with rejection-reason prompt. Respects lock state. |
| 2 | **Multi-user + roles (preparer / reviewer / partner)** | L | Supabase Auth for email/password + 3 roles with middleware enforcement. Role-based UI affordances (only partners can approve-and-file, preparers can prepare but not approve). No product for firms without this. |
| 3 | **Onboarding wizard first-run** | M | 3-step flow: welcome → create first client entity → upload prior-year Excel (optional) → land on Home. Prevents cold-empty-state abandonment. |
| 4 | **Client approval portal (signed link)** | M | The fund manager receives a link (JWT-signed, no login), sees the appendix + PDF preview + Approve button. Click records IP + timestamp + audit trail. Eliminates the 3-5 email back-and-forth per declaration. |
| 5 | **Sentry error tracking** | S | 30 minutes to add. Without it, production bugs are invisible. |
| 6 | **Rate limiting + Anthropic budget alerts** | ~~S~~ **DONE** | Middleware rate limit on `/api/agents/*` → ✅ shipped (in-memory token bucket, per-IP-per-path, tunable limits per route). Monthly budget cap per firm → ✅ shipped (commit `c302cff`). Both gates now active at the top of every expensive endpoint. |
| 7 | **Refactor declaration page into subfiles** | M | 2,480-line monolith → DocumentsTab / ReviewTab / FilingTab / OutputsTab / PreviewPanel. Pure mechanical refactor; business logic unchanged. |
| 8 | **Pricing validated with 5 customer calls** | M | Not code. 5 discovery calls with LU fiduciary firms. Validate the seats-+-per-declaration hypothesis. |
| 9 | **In-product chat: Haiku default + Ask-Opus button** | M | Right-side drawer triggered from every page. **Default model Haiku 4.5** (fast + cheap); explicit **"Ask Opus" button** re-runs last question on Opus 4.5 when the user needs deeper reasoning (toast shows cost). Context-aware (current declaration / selected line / entity + `legal-sources.ts` in system prompt). **Hard per-user budget cap: €2/month default** (Firm plan), tracked in `api_calls.user_id`, enforced by new `requireUserBudget()` in `budget-guard.ts`. When cap hit → read-only banner ("quota reached, back on 1st of month or ask admin to raise"). Firm admin UI at `/settings/users` to raise per-user cap €2 → €5 → €10 → €20. See `docs/MODELS.md §4` for the full spec. Used EVERY day by every reviewer → highest-retention feature on the roadmap. |
| 10 | **ViDA Peppol e-invoicing module — Pillar 1 pre-empt** | L | Structured e-invoice generator (Peppol-BIS / EN-16931 XML). LU clients with FR / BE / IT / PL subsidiaries already need this today (those jurisdictions have mandatory B2B e-invoicing live). Pre-empts ViDA 2030 for LU. Also: incoming Peppol ingestion — parse structured XML directly, skip OCR entirely, zero error rate. See `docs/VIDA.md` for full scoping. **Strategic priority**: Diego's fiduciary clients ask about e-invoicing today; cifra can cross-sell this to every VAT customer. |

---

## 🟠 P1 — first 3-6 months of live product

| # | Item | Effort | Notes |
|---|---|---|---|
| 9 | **Background job queue (Inngest / QStash)** | L | Extraction is synchronous today. For 200+ doc batches it hits Vercel's 5-minute timeout. Move to a real queue with progress streaming, retry, cancel. |
| 10 | **Per-client billing / fee schedule** | L | Fee schedule per client (fixed per decl / hourly / value-based). Time tracking per declaration. Generate invoice to the end client from cifra itself. Massive stickiness multiplier. |
| 11 | **Bulk import entities (CSV)** | M | Firms onboarding from Excel need to migrate 20-200 entities at once. |
| 12 | **Responsive mobile read-only** | M | Tables collapse to stacked cards below 720px. Everything viewable on iPad (CSP office visits). |
| 13 | **Command palette ⌘K with actions** | M | Current search just navigates. Extend to actions: "Create new declaration", "Upload AED letter", "Run validator", "Go to settings". Factorial / Linear pattern. |
| 14 | **Practitioner analytics dashboard** | M | Reinforce `/metrics`: time per declaration, client profitability, AI accuracy over time, flagged-rate evolution, API cost per client. Uses data already in DB (`api_calls`, `audit_log`, `validator_findings`). |
| 15 | **Illustrated empty states** | S | Small SVG illustrations (≤100px) for each empty state. Distinguishes "prototype" from "product". |
| 16 | **Inline legal tooltips** | M | Every treatment / box / rule reference becomes hover-able with the full `legal-sources.ts` entry. Converts the legal-watch asset into felt value. |
| 17 | **E2E tests (Playwright, 5 critical flows)** | M | Upload → extract → classify → approve → XML. Prevents silent regressions in flows the unit tests don't cover. |
| 18 | **Drafter integrated into approval flow** | S | After approval, auto-draft the client email; user reviews/edits/sends in one step. Today it's manual. |
| 19 | **Toast / banner consistency pass** | S | Pick one pattern per situation type; audit and unify. |
| 20 | **Database backups + restore plan** | M | Daily off-site snapshots, documented restore procedure, test restore quarterly. Art. 70 LTVA retention is 10 years. |
| 21 | **AUTH_SECRET rotation mechanism** | S | Dual-secret validation with grace period. Standard SaaS hygiene. |
| ~~22~~ | ~~**CSP + security headers**~~ | ~~S~~ | ✅ **Shipped 2026-04-16 in commit [incoming].** `next.config.ts` now emits CSP + HSTS (2y, preload-ready) + X-Frame-Options DENY + X-Content-Type-Options + Referrer-Policy + Permissions-Policy (camera / mic / geolocation / payment / USB / bluetooth / sensors all off) + Cross-Origin-Opener-Policy same-origin. CSP connect-src whitelists every external we actually call (Supabase + Anthropic + ECB + Vercel). |
| 23 | **Staging environment** | M | Separate Supabase project + Vercel preview deployment. Schema migrations go to staging first. |
| 24 | **Validator budget control (cache + confirmation)** | S | Don't re-run if lines unchanged. Show estimated cost before dispatching. Per-user monthly cap. |

---

## 🟡 P2 — when 10+ paying customers

| # | Item | Effort | Notes |
|---|---|---|---|
| 25 | **Multi-tenant (firm A vs firm B isolation)** | XL | Row-level Supabase RLS + tenant_id on every table. Dials up complexity but required for selling to multiple firms without data cross-contamination. |
| 26 | **White-label (logo + color)** | M | Per-firm brand customization on the client portal and email drafter. |
| 27 | **GDPR tooling** | L | Data export, erasure, rectification, processing register. Table-stakes for selling into any EU firm that takes GDPR seriously. |
| 28 | **Dark mode** | S | CSS tokens already centralised; class-based theme switch. 4h. |
| 29 | **Keyboard shortcuts (full)** | S | j/k navigate lines, a approve, r reopen, ? help. |
| 30 | **Knowledge base / inline help** | M | "What's the difference between LUX_17 and LUX_17_NONDED?" surfaces `legal-sources.ts` entries inline. |
| 31 | **AED XSD real verification** | L | Resolve the 5 🟥 items in `docs/legal-watch-triage.md` (namespace, FormVersion, element name, period encoding, Agent block). Required before any real filing can be uploaded. |
| 32 | **Expansion to Belgium VAT** | XL | New legal-sources corpus, new classifier rules, new forms. Year-2 roadmap. |
| 33 | **Accounting integrations — Sage BOB 50 / Exact / Odoo** | L | Bidirectional connector: pull chart of accounts + suppliers from accounting, push journal-entry drafts from approved declarations. ENDS the double transcription (factura → IVA → contabilidad) that every fiduciary currently does manually. Upsell €100-200/mo per connection. Build NOT an accounting product — plug into what the client already uses. |

---

## 🧭 Fund-compliance expansion — the "cifra becomes compliance hub" arc

Beyond VAT, Luxembourg fund entities face a long tail of periodic
compliance obligations that are today filed via Excel, Word templates,
or fragmented tools. cifra's classifier-first + legal-watch architecture
transposes cleanly. Each line below is a separate product module; each
becomes a new revenue line once the VAT customer base is established.

| # | Module | Effort | Why it fits cifra |
|---|--------|--------|-------------------|
| 40 | **FATCA / CRS reporting (US-IRS + OECD CRS)** | XL | Fund entities file FATCA (US) + CRS (OECD) reports annually. Account-level data on reportable persons. Deadlines, schema (XML), transmission to AED (for LU). High-complexity compliance; same user (fiduciary firm). Legal-watch already handles multi-source tracking. |
| 41 | **Subscription tax (taxe d'abonnement) filings** | L | Fund-type entities (UCITS, SIF, RAIF, SICAR) pay subscription tax quarterly based on NAV. Filing to AED on a specific form (TVA-TAB?). Numbers-heavy, rule-based, perfect fit. |
| 42 | **Direct tax returns — corporate income tax + net wealth tax** | XL | LU corporate income tax (IRC + ICC + NWT). SOPARFIs and active holdings file annually on Form 500. Less automatable than VAT but same customer base. Consider partnership with Sage or building only for fund-entity-specific structures. |
| 43 | **KYC / AML onboarding automation** | L | When a fiduciary onboards a new fund entity, it collects UBO forms, source-of-funds declarations, sanctions screening, PEP screening. Highly templated. cifra's document triage + extractor ports well. Adjacent to fund compliance but stylistically different — careful not to dilute VAT focus. |
| 44 | **AIFMD / UCITS annex IV reporting** | L | AIFMs file quarterly Annex IV reports to CSSF. Data-heavy XML. Same pipe pattern as eCDF. Fits fund-type customers exactly. |
| 45 | **DAC6 reportable arrangements** | M | Cross-border tax arrangements notification. Relatively low volume but high-stakes. Could be a cheap add-on. |
| 46 | **CBAM quarterly reports** | M | For clients importing steel / aluminium / cement / fertilisers. Narrow applicability but nobody is serving LU importers on this today (2026 still transitional phase). |
| 47 | **CESOP cross-reference viewer** | S | CESOP data is available to tax authorities since 2024 — fiduciary firms don't see what AED sees. cifra could surface CESOP patterns for clients to self-check before AED does. |

**Strategic note:** Diego's stated vision is "cifra becomes the
compliance hub for LU fund entities". Each module above takes ~4-8
weeks of focused work once the VAT core is stable. Aim: one new module
per quarter after reaching 20 paying customers. Priority order when
entering this phase:
  1. Subscription tax (small, high-margin, very common)
  2. FATCA/CRS (high-value, complex, annual cycle fits cifra's rhythm)
  3. ViDA Peppol e-invoicing (already listed P1 #10 above — cross-sold)
  4. AIFMD Annex IV (fund-specific, high-margin)
  5. Everything else by customer demand

---

## 🗑️ To remove / simplify

| Item | Rationale |
|---|---|
| `/registrations` as top-level nav | It's the onboarding state of an entity. Fold into Clients as a "Setup" tab on the entity detail. |
| `/legal-overrides` as top-level nav | Rarely created. Sub-section of `/legal-watch`. |
| `/audit` as daily nav item | Raw audit table is viewed ~once a year. Inline "last 5 changes" on each entity/declaration + `/audit` becomes an export/search tool, not a nav destination. |
| `/deadlines` separate page | Already top-5 on Home + per-entity. Redundant top-level nav item. |
| `/metrics` (unless invested in practitioner analytics) | Current state = only API cost. Either invest (see P1 item 14) or demote to Settings > Usage. |
| Legacy `IC_ACQ` code | Migrate to `IC_ACQ_17/14/08/03`, delete the legacy variant from rules/boxes. |
| Provider search in SearchBar | Monitor usage; if < 5% of queries, remove. |
| `TrendingUpIcon` unused import on home | Trivial cleanup. |
| `Card` component vs ad-hoc SectionCards in home | Unify into one abstraction. |

---

## 🧱 Technical debt inventory

- Declaration detail page is 2,480 lines in a single file (P0 #7)
- Zero observability in production (P0 #5)
- Extraction is synchronous, tied to Vercel timeout (P1 #9)
- No background job queue
- No retry with exponential backoff on failed extractions
- No rate limiting on agent endpoints (P0 #6)
- `/metrics` shows only API cost, no practitioner business metrics
- No CSP or security headers (P1 #22)
- No staging environment (P1 #23)
- No test of DB restore procedure (P1 #20)
- Single-secret HMAC session cookies (no rotation path)
- FK cascades not consistent across all tables
- `favicon.ico` not regenerated from the current `favicon.svg`
- Search indexes provider names even though usage is probably <5%
- Logo mark is Dribbble-grade; a real designer would iterate

---

## 🎨 Design polish backlog

- Empty states without illustrations — add small vectors
- Typography: consider a display font for H1s (Inter Tight / Geist / General Sans)
- Motion: approval animation, reclassification pulse, filing celebration
- Logomark iteration with a real designer
- Favicon fav.ico binary update
- SearchBar placement — maybe right-aligned instead of left
- Tables responsive breakdown below 720px
- Dark mode (P2 #28)

---

## ✅ Shipped (for historical record)

Recent milestones landed on `main`:

| Date | Commit | What |
|------|--------|------|
| 2026-04-16 | 4c85c81 | Strategy docs (ROADMAP, BUSINESS_PLAN, positioning) + Validator UI integration |
| 2026-04-16 | 401c5ed | UI phase 3: AED inbox rewrite + list-page polish |
| 2026-04-16 | 54164da | UI phase 2: declaration page — breadcrumbs + lifecycle stepper + tabs |
| 2026-04-16 | e7d4f3b | UI phase 1: AppShell + dashboard home + legal-watch |
| 2026-04-16 | 80cee1c | Option D: synthetic invoice corpus (60 fixtures + runner) |
| 2026-04-16 | 995f276 | Option C: validator agent (Opus second-opinion review) |
| 2026-04-16 | d13355f | Option B: 20+ new classification rules + audit hardening |
| 2026-04-16 | dd78860 | Option E-4: legal-watch map populated (circulars + cases + practice) |
| 2026-04-16 | fbfb71d | Option E-3: prompt rewrites + 11 extractor fields |
| 2026-04-16 | 71b597a | Option E-1: 2 CRITICAL + 7 HIGH classification fixes |
| 2026-04-16 | 1a6de83 | Option E-2: eCDF box formula + EC Sales List rewrite |

253 tests green, ~15,000 LOC of platform, 5 Claude agents wired, 32+ classification rules with 60-case regression corpus.
