# cifra · ROADMAP

> Dogfood-first single-user backlog. Diego is the only user; cifra
> exists to make his VAT compliance + personal CRM + Tax-Ops work
> faster. If he goes back to "sell mode" in 6-12 months, this gets
> rebuilt.
>
> Last updated: **2026-05-05** (post-reset Phases 1-10).

---

## 🟢 Now (this week)

Stabilize what's built. The app has three modules shipped (VAT,
Tax-Ops, CRM) with visual + UX bugs Diego finds while using.
Priority #1 is identifying and fixing them.

- [ ] **Full visual QA pass** — Claude walks each main route with
      preview tools, captures concrete bugs in `docs/qa-2026-05-XX.md`,
      Diego prioritises, fix one per commit.
- [ ] **Bug-fix sprint over the QA list** — iterative, on-demand.
      Each fix is one small commit with before/after.

## 🟡 Next (this month)

Day-to-day improvements, only if dogfooding reveals real pain.

- [ ] **Tax-Ops: one-click access to the current filing** — from
      home, the current-quarter filing should be one click away
      without entity search. (Confirm while using.)
- [ ] **VAT: better-sorted precedent panel** — show relevant
      precedents ordered by date or frequency, not random.
- [ ] **CRM: "this week" view** — simple dashboard (active matters
      + overdue tasks + opportunities in progress). No new data,
      just filters on what's there.

## 🔵 Later (maybe someday)

Things that might make sense if dogfooding asks for them; no
deliberate investment today.

- [ ] Expand the classifier synthetic corpus (60 → 100+ fixtures)
      only if real cases surface that misclassify.
- [ ] Historical FX rate support for cross-currency input VAT
      (today EUR is assumed; only matters if invoices arrive in
      USD / CHF).
- [ ] Subscription tax (taxe d'abonnement) module if Diego starts
      preparing it manually and it hurts.
- [ ] Direct tax (CIT / NWT) prep beyond the matrix — only if the
      current Tax-Ops tabs are not enough.

## ⚫ Out of scope (not built)

Confirmed outside the dogfood-first scope:

- Multi-user, roles (admin / junior / reviewer) — single-user only.
- Multi-tenant (firm A vs firm B isolation) — single-user only.
- Client approval portal (signed share links) — out, Diego reviews
  himself.
- Post-approval email drafter — out, Diego writes the emails.
- Onboarding wizard / first-run UI — out, Diego knows his data.
- Chat in-product (Ask cifra) — out, deleted as poorly built.
- Inbox / notifications page — out, deleted.
- Vercel cron jobs — out, all automations removed.
- iCal feed / calendar subscription — out.
- Sentry / PostHog / any external telemetry — out.
- Scheduled tasks (morning brief, legal-watch scan, payment
  reminders, deadline alerts, etc.) — all removed.
- ViDA Peppol e-invoicing — fully parked. If Diego accepts mandatory
  Peppol invoicing in LU, we pick it up as a new module, not as a
  feature.
- AED XSD strict validation — the yellow "for inspection only"
  banner stays until the AED publishes a stable XSD. Out of scope.

## 📐 Rules of the game

- **Every new feature passes Rule §11 (actionable-first):** if it
  does not trigger a concrete action in Diego's day, it is not built.
- **Every new dependency** (npm package, env var, scheduled task,
  external service) requires justification; the default is no.
- **Tests green before every commit**, no exceptions.
- **Small atomic commits** (1 fix = 1 commit) make rollbacks
  trivial when something breaks.
