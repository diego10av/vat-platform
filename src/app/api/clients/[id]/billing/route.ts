// ════════════════════════════════════════════════════════════════════════
// /api/clients/:id/billing
//
// GET  → return the client's fee schedule + engagement-letter metadata.
//        Returns null (with 200) when no billing row exists yet, so the
//        client card can render an "add fee schedule" empty state.
// PUT  → upsert the fee schedule (partial update; only fields present
//        in the body are touched). NULL clears a fee.
//
// Engagement letter upload/download/delete lives on a sibling path:
//   /api/clients/:id/billing/engagement-letter
//
// Stint 15 (2026-04-20). Per Diego: "con el tema del Billing para
// poder ver qué FIIs hemos acordado con ese cliente".
// ════════════════════════════════════════════════════════════════════════

import { NextRequest } from 'next/server';
import { execute, queryOne, initializeSchema } from '@/lib/db';
import { apiError, apiFail, apiOk } from '@/lib/api-errors';

interface BillingRow {
  client_id: string;
  fee_monthly_cents: number | null;
  fee_quarterly_cents: number | null;
  fee_annual_cents: number | null;
  fee_annual_summary_cents: number | null;
  fee_vat_registration_cents: number | null;
  fee_ad_hoc_hourly_cents: number | null;
  currency: string;
  disbursement_fee_bps: number | null;
  vat_on_disbursement_fee: boolean | null;
  disbursement_notes: string | null;
  billing_notes: string | null;
  engagement_letter_filename: string | null;
  engagement_letter_path: string | null;
  engagement_letter_content_type: string | null;
  engagement_letter_size_bytes: number | null;
  engagement_letter_uploaded_at: string | null;
  engagement_letter_signed_on: string | null;
  created_at: string;
  updated_at: string;
}

// Columns safely writable via PUT. Boolean/number/text shapes handled
// inline below.
const NUMERIC_CENTS_FIELDS = [
  'fee_monthly_cents',
  'fee_quarterly_cents',
  'fee_annual_cents',
  'fee_annual_summary_cents',
  'fee_vat_registration_cents',
  'fee_ad_hoc_hourly_cents',
] as const;
const NUMERIC_BPS_FIELDS = ['disbursement_fee_bps'] as const;
const BOOLEAN_FIELDS = ['vat_on_disbursement_fee'] as const;
const TEXT_FIELDS = ['currency', 'disbursement_notes', 'billing_notes'] as const;
const DATE_FIELDS = ['engagement_letter_signed_on'] as const;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: clientId } = await params;

    // Gate on the client existing — billing is client-scoped.
    const client = await queryOne<{ id: string }>(
      'SELECT id FROM clients WHERE id = $1 AND archived_at IS NULL',
      [clientId],
    );
    if (!client) return apiError('client_not_found', 'Client not found.', { status: 404 });

    try {
      const row = await queryOne<BillingRow>(
        'SELECT * FROM client_billing WHERE client_id = $1',
        [clientId],
      );
      return apiOk({ billing: row ?? null });
    } catch (err) {
      const msg = (err as { message?: string } | null)?.message ?? '';
      if (/relation.*client_billing.*does not exist/i.test(msg)) {
        return apiError(
          'migration_required',
          'Migration 018 has not been applied to this database.',
          { status: 501 },
        );
      }
      throw err;
    }
  } catch (err) {
    return apiFail(err, 'clients/billing GET');
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await initializeSchema();
    const { id: clientId } = await params;

    const client = await queryOne<{ id: string }>(
      'SELECT id FROM clients WHERE id = $1 AND archived_at IS NULL',
      [clientId],
    );
    if (!client) return apiError('client_not_found', 'Client not found.', { status: 404 });

    const body = await request.json();

    // Normalise incoming fields into the typed column sets.
    const patch: Record<string, number | string | boolean | null> = {};

    for (const f of NUMERIC_CENTS_FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v === null || v === '') {
        patch[f] = null;
      } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        // Stored as cents; caller sends cents directly. UI rounds first.
        patch[f] = Math.round(v);
      } else {
        return apiError('bad_value',
          `${f} must be null or a non-negative number in cents.`, { status: 400 });
      }
    }
    for (const f of NUMERIC_BPS_FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v === null || v === '') {
        patch[f] = null;
      } else if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10000) {
        patch[f] = Math.round(v);
      } else {
        return apiError('bad_value',
          `${f} must be between 0 and 10000 (basis points) or null.`, { status: 400 });
      }
    }
    for (const f of BOOLEAN_FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      patch[f] = v === null ? null : !!v;
    }
    for (const f of TEXT_FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v === null || v === '') {
        // currency can't be null (NOT NULL in schema). Keep it sticky.
        if (f === 'currency') continue;
        patch[f] = null;
      } else if (typeof v === 'string') {
        patch[f] = v.trim() || null;
      }
    }
    for (const f of DATE_FIELDS) {
      if (!(f in body)) continue;
      const v = body[f];
      if (v === null || v === '') {
        patch[f] = null;
      } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        patch[f] = v;
      } else {
        return apiError('bad_value', `${f} must be YYYY-MM-DD or null.`, { status: 400 });
      }
    }

    try {
      const existing = await queryOne<{ client_id: string }>(
        'SELECT client_id FROM client_billing WHERE client_id = $1',
        [clientId],
      );

      if (!existing) {
        // Insert — include every patched field + the client_id.
        const cols = ['client_id', ...Object.keys(patch)];
        const placeholders = cols.map((_, i) => `$${i + 1}`);
        const vals = [clientId, ...Object.values(patch)];
        await execute(
          `INSERT INTO client_billing (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`,
          vals,
        );
      } else if (Object.keys(patch).length > 0) {
        const keys = Object.keys(patch);
        const sets = keys.map((k, i) => `${k} = $${i + 1}`);
        sets.push('updated_at = NOW()');
        const vals = [...Object.values(patch), clientId];
        await execute(
          `UPDATE client_billing SET ${sets.join(', ')} WHERE client_id = $${vals.length}`,
          vals,
        );
      }

      const fresh = await queryOne<BillingRow>(
        'SELECT * FROM client_billing WHERE client_id = $1',
        [clientId],
      );
      return apiOk({ billing: fresh });
    } catch (err) {
      const msg = (err as { message?: string } | null)?.message ?? '';
      if (/relation.*client_billing.*does not exist/i.test(msg)) {
        return apiError(
          'migration_required',
          'Migration 018 has not been applied to this database.',
          { status: 501 },
        );
      }
      throw err;
    }
  } catch (err) {
    return apiFail(err, 'clients/billing PUT');
  }
}
