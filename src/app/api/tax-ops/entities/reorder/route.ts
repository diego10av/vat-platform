import { NextRequest, NextResponse } from 'next/server';
import { tx, execTx, logAuditTx } from '@/lib/db';

// POST /api/tax-ops/entities/reorder — bulk-set display_order.
//
// Stint 51.D. Body shape:
//   { updates: [{ id: string; display_order: number }, …] }
//
// Used by drag-and-drop reorder in TaxTypeMatrix when the user drops a
// row at a new position within its family. The frontend computes the
// new sequential order for every entity in the affected family and
// sends one batched call (cheaper + atomic). Each update writes one
// audit_log entry so the trail captures who reordered what.

interface UpdateRow {
  id: string;
  display_order: number;
}

export async function POST(request: NextRequest) {
  let body: { updates?: UpdateRow[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const updates = Array.isArray(body.updates) ? body.updates : null;
  if (!updates || updates.length === 0) {
    return NextResponse.json({ error: 'updates_required' }, { status: 400 });
  }
  // Sanity-check shape — every entry must have a string id and integer
  // display_order. Reject the whole batch on the first malformed row to
  // keep the transaction simple.
  for (const u of updates) {
    if (typeof u.id !== 'string' || !u.id) {
      return NextResponse.json({ error: 'invalid_id' }, { status: 400 });
    }
    if (!Number.isInteger(u.display_order) || u.display_order < 0) {
      return NextResponse.json({ error: 'invalid_display_order' }, { status: 400 });
    }
  }

  await tx(async (client) => {
    for (const u of updates) {
      await execTx(
        client,
        `UPDATE tax_entities
            SET display_order = $1, updated_at = NOW()
          WHERE id = $2`,
        [u.display_order, u.id],
      );
      await logAuditTx(client, {
        userId: 'founder',
        action: 'tax_entity_reorder',
        targetType: 'tax_entity',
        targetId: u.id,
        newValue: JSON.stringify({ display_order: u.display_order }),
      });
    }
  });

  return NextResponse.json({ ok: true, updated: updates.length });
}
