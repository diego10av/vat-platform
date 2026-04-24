import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET /api/tax-ops/matrix
//   Returns a rectangular shape: entities × periods with per-period
//   filing metadata. Powers the tax-type-category pages (CIT, NWT, VAT
//   annual/quarterly/monthly, WHT, subscription-tax, BCL, other).
//
// Query params:
//   tax_type        REQUIRED  e.g. cit_annual, vat_quarterly
//   year            REQUIRED  integer, period_year to render
//   period_pattern  OPTIONAL  annual | quarterly | monthly | semester
//                             Defaults to pattern implied by tax_type
//                             (cit_annual→annual, vat_quarterly→quarterly)
//   service_kind    OPTIONAL  filing (default) | review
//                             Passing 'review' narrows to advisory obligs
//                             and skips filing-specific filters.
//   show_inactive   OPTIONAL  '1' to include entities without this obligation
//                             (useful on /tax-ops/nwt to see who could opt in)
//
// Response shape:
//   {
//     year: 2025,
//     period_labels: ['2025-Q1', '2025-Q2', …],   // ordered columns
//     entities: [
//       {
//         id, legal_name, group_name, group_id,
//         obligation_id | null,
//         cells: { [period_label]: FilingCell | null }
//       }
//     ]
//   }
//
// FilingCell: {
//   filing_id, status, deadline_date, assigned_to, comments, filed_at,
//   draft_sent_at, tax_assessment_received_at, amount_due, amount_paid
// }
//
// The frontend just renders — no dedup / pivoting / grouping happens here.
// ════════════════════════════════════════════════════════════════════════

const PATTERN_OF = (tax_type: string): string => {
  if (tax_type.endsWith('_quarterly')) return 'quarterly';
  if (tax_type.endsWith('_monthly')) return 'monthly';
  if (tax_type.endsWith('_semester')) return 'semester';
  return 'annual';
};

function periodLabelsFor(pattern: string, year: number): string[] {
  if (pattern === 'annual')   return [String(year)];
  if (pattern === 'quarterly') return ['Q1', 'Q2', 'Q3', 'Q4'].map(q => `${year}-${q}`);
  if (pattern === 'monthly') {
    return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  }
  if (pattern === 'semester') return [`${year}-S1`, `${year}-S2`];
  return [];  // adhoc
}

interface MatrixCell {
  filing_id: string;
  status: string;
  deadline_date: string | null;
  assigned_to: string | null;
  comments: string | null;
  filed_at: string | null;
  draft_sent_at: string | null;
  tax_assessment_received_at: string | null;
  amount_due: string | null;
  amount_paid: string | null;
  prepared_with: string[];
  /** Stint 39.F — last chase date to client/CSP for this filing. */
  last_info_request_sent_at: string | null;
}

interface EntityRow {
  id: string;
  legal_name: string;
  group_id: string | null;
  group_name: string | null;
  obligation_id: string | null;
  cells: Record<string, MatrixCell | null>;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tax_type = url.searchParams.get('tax_type');
  const yearStr = url.searchParams.get('year');
  const period_pattern = url.searchParams.get('period_pattern') ?? (tax_type ? PATTERN_OF(tax_type) : 'annual');
  const service_kind = url.searchParams.get('service_kind') ?? 'filing';
  const showInactive = url.searchParams.get('show_inactive') === '1';

