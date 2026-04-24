import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit } from '@/lib/db';

// ════════════════════════════════════════════════════════════════════════
// GET  /api/tax-ops/filings    — list with filters + sort + pagination
// PATCH /api/tax-ops/filings   — bulk update (set status, assignee,
//                                 filed_at) for array of filing ids
//
// Filters (all optional, all AND'd):
//   ?year=2026
//   ?tax_type=cit_annual
//   ?status=pending_info          (multi-values: repeat the param)
//   ?group_id=<uuid>              (client_group_id)
//   ?entity_id=<uuid>
//   ?assigned_to=<short_name>
//   ?prepared_with=<short_name>
//   ?overdue=1                     (deadline past, not filed/paid/waived)
//   ?q=<legal_name fragment>
//
// Pagination: ?page=0&page_size=50 (default 50, max 250).
// Sort: ?sort=deadline|entity|status|tax_type  ?dir=asc|desc
// ════════════════════════════════════════════════════════════════════════

interface FilingListRow {
  id: string;
  obligation_id: string;
  entity_id: string;
  entity_name: string;
  group_id: string | null;
  group_name: string | null;
  tax_type: string;
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  prepared_with: string[];
  csp_count: number;
  comments_preview: string | null;
  filed_at: string | null;
  draft_sent_at: string | null;
}

const SORT_COLS: Record<string, string> = {
  deadline:  'f.deadline_date',
  entity:    'e.legal_name',
  status:    'f.status',
  tax_type:  'o.tax_type',
  period:    'f.period_label',
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const year = url.searchParams.get('year');
  const taxType = url.searchParams.get('tax_type');
  const statusVals = url.searchParams.getAll('status');
  const groupId = url.searchParams.get('group_id');
  const entityId = url.searchParams.get('entity_id');
  const assignedTo = url.searchParams.get('assigned_to');
  const preparedWith = url.searchParams.get('prepared_with');
  const overdue = url.searchParams.get('overdue') === '1';
  const q = url.searchParams.get('q')?.trim() ?? '';
  const sortKey = url.searchParams.get('sort') ?? 'deadline';
  const dir = url.searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC';
  const page = Math.max(0, Number(url.searchParams.get('page') ?? 0));
  const pageSize = Math.min(250, Math.max(1, Number(url.searchParams.get('page_size') ?? 50)));

  const sortCol = SORT_COLS[sortKey] ?? SORT_COLS.deadline;

  const where: string[] = ['e.is_active = TRUE'];
  const params: unknown[] = [];
  let pi = 1;

  if (year) { where.push(`f.period_year = $${pi}`); params.push(Number(year)); pi += 1; }
  if (taxType) { where.push(`o.tax_type = $${pi}`); params.push(taxType); pi += 1; }
  if (statusVals.length > 0) { where.push(`f.status = ANY($${pi}::text[])`); params.push(statusVals); pi += 1; }
  if (groupId) { where.push(`e.client_group_id = $${pi}`); params.push(groupId); pi += 1; }
  if (entityId) { where.push(`e.id = $${pi}`); params.push(entityId); pi += 1; }
  if (assignedTo) { where.push(`f.assigned_to = $${pi}`); params.push(assignedTo); pi += 1; }
  if (preparedWith) { where.push(`$${pi} = ANY(f.prepared_with)`); params.push(preparedWith); pi += 1; }
  if (overdue) { where.push(`f.deadline_date < CURRENT_DATE AND f.status NOT IN ('filed','paid','waived')`); }
  if (q) {
    where.push(`(e.legal_name ILIKE $${pi} OR g.name ILIKE $${pi} OR f.period_label ILIKE $${pi})`);
    params.push(`%${q}%`); pi += 1;
  }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query<FilingListRow>(
    `SELECT f.id, f.obligation_id,
            e.id AS entity_id, e.legal_name AS entity_name,
            g.id AS group_id, g.name AS group_name,
            o.tax_type, f.period_year, f.period_label,
            f.deadline_date::text AS deadline_date,
            f.status, f.assigned_to, f.prepared_with,
            COALESCE(JSONB_ARRAY_LENGTH(
              CASE WHEN JSONB_ARRAY_LENGTH(f.csp_contacts) > 0
                   THEN f.csp_contacts ELSE e.csp_contacts END
            ), 0) AS csp_count,
            LEFT(f.comments, 120) AS comments_preview,
            f.filed_at::text AS filed_at,
            f.draft_sent_at::text AS draft_sent_at
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities e    ON e.id = o.entity_id
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       ${whereSQL}
      ORDER BY ${sortCol} ${dir} NULLS LAST, e.legal_name ASC
      LIMIT ${pageSize} OFFSET ${page * pageSize}`,
    params,
  );

  const totalRow = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n
       FROM tax_filings f
       JOIN tax_obligations o ON o.id = f.obligation_id
       JOIN tax_entities e    ON e.id = o.entity_id
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       ${whereSQL}`,
    params,
  );

  return NextResponse.json({
    filings: rows,
    total: Number(totalRow[0]?.n ?? 0),
    page,
    page_size: pageSize,
  });
}

// Bulk update. Body: { ids: string[], patch: { status?, assigned_to?,
// filed_at?, comments? } }. Returns { updated: N }.
export async function PATCH(request: NextRequest) {
  const body = await request.json() as { ids?: unknown; patch?: unknown };
  const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).filter(v => typeof v === 'string') as string[] : [];
  const patch = (body.patch && typeof body.patch === 'object') ? body.patch as Record<string, unknown> : {};
  if (ids.length === 0) {
    return NextResponse.json({ error: 'missing_ids' }, { status: 400 });
  }

  const ALLOWED = ['status', 'assigned_to', 'filed_at', 'draft_sent_at',
                   'client_approved_at', 'tax_assessment_received_at',
                   'paid_at', 'amount_due', 'amount_paid', 'comments'];
  const sets: string[] = [];
  const values: unknown[] = [];
  let pi = 1;
  for (const field of ALLOWED) {
    if (field in patch) {
      sets.push(`${field} = $${pi}`);
      values.push(patch[field]);
      pi += 1;
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  }
  sets.push('updated_at = NOW()');
  values.push(ids);
  await execute(
    `UPDATE tax_filings SET ${sets.join(', ')} WHERE id = ANY($${pi}::text[])`,
    values,
  );

  await logAudit({
    userId: 'founder',
    action: 'tax_filings_bulk_patch',
    targetType: 'tax_filings',
    targetId: ids.join(','),
    newValue: JSON.stringify(patch),
  });

  return NextResponse.json({ updated: ids.length });
}
