# cifra — testing checklist

> End-to-end manual test plan. The 466 unit tests cover the logic; this
> document covers the **actual lived experience** — clicks, flows, edge
> cases a reviewer would hit on a real Tuesday morning.
>
> **How to use:**
>
> 1. Run `npm run seed:demo` to populate the local DB with the three
>    demo entities + declarations + AED letters.
> 2. Run `npm run dev` and open http://localhost:3000.
> 3. Work through the sections top-to-bottom. For each scenario:
>    - Mark `[ ]` → `[x]` if it works as expected.
>    - Mark `[!]` and add a one-line note if something's off (even a
>      rough UX observation — we'll triage later).
>    - Skip a section with `[-]` if it doesn't apply to you yet.
> 4. When done, commit this file back so the checkmarks show up in PR
>    review, or just screenshot the observations and send them over.
>
> **Target time per full pass:** 2 hours, done in two sittings.

---

## 0. Setup

- [ ] `npm install` completes without errors
- [ ] `npm run seed:demo` runs to completion and prints the counts
  summary (entities, declarations, invoices, lines)
- [ ] `npm run dev` starts the server on port 3000
- [ ] http://localhost:3000 redirects to `/login` when not authed
- [ ] Login with the configured AUTH_PASSWORD → lands on the home dashboard

---

## 1. Home dashboard

- [ ] Greeting ("Good morning, Diego") shows the correct time-of-day
- [ ] "Urgent this week" section lists the demo AED letter with high
  urgency (Acme Capital — payment reminder due in 5 days)
- [ ] Stats cards show numbers (entities ≥ 3, declarations in review ≥ 3)
- [ ] Clicking a stat card navigates to the relevant list
- [ ] Portfolio table at the bottom shows the three demo entities

---

## 2. Clients (entities)

### List page

- [ ] `/entities` shows the three demo entities (Acme, Horizon, Zephyr)
- [ ] Each row shows the name, VAT number, regime, lifecycle state
- [ ] Filter chips at the top (All / Registered / Pending) work
- [ ] Search finds an entity by partial name ("acme", "zeph")
- [ ] "New client" button opens the creation form
- [ ] Creating a new entity with minimal fields (name only) succeeds
- [ ] Creating a new entity with `vat_status = pending_registration`
  moves it into the Pending filter

### Detail page

- [ ] Click "Horizon Real Estate SCSp" — the timeline loads
- [ ] Declarations list at the top shows the demo Q1 2026 declaration
- [ ] Top providers panel shows the suppliers we seeded
- [ ] Precedents panel shows at least 2 rows (EY, Bloomberg)
- [ ] AED letters panel shows the ViDA circular
- [ ] Audit trail panel scrolls — empty for seeded data, OK

---

## 3. Declarations

### List page

- [ ] `/declarations` shows 3 rows, all in `review` status
- [ ] Status badge colours match the lifecycle stepper
- [ ] Most-recent-first ordering (Horizon Q1 2026 should be first if
  the seeder ran today)
- [ ] Clicking a row opens the declaration detail

### Detail — review tab (Horizon SCSp)

- [ ] Breadcrumbs show Declarations › Horizon › 2026 Q1
- [ ] Lifecycle stepper is on the "review" step
- [ ] Two or three action buttons top-right: Second opinion, Share for
  approval, Approve
- [ ] The review table lists ~11 lines across incoming + outgoing
- [ ] Treatment badge colours match by type (LUX_17 sky-blue, RC_EU
  purple, etc.)
- [ ] Hovering a treatment badge shows the tooltip with rule + source
- [ ] Clicking the Excel icon on a line opens the preview panel
- [ ] Preview panel shows "No source document — manual entry" (these
  are seeded lines, not extracted)
- [ ] Manually change one line's treatment via the dropdown → it saves
  (check by refreshing)
- [ ] Deleting a line moves it to the "Excluded" section
- [ ] Undeleting restores it
- [ ] Bulk-select 3 lines → bar shows at the top with count + actions
- [ ] Bulk mark reviewed → badges flip across the selection

### Detail — filing tab