  if (!tax_type || !yearStr) {
    return NextResponse.json({ error: 'tax_type_and_year_required' }, { status: 400 });
  }
  const year = Number(yearStr);
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: 'invalid_year' }, { status: 400 });
  }

  const periodLabels = periodLabelsFor(period_pattern, year);

  // Fetch admin tolerance for this (tax_type, period_pattern) rule — used by
  // the UI to render "within tolerance" vs "overdue" states on DeadlineBadge.
  const ruleRows = await query<{ admin_tolerance_days: number }>(
    `SELECT admin_tolerance_days FROM tax_deadline_rules
      WHERE tax_type = $1 AND period_pattern = $2
      LIMIT 1`,
    [tax_type, period_pattern],
  );
  const adminToleranceDays = ruleRows[0]?.admin_tolerance_days ?? 0;

  // Base entity set:
  //   - When showInactive=1: every active entity (so Diego can opt-in a new one from the UI).
  //   - When showInactive=0 (default): only entities that have an ACTIVE obligation
  //     of this (tax_type, period_pattern, service_kind).
  const entityQuery = showInactive
    ? `
      SELECT e.id, e.legal_name,
             g.id AS group_id, g.name AS group_name,
             (SELECT o.id
                FROM tax_obligations o
               WHERE o.entity_id = e.id
                 AND o.tax_type = $1
                 AND o.period_pattern = $2
                 AND o.service_kind = $3
                 AND o.is_active = TRUE
               LIMIT 1) AS obligation_id
        FROM tax_entities e
        LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       WHERE e.is_active = TRUE
       ORDER BY g.name ASC NULLS LAST, e.legal_name ASC
      `
    : `
      SELECT e.id, e.legal_name,
             g.id AS group_id, g.name AS group_name,
             o.id AS obligation_id
        FROM tax_obligations o
        JOIN tax_entities e ON e.id = o.entity_id
        LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       WHERE o.tax_type = $1
         AND o.period_pattern = $2
         AND o.service_kind = $3
         AND o.is_active = TRUE
         AND e.is_active = TRUE
       ORDER BY g.name ASC NULLS LAST, e.legal_name ASC
      `;

  const entities = await query<{
    id: string; legal_name: string;
    group_id: string | null; group_name: string | null;
    obligation_id: string | null;
  }>(entityQuery, [tax_type, period_pattern, service_kind]);

  // Load every filing for these (obligation, period_label) pairs in one round-trip.
  const obligationIds = entities.map(e => e.obligation_id).filter((x): x is string => !!x);
  let filingRows: Array<{
    obligation_id: string; period_label: string;
    filing_id: string; status: string; deadline_date: string | null;
    assigned_to: string | null; comments: string | null;
    filed_at: string | null; draft_sent_at: string | null;
    tax_assessment_received_at: string | null;
    amount_due: string | null; amount_paid: string | null;
    prepared_with: string[];
    last_info_request_sent_at: string | null;
  }> = [];

  if (obligationIds.length > 0 && periodLabels.length > 0) {
    filingRows = await query(
      `SELECT f.obligation_id, f.period_label,
              f.id AS filing_id, f.status, f.deadline_date::text,
              f.assigned_to, f.comments,
              f.filed_at::text, f.draft_sent_at::text,
              f.tax_assessment_received_at::text,
              f.amount_due::text, f.amount_paid::text,
              f.prepared_with,
              f.last_info_request_sent_at::text AS last_info_request_sent_at
         FROM tax_filings f
        WHERE f.obligation_id = ANY($1::text[])
          AND f.period_label = ANY($2::text[])`,
      [obligationIds, periodLabels],
    );
  }

  // Index filings by (obligation_id, period_label).
  const filingIndex = new Map<string, MatrixCell>();
  for (const f of filingRows) {
    filingIndex.set(`${f.obligation_id}|${f.period_label}`, {
      filing_id: f.filing_id,
      status: f.status,
      deadline_date: f.deadline_date,
      assigned_to: f.assigned_to,
      comments: f.comments,
      filed_at: f.filed_at,
      draft_sent_at: f.draft_sent_at,
      tax_assessment_received_at: f.tax_assessment_received_at,
      amount_due: f.amount_due,
      amount_paid: f.amount_paid,
      prepared_with: f.prepared_with ?? [],
      last_info_request_sent_at: f.last_info_request_sent_at,
    });
  }

  // Assemble the matrix.
  const rows: EntityRow[] = entities.map(e => {
    const cells: Record<string, MatrixCell | null> = {};
    for (const label of periodLabels) {
      cells[label] = e.obligation_id
        ? (filingIndex.get(`${e.obligation_id}|${label}`) ?? null)
        : null;
    }
    return {
      id: e.id,
      legal_name: e.legal_name,
      group_id: e.group_id,
      group_name: e.group_name,
      obligation_id: e.obligation_id,
      cells,
    };
  });

  return NextResponse.json({
    year,
    tax_type,
    period_pattern,
    service_kind,
    admin_tolerance_days: adminToleranceDays,
    period_labels: periodLabels,
    entities: rows,
  });
}
