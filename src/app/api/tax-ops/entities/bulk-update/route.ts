import { NextRequest, NextResponse } from 'next/server';
import { tx, qTx, execTx, logAuditTx } from '@/lib/db';

// POST /api/tax-ops/entities/bulk-update
//
// Stint 42 cleanup-batch — Diego's bulk-ops on /tax-ops/entities.
// Body: {
//   entity_ids: string[],
//   patch: { client_group_id?, is_active?, liquidation_date? }
// }
//
// Strict whitelist of patchable fields. Anything else is rejected.
// Runs in a single transaction; emits one audit_log row per entity
// (so the per-entity timeline / global audit view see what happened).
//
// Reuse-context: this endpoint complements the per-entity PATCH
// at /api/tax-ops/entities/[id]; the bulk path is faster + atomic
// when Diego archives a batch of liquidations or moves several
// entities to a new family.

const ALLOWED_FIELDS = ['client_group_id', 'is_active', 'liquidation_date'] as const;
type AllowedField = typeof ALLOWED_FIELDS[number];

interface Body {
  entity_ids?: unknown;
  patch?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json() as Body;
  const ids = Array.isArray(body.entity_ids)
    ? body.entity_ids.filter((x): x is string => typeof x === 'string')
    : [];
  if (ids.length === 0) {
    return NextResponse.json(
      { error: 'entity_ids must be a non-empty array' },
      { status: 400 },
    );
  }
  if (!body.patch || typeof body.patch !== 'object') {
    return NextResponse.json({ error: 'patch must be an object' }, { status: 400 });
  }
  const patchInput = body.patch as Record<string, unknown>;

  // Sanitise + reject unknown keys.
  const cleanPatch: Partial<Record<AllowedField, unknown>> = {};
  for (const k of Object.keys(patchInput)) {
    if (!(ALLOWED_FIELDS as readonly string[]).includes(k)) {
      return NextResponse.json({ error: `field "${k}" is not patchable in bulk` }, { status: 400 });
    }
    cleanPatch[k as AllowedField] = patchInput[k];
  }
  if (Object.keys(cleanPatch).length === 0) {
    return NextResponse.json({ error: 'patch is empty' }, { status: 400 });
  }

  // Build the SET clause from the patch.
  const setClauses: string[] = [];
  const values: unknown[] = [ids];
  let paramIdx = 2;
  for (const k of Object.keys(cleanPatch) as AllowedField[]) {
    setClauses.push(`${k} = $${paramIdx}`);
    values.push(cleanPatch[k]);
    paramIdx += 1;
  }
  setClauses.push(`updated_at = NOW()`);

  try {
    const result = await tx(async (client) => {
      // Snapshot before-state for audit log per entity.
      const before = await qTx<{ id: string; client_group_id: string | null; is_active: boolean; liquidation_date: string | null }>(
        client,
        `SELECT id, client_group_id, is_active, liquidation_date::text AS liquidation_date
           FROM tax_entities WHERE id = ANY($1::text[])`,
        [ids],
      );
      if (before.length !== ids.length) {
        throw new Error('one_or_more_entities_not_found');
      }

      await execTx(
        client,
        `UPDATE tax_entities SET ${setClauses.join(', ')} WHERE id = ANY($1::text[])`,
        values,
      );

      // Per-entity audit row so the entity timeline picks each one up.
      for (const row of before) {
        await logAuditTx(client, {
          userId: 'founder',
          action: 'tax_entity_bulk_update',
          targetType: 'tax_entity',
          targetId: row.id,
          newValue: JSON.stringify({
            patch: cleanPatch,
            previous: {
              client_group_id: row.client_group_id,
              is_active: row.is_active,
              liquidation_date: row.liquidation_date,
            },
          }),
        });
      }

      return { updated: ids.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const status = msg === 'one_or_more_entities_not_found' ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