- [ ] Outputs panel loads with the eCDF summary
- [ ] "VAT due" shows a number, "Payable" shows a number
- [ ] Click **All boxes** — the full box list expands, grouped by section
- [ ] Click **Excel** → downloads the appendix file
- [ ] Open the file → header shows the entity, columns match the
  seeded data, Section B (outgoing) appears because this entity has
  outgoing lines
- [ ] Click **Front page PDF** → downloads + opens
- [ ] Click **eCDF XML** → XML file contains `<FormType>TVA002NT</FormType>`
  (ordinary + quarterly)
- [ ] Click **ECSL** → downloads xlsx
- [ ] Click **Draft email** → modal opens → Generate → text appears
  after ~5-10s (real Anthropic call, budget-gated)

### Detail — documents tab

- [ ] Tab shows the stats pill (0 uploaded because the demo is
  synthetic; OK)
- [ ] Drop a real PDF invoice → upload progress → triage → extract
  (real Anthropic call)
- [ ] After extraction, new lines appear in the Review tab

### Approval flow (internal)

- [ ] On the Horizon SCSp declaration, click **Approve**
- [ ] Status transitions to "approved"
- [ ] Lifecycle stepper advances
- [ ] A Reopen button appears; the Share button disappears
- [ ] Precedents were upserted (check `/entities/[id]` timeline —
  times_used on EY / Bloomberg should have incremented)

### Approval flow (client portal)

- [ ] On a fresh declaration still in `review`, click **Share for approval**
- [ ] Modal opens with expiry dropdown (default 7 days)
- [ ] Click Generate — a URL is shown, Copy button works
- [ ] Open the URL in a private/incognito window (no auth cookie)
- [ ] Portal page loads with the entity + period + total VAT due +
  big Approve button
- [ ] Click Approve — success confirmation appears
- [ ] Go back to the authed app → the declaration is now `approved`
- [ ] An audit row with `action='portal_approve'` exists (check
  `/audit` page)

### Filing + payment flow

- [ ] On the approved declaration, the Filing panel now shows a step-1
  "Approved" ✓
- [ ] Enter a filing reference → click "Mark as filed"
- [ ] Status → `filed`
- [ ] Proof-of-filing upload appears; upload any PDF → appears as a
  link after a few seconds
- [ ] Mark as paid (payment ref optional) → status → `paid`

---

## 4. AED inbox

- [ ] `/aed-letters` shows the three seeded letters
- [ ] Urgency filter (High / Medium / Low) works
- [ ] Click the Acme payment reminder — detail shows deadline,
  reference, amount
- [ ] Mark as actioned → it moves to the "Actioned" tab
- [ ] Archive → moves to Archived

### Upload

- [ ] Drop a real AED letter PDF → real Anthropic call → classified
  into type / urgency / deadline
- [ ] The letter appears in the inbox with the correct entity link

---

## 5. Deadlines

- [ ] `/deadlines` shows rows for each entity based on regime + frequency
- [ ] Horizon SCSp (quarterly) has upcoming quarter deadlines
- [ ] Overdue rows (if any) show in red

---

## 6. Legal watch

- [ ] `/legal-watch` loads with the grouped source list (LU law, EU
  law, circulars, CJEU, LU cases, practice)
- [ ] Source groups are expandable / collapsible
- [ ] Click a source URL → opens Legilux / CURIA in new tab
- [ ] "Your overrides" card at the top shows "0 overrides" or
  whatever exists
- [ ] Click "Add override" → landing on `/legal-overrides`
- [ ] Create an override for a specific provider — appears in the list

---

## 7. Chat assistant ("Ask cifra")

### Basic flow

- [ ] Click "Ask cifra" top-right of any page → drawer opens from right
- [ ] Drawer header shows quota bar (if migration 001 applied) or just
  "—" (if not)
- [ ] Suggestion chips appear in the empty state
- [ ] Type a question → press Cmd/Ctrl+Enter
- [ ] **Text streams in token-by-token** (not all at once)
- [ ] Legal refs like `[LTVA Art. 56bis]` render as pink pills
- [ ] Bold/italic/lists render properly (ask Claude to answer with a
  bulleted list to check)
- [ ] Below the answer: model badge (Haiku) + cost (€0.0XX)

### Ask Opus

