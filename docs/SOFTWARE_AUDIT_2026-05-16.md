# Software-wide audit — 2026-05-16

> Consultor-level review of the three modules of cifra. Companion to
> the CRM audit (`CRM_AUDIT_2026-05-16.md`) and the security audit
> (`SECURITY_AUDIT_2026-05-16.md`). This doc covers **visual / format /
> formal consistency** + **what's missing** + **what's vanity** across
> VAT, Tax-Ops, and CRM, plus what was applied vs deferred.
>
> Goal: an honest snapshot Diego can re-run every 6-9 months.

---

## 1 · Verdict (TL;DR)

**Tax-Ops**: clean, production-ready for dogfood. Design-lint green.
Minor uniformity wins (detail pages now wrapped in `<PageContainer>`)
applied in this round.

**CRM**: solid data model + actionable widgets. Two audit findings
turned out wrong on closer inspection — `engagement_override` UI
already exists, and `/registrations/[id]` route also exists. Real gaps
fixed: Opportunities pickers (stint 91), win/loss reporting widget
(this round), FirstTimeBanner + `/crm/outreach` dead surfaces deleted.

**VAT (declarations / aed-letters / registrations / classifier)**:
declarations + AED + classifier are mature. **Registrations was the
weak spot**: bare HTML form without primitives, vanity KPI row, hardcoded
status colors. All three fixed this round. Focus halo duplication on
declarations search input also cleaned up.

**Landing**: removed entirely. `cifracompliance.com` now 308-redirects
to `app.cifracompliance.com/login`. The public surface that didn't
serve a commercial purpose is gone.

---

## 2 · What was applied in this round (stint 92)

### CRM cleanup
- Deleted `src/app/crm/outreach/` (dead redirect post stint 64.Q.7).
- Deleted `src/components/crm/FirstTimeBanner.tsx` (onboarding noise
  past its usefulness).
- New `WinLossWidget` on `/crm` home: counts YTD won/lost, win rate,
  avg won value, top reasons + source. Drives to filtered Opportunities
  lists via Rule §11.
- Documented `/crm/calendar` as the **explicit and only** Rule §14
  exception (calendar is a temporal lens, not a data dependency; no
  cross-module FK, just a UNION at the query layer).

### Landing removal
- Deleted `src/app/marketing/` entirely (page + layout).
- Simplified `src/middleware.ts`: collapsed the host split. Root
  domain hits 308-redirect straight to `app.cifracompliance.com/login`.
  Attack surface reduced — no public surface left on
  `cifracompliance.com`.

### VAT
- Migrated `/registrations` to design primitives (`PageContainer` +
  `PageHeader` + `Field` + `Input`/`Select`/`Textarea` + `Button` +
  `Badge`). Hardcoded colors / raw selects / inline buttons gone.
- Killed the Registrations vanity KPI row (Rule §11).
- Removed the `focus-visible:ring-2 focus-visible:ring-brand-500/20`
  duplication on the Declarations search input — `globals.css`
  already owns the focus halo.

### Tax-Ops
- Wrapped 4 detail pages in `<PageContainer width="medium">`:
  `filings/[id]`, `entities/[id]`, `families/[id]`, `tasks/[id]`.
  Previously rendered with `<div ... max-w-5xl>` inline, breaking the
  ritmo with the list pages' container.

### Audit findings that turned out wrong
- `/registrations/[id]` — the audit said missing; the route DOES
  exist and works. No action needed.
- `engagement_override` UI on contact detail — the audit said
  missing; the page already exposes a ChipSelect at
  [`/crm/contacts/[id]/page.tsx:367-377`](../src/app/crm/contacts/[id]/page.tsx).
  No action needed.

### What was deferred (Diego decided)
- Pipeline velocity widget (Rule §11 marginal for his volume).
- Bulk lifecycle_stage update (one-time op).
- Probabilidad por stage default (marginal nice-to-have).
- `UpcomingThisWeekWidget` cleanup (not verified vanity).
- `lead_score` columns + Haiku scheduled batch — the batch is dead
  code (no scheduler triggers it post-2026-05-05 reset), UI does show
  the field on `/crm/contacts/[id]` when populated. Leave alone.
- Any security work that costs money or adds friction (per Diego's
  hard constraint).

---

## 3 · Module-by-module current state

### 3.1 · VAT module

**Routes** (post-cleanup):
- `/declarations` + `/declarations/[id]` — heavy detail page (2035
  LOC, 13 subcomponents). Live.
- `/aed-letters` — inbox-style list, urgency badges. Live.
- `/registrations` + `/registrations/[id]` — both live; design now
  consistent with the rest of the app.
- `/settings/classifier` — accuracy dashboard, 60-fixture corpus.

