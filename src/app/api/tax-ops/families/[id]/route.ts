import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/tax-ops/families/[id]  — Family overview for stint 40.P.
//
// Returns:
//   - family: { id, name, is_active, notes, created_at, updated_at }
//   - entities: every active entity in the family, with
//                csp_contacts + obligation counts + status summary
//   - stats:    N entities, M active obligations, filed %, etc.

interface FamilyRow {
  id: string;
  name: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface EntityRow {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  is_active: boolean;
  liquidation_date: string | null;
  csp_contacts: Array<{ name: string; email?: string; role?: string }>;
  obligations_count: number;
  tax_types: string[];
  filings_total: number;
  filings_filed: number;
  latest_activity: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const familyRows = await query<FamilyRow>(
    `SELECT id, name, is_active, notes,
            created_at::text, updated_at::text
       FROM tax_client_groups
      WHERE id = $1`,
    [id],
  );
  if (!familyRows[0]) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const family = familyRows[0];

  const entities = await query<EntityRow>(`
    SELECT e.id, e.legal_name, e.vat_number, e.matricule,
           e.is_active, e.liquidation_date::text,
           COALESCE(e.csp_contacts, '[]'::jsonb) AS csp_contacts,
           (SELECT COUNT(*)::int FROM tax_obligations o
              WHERE o.entity_id = e.id AND o.is_active = TRUE) AS obligations_count,
           (SELECT COALESCE(ARRAY_AGG(DISTINCT o.tax_type ORDER BY o.tax_type), '{}')
              FROM tax_obligations o
              WHERE o.entity_id = e.id AND o.is_active = TRUE) AS tax_types,
           (SELECT COUNT(*)::int FROM tax_filings f
              JOIN tax_obligations o ON o.id = f.obligation_id
             WHERE o.entity_id = e.id) AS filings_total,
           (SELECT COUNT(*)::int FROM tax_filings f
              JOIN tax_obligations o ON o.id = f.obligation_id
             WHERE o.entity_id = e.id
               AND f.status IN ('filed','assessment_received')) AS filings_filed,
           (SELECT GREATEST(MAX(f.updated_at), MAX(o.updated_at), e.updated_at)::text
              FROM tax_obligations o
              LEFT JOIN tax_filings f ON f.obligation_id = o.id
             WHERE o.entity_id = e.id) AS latest_activity
      FROM tax_entities e
     WHERE e.client_group_id = $1
     ORDER BY e.is_active DESC, e.legal_name ASC
  `, [id]);

  const stats = {
    entities_count: entities.length,
    active_entities: entities.filter(e => e.is_active).length,
    obligations_count: entities.reduce((s, e) => s + e.obligations_count, 0),
    filings_total: entities.reduce((s, e) => s + e.filings_total, 0),
    filings_filed: entities.reduce((s, e) => s + e.filings_filed, 0),
    filed_pct: (() => {
      const t = entities.reduce((s, e) => s + e.filings_total, 0);
      const f = entities.reduce((s, e) => s + e.filings_filed, 0);
      return t === 0 ? 0 : Math.round((f / t) * 100);
    })(),
  };

  return NextResponse.json({ family, entities, stats });
}