- [ ] Click "Ask Opus" below an answer → placeholder appears →
  streams the Opus response
- [ ] New answer has an "Opus" badge

### Context awareness

- [ ] Navigate to a declaration detail page, open the chat
- [ ] Header shows "Current declaration · in focus"
- [ ] Ask "what declaration am I on?" — it answers with the right one

### History

- [ ] Click the clock icon → history panel opens
- [ ] Recent conversations listed with auto-generated titles
- [ ] Click a conversation → loads into the drawer, can continue
- [ ] Hover → pencil icon → inline rename → Enter saves
- [ ] Hover → trash icon → archive, disappears from list
- [ ] Click "+" → new empty chat

### Quota enforcement

- [ ] **Only test if migration 001 applied.** Raise a user's cap via
  `/settings/users`, then ask many questions until you hit it
- [ ] Input becomes read-only with "Monthly AI quota reached" banner
- [ ] Banner links to `/settings/users`

---

## 8. Users + AI caps (`/settings/users`)

- [ ] Link from `/settings` → opens the users screen
- [ ] If migration 001 NOT applied → shows "Migration not applied" card
  with step-by-step instructions
- [ ] If applied → shows at least the founder row with €50 cap, 0 spend
- [ ] Change cap from dropdown → refreshes, persists
- [ ] Click role badge → toggles between admin / member
- [ ] Click trash → confirmation → deactivates
- [ ] Try to deactivate the last admin → error banner "Cannot
  deactivate the last active admin"
- [ ] Click "Add user" → fill form with valid values → row appears
- [ ] Try to create with bad id (spaces, special chars) → error
- [ ] Try to create with bad email → error

---

## 9. Metrics dashboard (`/metrics`)

- [ ] Loads with the budget banner at the top
- [ ] Progress bar + current spend € / budget €
- [ ] Daily sparkline shows ~14 bars (from demo seed)
- [ ] Cost-by-agent table: extractor, triage, validator, chat-haiku
- [ ] Classifier quality KPIs near bottom (inference %, precedent %,
  etc.) — may be low with synthetic data, OK

---

## 10. Settings

- [ ] `/settings` loads with all 4 cards (System status, Data overview,
  Authentication, Data export, Useful links)
- [ ] All external links open in new tab
- [ ] System status shows all green (Database ok, Storage ok, etc.)

---

## 11. Security / edge

- [ ] Log out → cookie cleared → redirects to `/login`
- [ ] Edit URL to `/entities` while logged out → redirects to login
- [ ] Direct `GET /api/entities` while logged out → 401 JSON
- [ ] `/portal/XYZ` with a garbage token → "Link unavailable"
- [ ] `/portal/` with an expired token → explicit "expired" error
  (hard to test — would need to issue a short-expiry token or wait)
- [ ] CSP blocks unexpected inline script injection (DevTools
  console should show a CSP error if you try to eval something
  unlisted)

---

## 12. Responsive / mobile

- [ ] Resize the window below 768px width
- [ ] Sidebar collapses to hamburger
- [ ] TopBar + search still work
- [ ] Chat drawer goes full-width on small screens
- [ ] Tables scroll horizontally without breaking layout

*(Known-deferred per `deferred_items.md`; partial tolerance expected.)*

---

## 13. Errors + recovery

Deliberately break things and check that the UI stays usable:

- [ ] Stop the dev server mid-flow while a declaration page is open
  → reloading should land on the error boundary with Retry / Home /
  Copy-details buttons
- [ ] Network offline → action fails with a user-visible message
  (not a silent disappearance)
- [ ] Upload a 0-byte PDF → error message explains what happened

---

## Reporting

When you hit something worth fixing, use the **in-product feedback
widget** (floating button bottom-right; ships with the next commit).
For structured issues, open a GitHub issue with:

- URL where you were
- Steps to reproduce (1. / 2. / 3.)
- What you expected vs what happened
- Screenshot if visual

---

## Sign-off

When a full pass is green enough to move on, add a row below with your
name, date, and "🟢 passed" / "🟡 passed with notes" / "🔴 blocked":

| Date | Tester | Status | Notes |
|------|--------|--------|-------|
| _(pending first pass)_ | | | |
