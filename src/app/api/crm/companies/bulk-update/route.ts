import { NextRequest, NextResponse } from 'next/server';
import { execute, query, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// POST /api/crm/companies/bulk-update
//
// Stint 63.E (2026-04-28). Bulk patch a list of companies in one
// request. Diego's BulkEditDrawer in /crm/companies opens this
// endpoint with `{ ids, patch }`. Server validates each field against
// a strict whitelist (a subset of the per-id PUT whitelist — only the
// fields that make sense to bulk-edit).
//
// Audit-log: one row per company, per changed field. Mirrors the
// per-id PUT behaviour so the History panel of each company shows
// the bulk operation as if Diego had edited each one individually.

const ALLOWED_FIELDS = [
  'classification', 'country', 'industry', 'size', 'lead_counsel',
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

  // Snapshot before-state for the audit log.
  const beforeRows = await query<Record<string, unknown> & { id: string }>(
    `SELECT id, classification, country, industry, size, lead_counsel
       FROM crm_companies
      WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    [ids],
  );
  const beforeById = new Map<string, Record<string, unknown>>();
  for (const row of beforeRows) beforeById.set(row.id, row);

  // Build the UPDATE.
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
    `UPDATE crm_companies
        SET ${setClauses.join(', ')}
      WHERE id = ANY($1::text[]) AND deleted_at IS NULL`,
    values,
  );

  // Per-id, per-field audit row — only when the value actually changed.
  for (const id of ids) {
    const before = beforeById.get(id);
    if (!before) continue;
    for (const k of Object.keys(cleanPatch) as AllowedField[]) {
      const oldVal = before[k] ?? null;
      const newVal = cleanPatch[k] ?? null;
      if (String(oldVal ?? '') === String(newVal ?? '')) continue;
      await logAudit({
        action: 'bulk_update',
        targetType: 'crm_company',
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
