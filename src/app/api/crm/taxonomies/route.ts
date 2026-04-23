import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// Supported taxonomy kinds. Locking this set prevents typos from
// creating stray "kind" values that wouldn't surface anywhere.
const KINDS = new Set([
  'country', 'industry', 'practice_area', 'fee_type',
  'role_tag', 'source', 'loss_reason',
]);

// GET /api/crm/taxonomies?kind=country[&include_archived=1]
//
// When `kind` is set, returns the single-kind list (what a dropdown
// consumes). When omitted, returns all kinds grouped.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const includeArchived = url.searchParams.get('include_archived') === '1';

  if (kind && !KINDS.has(kind)) {
    return apiError('invalid_kind', `kind must be one of: ${[...KINDS].join(', ')}`, { status: 400 });
  }

  const cond = kind
    ? (includeArchived ? `kind = $1` : `kind = $1 AND archived = FALSE`)
    : (includeArchived ? '1=1' : 'archived = FALSE');
  const params = kind ? [kind] : [];

  const rows = await query<{
    id: string; kind: string; value: string; label: string;
    sort_order: number; is_system: boolean; archived: boolean;
  }>(
    `SELECT id, kind, value, label, sort_order, is_system, archived
       FROM crm_taxonomies
      WHERE ${cond}
      ORDER BY kind, sort_order, label`,
    params,
  );
  return NextResponse.json(kind ? rows : groupByKind(rows));
}

function groupByKind(rows: { kind: string }[]): Record<string, typeof rows> {
  const out: Record<string, typeof rows> = {};
  for (const r of rows) {
    if (!out[r.kind]) out[r.kind] = [];
    out[r.kind].push(r);
  }
  return out;
}

// POST — create a new (user-added) taxonomy value.
// Body: { kind, value, label, sort_order? }
// Value must be lowercase-snake-style; we enforce lightly with a regex.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const kind = typeof body.kind === 'string' ? body.kind : '';
  const value = typeof body.value === 'string' ? body.value.trim() : '';
  const label = typeof body.label === 'string' ? body.label.trim() : '';

  if (!KINDS.has(kind)) {
    return apiError('invalid_kind', `kind must be one of: ${[...KINDS].join(', ')}`, { status: 400 });
  }
  if (!value) return apiError('value_required', 'value is required', { status: 400 });
  if (!label) return apiError('label_required', 'label is required', { status: 400 });
  // Values we route in URLs / store in columns should be slug-ish.
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return apiError('value_format', 'value must use letters/numbers/underscores/dashes only.', { status: 400 });
  }

  const id = generateId();
  const sortOrder = typeof body.sort_order === 'number' ? body.sort_order : 100;

  try {
    await execute(
      `INSERT INTO crm_taxonomies (id, kind, value, label, sort_order, is_system)
       VALUES ($1, $2, $3, $4, $5, FALSE)`,
      [id, kind, value, label, sortOrder],
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'insert failed';
    if (msg.includes('unique')) {
      return apiError('duplicate', `A value '${value}' already exists for ${kind}.`, { status: 409 });
    }
    throw e;
  }

  await logAudit({
    action: 'taxonomy_added',
    targetType: 'crm_taxonomy',
    targetId: id,
    field: kind,
    newValue: `${value} (${label})`,
    reason: `New ${kind} option: ${label}`,
  });
  return NextResponse.json({ id, kind, value, label, sort_order: sortOrder });
}
