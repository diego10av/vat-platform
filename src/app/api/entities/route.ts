import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit, initializeSchema } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';

// GET /api/entities - list all entities
export async function GET() {
  try {
    await initializeSchema();
    const entities = await query('SELECT * FROM entities WHERE deleted_at IS NULL ORDER BY name ASC');
    return NextResponse.json(entities);
  } catch (err) {
    return apiFail(err, 'entities/list');
  }
}

// Canonical entity-type whitelist. Must stay in lockstep with the
// CHECK constraint defined in migrations/019_entity_type_check_constraint.sql
// (and refined in 021_drop_passive_holding.sql). `passive_holding` was
// removed 2026-04-21 per Diego's instruction: a pure holding that is
// NOT a VAT taxable person should not live in cifra at all — there is
// no return to prepare.
const VALID_ENTITY_TYPES = new Set([
  'fund',
  'securitization_vehicle',
  'active_holding',
  'gp',
  'manco',
  'other',
]);

// Simplified regime in LU VAT can only be filed annually. This pairing
// is enforced on both the client (form UI) and the server (here) so a
// direct API call cannot create an inconsistent entity.
function normaliseRegimeFrequency(
  regimeIn: unknown,
  frequencyIn: unknown,
): { regime: string; frequency: string } {
  const regime = regimeIn === 'ordinary' ? 'ordinary' : 'simplified';
  let frequency: string;
  if (regime === 'simplified') {
    frequency = 'annual';
  } else {
    const f = typeof frequencyIn === 'string' ? frequencyIn : 'quarterly';
    frequency = ['monthly', 'quarterly', 'annual', 'yearly'].includes(f) ? f : 'quarterly';
    // The codebase uses both 'annual' (new) and 'yearly' (legacy) — normalise.
    if (frequency === 'yearly') frequency = 'annual';
  }
  return { regime, frequency };
}

