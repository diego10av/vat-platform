import { NextRequest, NextResponse } from 'next/server';
import { execute, query, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// POST /api/crm/contacts/bulk-update
//
// Stint 63.E. Bulk patch contacts. Mirror of the companies bulk-update
// endpoint with a contacts-specific ALLOWED_FIELDS whitelist.
//
// Audit-log: one row per contact, per changed field.

const ALLOWED_FIELDS = [
  'lifecycle_stage', 'country', 'source', 'engagement_override',
  'preferred_language',
] as const;
type AllowedField = typeof ALLOWED_FIELDS[number];

interface Body {
  ids?: unknown;
  patch?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json().catch(() => ({})) as Body;
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === 'string')
    : [];
  if (ids.length === 0) {
    return apiError('ids_required', 'ids must be a non-empty array.', { status: 400 });
  }
  if (!body.patch || typeof body.patch !== 'object') {
    return apiError('patch_required', 'patch must be an object.', { status: 400 });
  }
  const patchInput = body.patch as Record<string, unknown>;

  const cleanPatch: Partial<Record<AllowedField, unknown>> = {};
  for (const k of Object.keys(patchInput)) {
    if (!(ALLOWED_FIELDS as readonly string[]).includes(k)) {
      return apiError(
        'field_not_patchable',
        `Field "${k}" is not patchable in bulk.`,
        { status: 400 },
      );
    }
    let v = patchInput[k];
    if (typeof v === 'string') v = v.trim() || null;
    cleanPatch[k as AllowedField] = v;
  }
  if (Object.keys(cleanPatch).length === 0) {
    return apiError('patch_empty', 'patch is empty.', { status: 400 });
  }

  const beforeRows = await query<Record<string, unknown> & { id: string }>(
    `SELECT id, lifecycle_stage, country, source, engagement_override, preferred_language
       FROM crm_contacts
      WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    [ids],
  );
  const beforeById = new Map<string, Record<string, unknown>>();
  for (const row of beforeRows) beforeById.set(row.id, row);

  const setClauses: string[] = [];
  const values: unknown[] = [ids];
  let idx = 2;
  for (const k of Object.keys(cleanPatch) as AllowedField[]) {
    setClauses.push(`${k} = $${idx}`);
    values.push(cleanPatch[k]);
    idx += 1;
  }
  setClauses.push(`updated_at = NOW()`);

  await execute(
    `UPDATE crm_contacts
        SET ${setClauses.join(', ')}
      WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    values,
  );

  for (const id of ids) {
    const before = beforeById.get(id);
    if (!before) continue;
    for (const k of Object.keys(cleanPatch) as AllowedField[]) {
      const oldVal = before[k] ?? null;
      const newVal = cleanPatch[k] ?? null;
      if (String(oldVal ?? '') === String(newVal ?? '')) continue;
      await logAudit({
        action: 'bulk_update',
        targetType: 'crm_contact',
        targetId: id,
        field: k,
        oldValue: String(oldVal ?? ''),
        newValue: String(newVal ?? ''),
      });
    }
  }

  return NextResponse.json({
    affected: beforeRows.length,
    fields: Object.keys(cleanPatch),
  });
}
