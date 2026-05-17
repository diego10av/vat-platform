import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/crm/key-accounts/health
//
// Relational-health snapshot of every Key Account. For a LU PE law
// firm, the 5-15 Key Accounts are the lifeblood — partners need to
// see at a glance which ones are getting warm attention and which
// are drifting toward dormant status.
//
// For each company with classification='key_account':
//   - Most recent activity date (via any linked contact → junction
//     → activity; or direct company_id on activity)
//   - Open opportunities count + total pipeline value
//   - Open matters count (status IN active/on_hold)
//   - Outstanding invoice balance
//   - Risk badge derived server-side from days-since-activity
//
// Single query keeps the widget fast — no N+1.
export async function GET() {
  const rows = await query<{
    id: string;
    company_name: string;
    last_touched: string | null;
    open_opps_count: string;
    pipeline_value: string;
    open_matters_count: string;
    outstanding_total: string;
  }>(
    `WITH ka AS (
       SELECT id, company_name
         FROM crm_companies
        WHERE classification = 'key_account'
     ),
     last_act AS (
       SELECT co.id AS company_id,
              MAX(GREATEST(
                COALESCE(a.activity_date, '1970-01-01'::date),
                COALESCE(a2.activity_date, '1970-01-01'::date)
              )) AS last_touched
         FROM ka co
         LEFT JOIN crm_activities a ON a.company_id = co.id
         LEFT JOIN crm_contact_companies cc ON cc.company_id = co.id
         LEFT JOIN crm_activity_contacts ac ON ac.contact_id = cc.contact_id
         LEFT JOIN crm_activities a2 ON a2.id = ac.activity_id
        GROUP BY co.id
     ),
     opps AS (
       SELECT company_id,
              COUNT(*) AS open_opps_count,
              COALESCE(SUM(estimated_value_eur), 0) AS pipeline_value
         FROM crm_opportunities
        WHERE stage NOT IN ('won','lost')
        GROUP BY company_id
     ),
     matters AS (
       SELECT client_company_id AS company_id, COUNT(*) AS open_matters_count
         FROM crm_matters
        WHERE status IN ('active', 'on_hold')
        GROUP BY client_company_id
     ),
     outstanding AS (
       SELECT company_id, COALESCE(SUM(outstanding), 0) AS outstanding_total
         FROM crm_billing_invoices
        WHERE outstanding > 0
        GROUP BY company_id
     )
     SELECT ka.id, ka.company_name,
            CASE WHEN la.last_touched = '1970-01-01'::date THEN NULL
                 ELSE la.last_touched::text
            END AS last_touched,
            COALESCE(o.open_opps_count, 0)::text      AS open_opps_count,
            COALESCE(o.pipeline_value, 0)::text       AS pipeline_value,
            COALESCE(m.open_matters_count, 0)::text   AS open_matters_count,
            COALESCE(os.outstanding_total, 0)::text   AS outstanding_total
       FROM ka
       LEFT JOIN last_act la   ON la.company_id = ka.id
       LEFT JOIN opps o        ON o.company_id  = ka.id
       LEFT JOIN matters m     ON m.company_id  = ka.id
       LEFT JOIN outstanding os ON os.company_id = ka.id
      ORDER BY la.last_touched ASC NULLS FIRST, ka.company_name`,
  );

  // Compute risk badge server-side so the widget is pure presentation.
  const now = Date.now();
  const accounts = rows.map(r => {
    const lastTouchedMs = r.last_touched ? new Date(r.last_touched).getTime() : null;
    const daysSince = lastTouchedMs !== null
      ? Math.floor((now - lastTouchedMs) / (1000 * 60 * 60 * 24))
      : null;
    let risk: 'green' | 'amber' | 'red';
    if (daysSince === null) risk = 'red';         // never touched
    else if (daysSince <= 14) risk = 'green';
    else if (daysSince <= 60) risk = 'amber';
    else risk = 'red';
    return {
      id: r.id,
      company_name: r.company_name,
      last_touched: r.last_touched,
      days_since_touch: daysSince,
      open_opps_count: Number(r.open_opps_count),
      pipeline_value: Number(r.pipeline_value),
      open_matters_count: Number(r.open_matters_count),
      outstanding_total: Number(r.outstanding_total),
      risk,
    };
  });

  return NextResponse.json({
    accounts,
    total_pipeline: accounts.reduce((s, a) => s + a.pipeline_value, 0),
    total_outstanding: accounts.reduce((s, a) => s + a.outstanding_total, 0),
    at_risk_count: accounts.filter(a => a.risk === 'red').length,
    warming_count: accounts.filter(a => a.risk === 'amber').length,
  });
}
