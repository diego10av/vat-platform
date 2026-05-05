// Stint 64.X.4.b — `/` (the post-sign-in landing on app.cifracompliance.com)
// now redirects to `/tax-ops`.
//
// Diego (2026-04-30) reported the strange screenshot after sign-in: it
// was the legacy stint-12 VAT-only home — "Welcome to cifra · No
// clients yet · Load demo data" — written before the Tax-Ops + CRM
// pivot. That page reads from the old `clients / declarations /
// invoices` schema; Diego works in `tax_entities / tax_obligations /
// tax_filings` and `crm_*`, so the page reports zeroes for everything
// even when Diego has 140 entities + an active task pipeline. It also
// shows an onboarding banner that no longer applies.
//
// The real operational landing is `/tax-ops`: actionable widgets
// (TasksDue / StuckFollowUps / filings radar) + the 6-card category
// grid. Server-side redirect = the URL bar updates from `/` to
// `/tax-ops` cleanly + the middleware's session check still runs
// before this component, so unauthenticated visits still bounce to
// `/login` (preserving the `?next=/tax-ops` flow shipped in 64.X.4).
//
// Stint 67.E (2026-05-05) — the 843-line legacy home that lived at
// /legacy-home was deleted. It read from the pre-pivot
// clients/declarations/invoices schema and rendered zeroes against
// today's tax_entities/tax_obligations/tax_filings world; keeping it
// around was confusing for future readers without adding any value.
// If a future stint needs the historical layout it lives in git
// history at commit f3c929e (stint 64.X.4.b).

import { redirect } from 'next/navigation';

export default function HomeRedirect(): never {
  redirect('/tax-ops');
}
