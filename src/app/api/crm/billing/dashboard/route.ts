import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/crm/billing/dashboard?year=2025
// Returns aggregated data powering the annual billing dashboard charts:
// top-10 clients, practice area split, monthly trend, aging buckets,
// YoY comparison vs previous year.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const prevYear = year - 1;

  const [kpis, topClients, monthly, practiceSplit, aging, prevKpis] = await Promise.all([
    query<{ total_incl_vat: string; total_paid: string; total_outstanding: string; invoice_count: string }>(
      `SELECT COALESCE(SUM(amount_incl_vat), 0)::text AS total_incl_vat,
              COALESCE(SUM(amount_paid), 0)::text     AS total_paid,
              COALESCE(SUM(outstanding), 0)::text     AS total_outstanding,
              COUNT(*)::text                           AS invoice_count
         FROM crm_billing_invoices
        WHERE EXTRACT(YEAR FROM issue_date) = $1`,
      [year],
    ),
    query<{ company_name: string; total: string; invoice_count: string }>(
      `SELECT c.company_name, SUM(b.amount_incl_vat)::text AS total, COUNT(*)::text AS invoice_count
         FROM crm_billing_invoices b
         JOIN crm_companies c ON c.id = b.company_id
        WHERE EXTRACT(YEAR FROM b.issue_date) = $1
        GROUP BY c.company_name
        ORDER BY SUM(b.amount_incl_vat) DESC
        LIMIT 10`,
      [year],
    ),
    query<{ month: number; total: string }>(
      `SELECT EXTRACT(MONTH FROM issue_date)::int AS month,
              COALESCE(SUM(amount_incl_vat), 0)::text AS total
         FROM crm_billing_invoices
        WHERE EXTRACT(YEAR FROM issue_date) = $1
        GROUP BY EXTRACT(MONTH FROM issue_date)
        ORDER BY month`,
      [year],
    ),
    // Practice split comes via matter. Invoices without a matter are
    // classified as 'unassigned'. When a matter has N practice areas,
    // the invoice revenue is split EQUALLY (1/N) across them — so the
    // sum across all buckets equals total invoiced, no double-counting.
    //
    // Implementation: LATERAL-coalesce the array to a 1-element fallback,
    // then divide by cardinality per row. A matter with ['tax','m_a']
    // contributes 50% to each; a matter with no practice areas (or
    // no matter) contributes 100% to 'unassigned'.
    //
    // (Stint 34 follow-up idea: support per-matter custom weights via a
    //  new practice_area_weights JSONB column — today we assume equal
    //  split, which is the sane default for a PE firm's cross-practice
    //  matters. Diego confirmed 2026-04-24.)
    query<{ practice: string; total: string }>(
      `SELECT practice, SUM(share)::text AS total
         FROM (
           SELECT unnest(areas.arr) AS practice,
                  b.amount_incl_vat / CARDINALITY(areas.arr)::numeric AS share
             FROM crm_billing_invoices b
             LEFT JOIN crm_matters m ON m.id = b.matter_id,
                  LATERAL (
                    SELECT COALESCE(
                      NULLIF(m.practice_areas, '{}'::text[]),
                      ARRAY['unassigned']::text[]
                    ) AS arr
                  ) areas
            WHERE EXTRACT(YEAR FROM b.issue_date) = $1
         ) t
        GROUP BY practice
        ORDER BY SUM(share) DESC`,
      [year],
    ),
    query<{ bucket: string; total: string; count: string }>(
      `WITH buckets AS (
         SELECT CASE
                  WHEN due_date IS NULL THEN 'no_due'
                  WHEN CURRENT_DATE - due_date <= 0 THEN 'not_yet_due'
                  WHEN CURRENT_DATE - due_date <= 30 THEN '0_30'
                  WHEN CURRENT_DATE - due_date <= 60 THEN '31_60'
                  WHEN CURRENT_DATE - due_date <= 90 THEN '61_90'
                  ELSE 'over_90'
                END AS bucket,
                outstanding
           FROM crm_billing_invoices
          WHERE outstanding > 0
       )
       SELECT bucket, SUM(outstanding)::text AS total, COUNT(*)::text AS count
         FROM buckets
        GROUP BY bucket`,
      [],
    ),
    query<{ total_incl_vat: string }>(
      `SELECT COALESCE(SUM(amount_incl_vat), 0)::text AS total_incl_vat
         FROM crm_billing_invoices
        WHERE EXTRACT(YEAR FROM issue_date) = $1`,
      [prevYear],
    ),
  ]);

  return NextResponse.json({
    year,
    prev_year: prevYear,
    kpis: kpis[0] ?? null,
    prev_kpis: prevKpis[0] ?? null,
    top_clients: topClients,
    monthly,  // sparse — fill missing months client-side
    practice_split: practiceSplit,
    aging,    // bucket counts
  });
}
