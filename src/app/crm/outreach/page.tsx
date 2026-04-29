// Stint 64.Q.7 — Outreach folded into Opportunities. This page used
// to be a separate cold-prospecting surface (own table
// crm_outreach_prospects, own stages, own list/board views). The
// pipeline merge unified its stages into OPPORTUNITY_STAGES
// (cold_identified, warm, first_touch added at the front), so a
// "prospect graduating from cold to warm" no longer means migrating
// between systems — it's a stage change on a single Opportunity row.
//
// The route is preserved as a server-side redirect so old bookmarks
// + any external links keep working. The /api/crm/outreach endpoints
// also remain (read-only, table empty in prod) until a future cleanup
// stint formally drops them; a 410 in the API would break old clients.

import { redirect } from 'next/navigation';

export default function OutreachRedirectPage(): never {
  redirect('/crm/opportunities');
}