**Strengths:**
- Classifier dashboard is solid signal (Rule §11 ✓).
- AED letters surface drives urgent action (Rule §11 ✓).
- Declarations + outputs (eCDF + ECSL + PDF) end-to-end works.

**Remaining gaps (deferred):**
- eCDF XSD strict validation — parked, banner already warns.
- VIES validation cache for cross-border VAT — not implemented.
- EC Sales List dedicated UI — currently piggy-backed on outputs panel.
- Corpus coverage report (untested rules) — proactive regression
  detection candidate.

### 3.2 · Tax-Ops module

**Inventory**: 32 UI routes + 37 API endpoints.

**Strengths:**
- Design-lint clean (0 violations across 493+ files).
- Counterparties model (stint 84.A) is well-integrated.
- Sub-tasks + deliverables + parent rollup (stint 84.B-E) high-quality
  workflow plumbing.
- VAT deadline correction with statutory + effective dual surface
  (mig 090) is exemplary domain modelling.
- Closed filings render deadline in neutral grey (no fake-overdue).

**Remaining rough edges (deferred):**
- Parent task list refresh lag tras subtask change — minor UX, detail
  is correct.
- Filing attachments (schema has none; works through tasks today).
- Deliverables enum validation server-side.
- Subtask inline edit polish (parity with parent task list).

### 3.3 · CRM module

**Inventory**: 22 surfaces, 14 core tables + junctions.

**Strengths:**
- Sophisticated data model (lifecycle ≠ role_tags, employment
  history junction, weighted_value GENERATED, consent tracking).
- Inline editing portado uniformemente; CrmFormModal + entity-select
  picker reusable.
- Billing module: partial payments, GENERATED outstanding, VAT
  explicit, approval workflow, credit notes, PDFs.
- Now: win/loss YTD signal surfaced; FirstTimeBanner + outreach
  redirect removed.

**Remaining gaps (deferred, listed in CRM_AUDIT §6):**
- Pipeline velocity widget.
- Bulk lifecycle migration.
- Source attribution + competitor tracking (light versions OK in the
  new widget; full versions are bigger).
- RFP / proposal generation.

---

## 4 · Cross-module visual consistency

### What's respected
- **Tokens only**: design-lint reports 0 violations of
  `text-[Xpx]` / `bg-[#hex]` / `border-[#hex]`.
- **Hover canon**: `hover:bg-surface-alt/50` used uniformly.
- **Focus halo**: owned by `globals.css`; pages no longer duplicate
  it (declarations search fixed this round).
- **Tables**: `<DataTable>` for vanilla lists, `<TaxTypeMatrix>` for
  matrices. No raw `<table>` outliers found.
- **Forms**: `<Field>` + `<Input>`/`<Select>`/`<Textarea>` pattern
  enforced on all newly-touched surfaces.

### What's still inconsistent (acceptable, but worth tracking)
- `<PageContainer>` adoption — Tax-Ops home + many lists use it,
  Tax-Ops detail pages now use it (this round), but a few list pages
  still ship without it (`/tax-ops/filings`, `/tax-ops/entities`).
  Low-priority; ritmo of viewport is similar enough.
- VAT module pages don't all use `<PageContainer>` either —
  declarations is `max-w-[1200px]` inline. Defer.

---

## 5 · Rule §11 / §14 scorecard

| Module | §11 Pass | §14 Status | Notes |
|---|---|---|---|
| **VAT** | ✓ (post-registrations KPI kill) | N/A (own data) | KPI vanity row deleted this round. |
| **Tax-Ops** | ✓ | ✓ clean | Counterparties + deliverables + rollup all actionable. |
| **CRM** | ✓ (post-FirstTimeBanner + outreach kill) | ✓ + 1 documented exception | `/crm/calendar` UNIONs tax-ops deadlines as a temporal lens (no FK, no auto-sync). Documented as explicit exception. |

---

## 6 · What this audit deliberately did NOT cover

- Performance / N+1 hotspots — see `docs/PERFORMANCE.md`.
- Accessibility — see `docs/A11Y.md`.
- Test coverage gaps — see `docs/TESTING.md`.
- Security posture — see `docs/SECURITY_AUDIT_2026-05-16.md`.

---

## 7 · How to use this doc

1. **As a re-run baseline**: 6-9 months from now, re-execute the same
   three Explore agents (CRM / VAT / Tax-Ops) + visual lint scan,
   diff against this snapshot.
2. **As a punch list**: the "Remaining gaps" sections per module are
   the candidate backlog when Diego identifies friction or a free
   afternoon.
3. **As a Rule §11/§14 reference**: the cross-module scorecard
   (§5) is the easiest sanity check before adding a new widget or a
   new surface.

**Fecha:** 2026-05-16. Snapshot post-stint 92.
