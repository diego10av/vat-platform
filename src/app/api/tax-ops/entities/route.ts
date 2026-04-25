import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';

// GET  /api/tax-ops/entities
//   ?year=2026&q=<name>&group_id=<id>&is_active=1
//   Returns: { entities: [...], groups: [...] } — grouped client-side.
// POST /api/tax-ops/entities  — create new entity
//
// Each entity carries:
//   - obligations_count (active)
//   - filings_pct_filed_ytd (of YTD filings, % with status='filed')
//   - last_assessment_year (most recent tax_assessment_received_at year)

interface EntityListRow {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  is_active: boolean;
  liquidation_date: string | null;
  group_id: string | null;
  group_name: string | null;
  csp_count: number;
  obligations_count: number;
  filings_ytd: number;
  filings_filed_ytd: number;
  last_assessment_year: number | null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get('year') ?? new Date().getFullYear());
  const q = url.searchParams.get('q')?.trim() ?? '';
  const groupId = url.searchParams.get('group_id');
  const isActiveParam = url.searchParams.get('is_active');
  const isActive = isActiveParam === '0' ? false : true;  // default active only

  const where: string[] = [];
  const params: unknown[] = [year];  // $1 fixed
  let pi = 2;

  if (isActiveParam !== null) {
    where.push(`e.is_active = $${pi}`);
    params.push(isActive); pi += 1;
  } else {
    where.push(`e.is_active = TRUE`);
  }
  if (groupId) { where.push(`e.client_group_id = $${pi}`); params.push(groupId); pi += 1; }
  if (q) { where.push(`(e.legal_name ILIKE $${pi} OR e.vat_number ILIKE $${pi})`); params.push(`%${q}%`); pi += 1; }

  const whereSQL = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const entities = await query<EntityListRow>(
    `SELECT e.id, e.legal_name, e.vat_number, e.matricule, e.rcs_number, e.is_active,
            e.liquidation_date::text AS liquidation_date,
            g.id AS group_id, g.name AS group_name,
            JSONB_ARRAY_LENGTH(e.csp_contacts) AS csp_count,
            (SELECT COUNT(*)::int FROM tax_obligations o
              WHERE o.entity_id = e.id AND o.is_active) AS obligations_count,
            (SELECT COUNT(*)::int FROM tax_filings f
              JOIN tax_obligations o2 ON o2.id = f.obligation_id
              WHERE o2.entity_id = e.id AND f.period_year = $1) AS filings_ytd,
            (SELECT COUNT(*)::int FROM tax_filings f
              JOIN tax_obligations o2 ON o2.id = f.obligation_id
              WHERE o2.entity_id = e.id AND f.period_year = $1
                AND f.status IN ('filed','paid','assessment_received')) AS filings_filed_ytd,
            (SELECT EXTRACT(YEAR FROM MAX(f.tax_assessment_received_at))::int
               FROM tax_filings f
               JOIN tax_obligations o3 ON o3.id = f.obligation_id
              WHERE o3.entity_id = e.id) AS last_assessment_year
       FROM tax_entities e
       LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
       ${whereSQL}
      ORDER BY g.name ASC NULLS LAST, e.legal_name ASC`,
    params,
  );

  const groups = await query<{ id: string; name: string; is_active: boolean; entity_count: number }>(
    `SELECT g.id, g.name, g.is_active,
            (SELECT COUNT(*)::int FROM tax_entities e
              WHERE e.client_group_id = g.id AND e.is_active = TRUE) AS entity_count
       FROM tax_client_groups g
      WHERE g.is_active = TRUE
      ORDER BY g.name ASC`,
  );

  return NextResponse.json({ entities, groups, year });
}

export async function POST(request: NextRequest) {
  const body = await request.json() as {
    legal_name?: string;
    client_group_id?: string | null;
    vat_number?: string | null;
    matricule?: string | null;
    rcs_number?: string | null;
    notes?: string | null;
    csp_contacts?: Array<{ name: string; email?: string; role?: string }>;
  };
  if (!body.legal_name?.trim()) {
    return NextResponse.json({ error: 'legal_name_required' }, { status: 400 });
  }
  const id = generateId();
  await execute(
    `INSERT INTO tax_entities (id, legal_name, client_group_id, vat_number, matricule, rcs_number, notes, csp_contacts)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      id, body.legal_name.trim(),
      body.client_group_id ?? null,
      body.vat_number ?? null,
      body.matricule ?? null,
      body.rcs_number ?? null,
      body.notes ?? null,
      JSON.stringify(body.csp_contacts ?? []),
    ],
  );
  await logAudit({
    userId: 'founder',
    action: 'tax_entity_create',
    targetType: 'tax_entity',
    targetId: id,
    newValue: JSON.stringify({ legal_name: body.legal_name }),
  });
  return NextResponse.json({ id });
}