// POST /api/entities - create a new entity
//
// 2026-04-18 (migration 005): entities belong to a client. The client_id is
// required once migration 005 lands, but we tolerate the legacy
// `client_name`/`csp_name` path too so the form can migrate gradually.
//
// 2026-04-21 (Diego review session): wrapped in try/catch + apiFail so a
// DB-level CHECK violation can't 500 with an empty body (which was the
// cause of the "Unexpected end of JSON input" error on the client). Also
// validates entity_type server-side before insert so the failure mode is
// a clean 400 with a readable message, never a PostgreSQL constraint
// error propagating up.
export async function POST(request: NextRequest) {
  try {
    await initializeSchema();
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const id = generateId();

    const nameRaw = body.name;
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    if (!name) {
      return apiError('bad_name', 'Entity name is required.', { status: 400 });
    }

    const vatStatus = ['registered', 'pending_registration', 'not_applicable'].includes(
      body.vat_status as string,
    )
      ? (body.vat_status as string)
      : 'registered';

    // Entity-type whitelist — reject unknown values BEFORE hitting the
    // CHECK constraint so the reviewer sees a human message.
    let entityType: string | null = null;
    if (typeof body.entity_type === 'string' && body.entity_type.trim()) {
      const v = body.entity_type.trim().toLowerCase();
      if (!VALID_ENTITY_TYPES.has(v)) {
        return apiError(
          'invalid_entity_type',
          `entity_type "${v}" is not valid. Allowed: ${Array.from(VALID_ENTITY_TYPES).join(', ')}.`,
          { status: 400 },
        );
      }
      entityType = v;
    }

    const { regime, frequency } = normaliseRegimeFrequency(body.regime, body.frequency);

    // Resolve the parent client. Preferred: body.client_id points at an
    // existing client. Fallback: legacy body.client_name creates a new
    // client on the fly. If neither is present, block creation.
    let clientId: string | null = null;
    const clientIdRaw = body.client_id;
    const clientNameRaw = body.client_name;

    if (typeof clientIdRaw === 'string' && clientIdRaw.trim()) {
      const existing = await queryOne<{ id: string }>(
        'SELECT id FROM clients WHERE id = $1',
        [clientIdRaw.trim()],
      );
      if (!existing) {
        return apiError(
          'client_not_found',
          'client_id does not match an existing client.',
          { status: 400 },
        );
      }
      clientId = existing.id;
    } else if (typeof clientNameRaw === 'string' && clientNameRaw.trim()) {
      // Legacy path: create a client from the inline name + email so
      // existing form submissions don't 400. We try to reuse an existing
      // client with the same name before creating a duplicate.
      const trimmed = clientNameRaw.trim();
      try {
        const existing = await queryOne<{ id: string }>(
          'SELECT id FROM clients WHERE lower(name) = lower($1) AND archived_at IS NULL',
          [trimmed],
        );
        if (existing) {
          clientId = existing.id;
        } else {
          clientId = `client-${generateId().slice(0, 10)}`;
          await execute(
            `INSERT INTO clients (id, name, kind, vat_contact_name, vat_contact_email)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              clientId,
              trimmed,
              body.csp_name ? 'csp' : 'end_client',
              trimmed,
              body.client_email || body.csp_email || null,
            ],
          );
        }
      } catch {
        // clients table missing (migration 005 not applied yet). Proceed
        // with the legacy columns only; UI will backfill later.
        clientId = null;
      }
    }

    await execute(
      `INSERT INTO entities (id, client_id, name, vat_number, matricule, rcs_number, legal_form, entity_type,
        regime, frequency, address, bank_iban, bank_bic, tax_office,
        client_name, client_email, csp_name, csp_email,
        has_fx, has_outgoing, has_recharges, notes, vat_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)`,
      [
        id, clientId, name,
        body.vat_number || null, body.matricule || null, body.rcs_number || null,
        body.legal_form || null, entityType,
        regime, frequency,
        body.address || null, body.bank_iban || null, body.bank_bic || null, body.tax_office || null,
        body.client_name || null, body.client_email || null,
        body.csp_name || null, body.csp_email || null,
        !!body.has_fx, !!body.has_outgoing, !!body.has_recharges,
        body.notes || null,
        vatStatus,
      ],
    );

    await logAudit({
      entityId: id, action: 'create', targetType: 'entity', targetId: id,
      newValue: JSON.stringify({ name, entity_type: entityType, regime, frequency }),
    });

    // Auto-populate entity approvers from the client's contact roster
    // when migration 012 is present. Soft-fails if the table is missing.
    if (clientId) {
      try {
        const contacts = await query<{
          id: string; name: string; email: string | null; phone: string | null;
          role: string | null; organization: string | null; country: string | null;
          is_main: boolean; contact_role: string;
        }>(
          `SELECT id, name, email, phone, role, organization, country, is_main, contact_role
             FROM client_contacts
            WHERE client_id = $1
            ORDER BY is_main DESC, lower(name) ASC`,
          [clientId],
        );
        let sortOrder = 0;
        for (const c of contacts) {
          const approverId = `appr-${generateId().slice(0, 10)}`;
          const isPrimary = c.is_main && sortOrder === 0;
          await execute(
            `INSERT INTO entity_approvers
               (id, entity_id, name, email, phone, role, organization,
                country, approver_type, is_primary, sort_order, notes,
                client_contact_id, approver_role)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [
              approverId, id, c.name, c.email, c.phone, c.role,
              c.organization, c.country,
              'client',
              isPrimary,
              sortOrder,
              null,
              c.id,
              c.contact_role || 'approver',
            ],
          );
          sortOrder += 1;
        }
      } catch {
        // client_contacts table missing or other failure — non-fatal.
      }
    }

    const entity = await queryOne('SELECT * FROM entities WHERE id = $1', [id]);
    return NextResponse.json(entity, { status: 201 });
  } catch (err) {
    return apiFail(err, 'entities/create');
  }
}
