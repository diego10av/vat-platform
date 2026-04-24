import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, buildUpdate } from '@/lib/db';

// GET  /api/tax-ops/entities/[id] — identity + obligations + multi-year
//                                    filings history grouped by year
// PATCH /api/tax-ops/entities/[id] — partial update

interface EntityDetailRow {
  id: string;
  legal_name: string;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  is_active: boolean;
  liquidation_date: string | null;
  group_id: string | null;
  group_name: string | null;
  csp_contacts: Array<{ name: string; email?: string; role?: string }>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface EntityObligation {
  id: string;
  tax_type: string;
  period_pattern: string;
  is_active: boolean;
  default_assignee: string | null;
  notes: string | null;
}

interface EntityFiling {
  id: string;
  obligation_id: string;
  tax_type: string;
  period_year: number;
  period_label: string;
  deadline_date: string | null;
  status: string;
  assigned_to: string | null;
  filed_at: string | null;
  tax_assessment_received_at: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const [entity, obligations, filings] = await Promise.all([
    query<EntityDetailRow>(
      `SELECT e.id, e.legal_name, e.vat_number, e.matricule, e.rcs_number,
              e.is_active, e.liquidation_date::text,
              g.id AS group_id, g.name AS group_name,
              e.csp_contacts, e.notes,
              e.created_at::text, e.updated_at::text
         FROM tax_entities e
         LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
        WHERE e.id = $1`,
      [id],
    ),
    query<EntityObligation>(
      `SELECT id, tax_type, period_pattern, is_active, default_assignee, notes
         FROM tax_obligations
        WHERE entity_id = $1
        ORDER BY tax_type, period_pattern`,
      [id],
    ),
    query<EntityFiling>(
      `SELECT f.id, f.obligation_id, o.tax_type,
              f.period_year, f.period_label,
              f.deadline_date::text, f.status, f.assigned_to,
              f.filed_at::text, f.tax_assessment_received_at::text
         FROM tax_filings f
         JOIN tax_obligations o ON o.id = f.obligation_id
        WHERE o.entity_id = $1
        ORDER BY f.period_year DESC, o.tax_type, f.period_label`,
      [id],
    ),
  ]);

  if (!entity[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return NextResponse.json({
    entity: entity[0],
    obligations,
    filings,
  });
}

const ALLOWED_FIELDS = [
  'legal_name', 'client_group_id', 'vat_number', 'matricule', 'rcs_number',
  'is_active', 'liquidation_date', 'csp_contacts', 'notes',
] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as Record<string, unknown>;
  const { sql, values, changes } = buildUpdate(
    'tax_entities', ALLOWED_FIELDS, body, 'id', id, ['updated_at = NOW()'],
  );
  if (!sql) return NextResponse.json({ error: 'empty_patch' }, { status: 400 });
  await execute(sql, values);
  await logAudit({
    userId: 'founder',
    action: 'tax_entity_update',
    targetType: 'tax_entity',
    targetId: id,
    newValue: JSON.stringify(changes),
  });
  return NextResponse.json({ ok: true });
}
