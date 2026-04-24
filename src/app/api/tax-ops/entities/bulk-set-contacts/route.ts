import { NextRequest, NextResponse } from 'next/server';
import { tx, qTx, execTx, logAuditTx } from '@/lib/db';

// POST /api/tax-ops/entities/bulk-set-contacts
//   Body: { contact_set: [{ name, email?, role? }], entity_ids: string[],
//           source_entity_id?: string }
//
// Stint 40.P bulk-copy. Sets `tax_entities.csp_contacts` on a list of
// target entities in a single transaction so Diego can propagate
// contacts from one "anchor" entity across the family without
// touching each entity individually.
//
// Previous values are captured in the audit log per-entity so a
// manual revert is possible from the audit trail.

interface BulkBody {
  contact_set?: unknown;
  entity_ids?: unknown;
  source_entity_id?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.json() as BulkBody;
  const contactSet = Array.isArray(body.contact_set) ? body.contact_set : null;
  const entityIds = Array.isArray(body.entity_ids) ? body.entity_ids.filter((x): x is string => typeof x === 'string') : null;
  const sourceEntityId = typeof body.source_entity_id === 'string' ? body.source_entity_id : null;

  if (!contactSet || !entityIds || entityIds.length === 0) {
    return NextResponse.json(
      { error: 'contact_set (array) and entity_ids (non-empty array) required' },
      { status: 400 },
    );
  }

  try {
    const result = await tx(async (client) => {
      // Capture before-state for the audit trail (enables manual revert).
      const before = await qTx<{ id: string; csp_contacts: unknown }>(
        client,
        `SELECT id, csp_contacts FROM tax_entities WHERE id = ANY($1::text[])`,
        [entityIds],
      );
      if (before.length !== entityIds.length) {
        throw new Error('one_or_more_entities_not_found');
      }

      const contactsJson = JSON.stringify(contactSet);
      await execTx(
        client,
        `UPDATE tax_entities
           SET csp_contacts = $1::jsonb, updated_at = NOW()
          WHERE id = ANY($2::text[])`,
        [contactsJson, entityIds],
      );

      await logAuditTx(client, {
        userId: 'founder',
        action: 'tax_entity_contacts_bulk_set',
        targetType: 'tax_entity',
        targetId: entityIds.join(','),
        newValue: JSON.stringify({
          source_entity_id: sourceEntityId,
          contact_set: contactSet,
          entity_ids: entityIds,
          previous_values: before.reduce<Record<string, unknown>>((acc, r) => {
            acc[r.id] = r.csp_contacts;
            return acc;
          }, {}),
        }),
      });

      return { updated: entityIds.length };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const status = msg === 'one_or_more_entities_not_found' ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
