import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit, initializeSchema, tx, execTx, logAuditTx } from '@/lib/db';
import { validateInvoiceDate, validateVatRate, validateCurrency, validateCountry, validateVatNumber } from '@/lib/validation';
import { apiError } from '@/lib/api-errors';
import { TREATMENT_CODES } from '@/config/treatment-codes';
import { declarationBounds } from '@/lib/ecdf';

const LOCKED_STATUSES = new Set(['approved', 'filed', 'paid']);

// PATCH /api/invoice-lines/:id
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const body = await request.json();

  const line = await queryOne<Record<string, unknown> & {
    declaration_id: string; invoice_id: string; entity_id: string; decl_status: string;
    decl_year: number; decl_period: string;
  }>(
    `SELECT il.*, i.declaration_id, il.invoice_id,
            d2.entity_id, d2.status AS decl_status,
            d2.year AS decl_year, d2.period AS decl_period
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     JOIN declarations d2 ON i.declaration_id = d2.id
     WHERE il.id = $1`,
    [id]
  );
  if (!line) return apiError('line_not_found', 'Invoice line not found.', { status: 404 });

  // ─── Lock check ───
  // Do not allow edits to a line whose declaration has been approved/filed/paid.
  // Reopening is a deliberate act (approved→review transition) and must
  // happen via the lifecycle endpoint, not as a silent side-effect of PATCH.
  if (LOCKED_STATUSES.has(line.decl_status)) {
    return apiError('declaration_locked',
      `This line belongs to a ${line.decl_status} declaration and cannot be modified.`,
      { hint: 'Reopen the declaration first (approved → review).', status: 409 });
  }

  // ─── Validation ───
  if ('invoice_date' in body && body.invoice_date) {
    const v = validateInvoiceDate(body.invoice_date);
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });

    // Stint 67.E (Bug #12) — soft warning when invoice_date falls
    // outside the declaration's calendar period. Common case: a Q3
    // declaration that received an April invoice means the line
    // belongs in Q2, not Q3. We don't reject (chargeable-event vs.
    // invoice-date timing has legitimate edge cases under Art. 19/20
    // LTVA) but we DO flag the line so the reviewer surfaces it
    // before approval. Existing flag/flag_reason wins if the caller
    // explicitly set one in this PATCH.
    const bounds = declarationBounds(line.decl_year, line.decl_period);
    const inv = String(body.invoice_date);
    if (inv < bounds.start || inv > bounds.end) {
      if (!('flag' in body)) body.flag = true;
      if (!('flag_reason' in body)) {
        body.flag_reason =
          `Invoice date ${inv} falls outside the declaration's period ` +
          `(${bounds.start} → ${bounds.end}). Confirm the chargeable event is in ` +
          `${line.decl_year} ${line.decl_period} per Art. 19/20 LTVA — otherwise ` +
          `move the line to the correct declaration.`;
      }
    }
  }
  if ('vat_rate' in body && body.vat_rate != null) {
    const v = validateVatRate(Number(body.vat_rate));
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });
  }
  if ('currency' in body && body.currency) {
    const v = validateCurrency(body.currency);
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });
    body.currency = v.value;
  }
  if ('country' in body && body.country) {
    const v = validateCountry(body.country);
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });
    body.country = v.value;
  }
  if ('provider_vat' in body && body.provider_vat) {
    const v = validateVatNumber(body.provider_vat);
    if (!v.ok) return apiError(v.error.code, v.error.message, { hint: v.error.hint, status: 400 });
    body.provider_vat = v.value;
  }
  if ('direction' in body && body.direction != null &&
      body.direction !== 'incoming' && body.direction !== 'outgoing') {
    return apiError('direction_invalid',
      `direction must be "incoming" or "outgoing"; got "${String(body.direction)}".`,
      { status: 400 });
  }
  if ('treatment' in body && body.treatment != null && body.treatment !== '') {
    if (!(body.treatment in TREATMENT_CODES)) {
      return apiError('treatment_unknown',
        `Unknown treatment code "${String(body.treatment)}".`,
        { hint: 'Pick a code from the treatment list.', status: 400 });
    }
    // When the user sets a treatment from the UI, the source is ALWAYS
    // 'manual', regardless of what the client payload says. This protects
    // the "never override a manual classification" guarantee from being
    // bypassed by a stale or malicious client.
    body.treatment_source = 'manual';
  }

  const lineFields = [
    'description', 'amount_eur', 'vat_rate', 'vat_applied', 'rc_amount',
    'amount_incl', 'treatment', 'treatment_source', 'flag', 'flag_reason',
    'flag_acknowledged', 'reviewed', 'note', 'state', 'sort_order',
    // Batch 4 fields:
    'is_disbursement', 'exemption_reference',
  ];
  const invoiceFields = [
    'provider', 'provider_vat', 'country', 'invoice_date', 'invoice_number',
    'direction', 'currency', 'currency_amount', 'ecb_rate',
  ];

  // ─── Atomic: line + invoice updates + audit rows commit together ───
  //
  // If the caller sent an `override_reason` we attach it to the audit
  // row of the treatment change (the most common AI-override case).
  // For other field changes it's still captured in the first updated
  // field's audit entry, so one edit = one reason. The compliance
  // export later groups audit events by (target_id, created_at) if
  // you want to re-bundle.
  const overrideReason: string | undefined =
    typeof body.override_reason === 'string' && body.override_reason.trim()
      ? body.override_reason.trim().slice(0, 500)
      : undefined;

  await tx(async (txSql) => {
    // invoice_lines update
    const lineUpdates: string[] = [];
    const lineValues: unknown[] = [];
    let idx = 1;
    for (const field of lineFields) {
      if (field in body) {
        const oldVal = line[field];
        const newVal = body[field];
        lineUpdates.push(`${field} = $${idx}`);
        lineValues.push(newVal);
        idx++;
        if (String(oldVal ?? '') !== String(newVal ?? '')) {
          // Attach the reason to the 'treatment' change audit row
          // (it's almost always what the reason is explaining). If the
          // caller didn't include a treatment change but sent a reason,
          // attach it to the first field that changed.
          const attachReason = field === 'treatment' ? overrideReason : undefined;
          await logAuditTx(txSql, {
            entityId: line.entity_id, declarationId: line.declaration_id,
            action: 'update', targetType: 'invoice_line', targetId: id,
            field, oldValue: String(oldVal ?? ''), newValue: String(newVal ?? ''),
            reason: attachReason,
          });
        }
      }
    }
    if (lineUpdates.length > 0) {
      lineUpdates.push('updated_at = NOW()');
      lineValues.push(id);
      await execTx(txSql,
        `UPDATE invoice_lines SET ${lineUpdates.join(', ')} WHERE id = $${idx}`,
        lineValues);
    }

    // invoice update + audit each changed column. The previous version
    // updated invoice fields silently — a reviewer could change a provider
    // name or VAT number with no trace in the audit log.
    if (invoiceFields.some(f => f in body)) {
      const invCurrent = await queryOne<Record<string, unknown>>(
        `SELECT provider, provider_vat, country, invoice_date, invoice_number,
                direction, currency, currency_amount, ecb_rate
           FROM invoices WHERE id = $1`,
        [line.invoice_id]
      ) || {};

      const invUpdates: string[] = [];
      const invValues: unknown[] = [];
      let invIdx = 1;
      for (const field of invoiceFields) {
        if (field in body) {
          const oldVal = invCurrent[field];
          const newVal = body[field];
          invUpdates.push(`${field} = $${invIdx}`);
          invValues.push(newVal);
          invIdx++;
          if (String(oldVal ?? '') !== String(newVal ?? '')) {
            await logAuditTx(txSql, {
              entityId: line.entity_id, declarationId: line.declaration_id,
              action: 'update', targetType: 'invoice', targetId: line.invoice_id,
              field, oldValue: String(oldVal ?? ''), newValue: String(newVal ?? ''),
            });
          }
        }
      }
      if (invUpdates.length > 0) {
        invValues.push(line.invoice_id);
        await execTx(txSql,
          `UPDATE invoices SET ${invUpdates.join(', ')} WHERE id = $${invIdx}`,
          invValues);
      }
    }
  });
  // The "void logAudit" arm is left here only because older callers rely on
  // the logAudit symbol being imported; remove in a later cleanup pass.
  void logAudit;

  const updated = await queryOne(
    `SELECT il.*, i.provider, i.provider_vat, i.country, i.invoice_date, i.invoice_number,
            i.direction, i.currency, i.currency_amount, i.ecb_rate, i.document_id,
            i.extraction_source,
            doc.filename as source_filename
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     LEFT JOIN documents doc ON i.document_id = doc.id
     WHERE il.id = $1`,
    [id]
  );
  return NextResponse.json(updated);
}

// DELETE /api/invoice-lines/:id - soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const line = await queryOne<Record<string, unknown> & {
    declaration_id: string; entity_id: string; decl_status: string;
  }>(
    `SELECT il.*, i.declaration_id, d2.entity_id, d2.status AS decl_status
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     JOIN declarations d2 ON i.declaration_id = d2.id
     WHERE il.id = $1`,
    [id]
  );
  if (!line) return NextResponse.json({ error: 'Invoice line not found' }, { status: 404 });

  // Same lock check as PATCH — a locked declaration cannot have lines
  // silently soft-deleted out from under it.
  if (LOCKED_STATUSES.has(line.decl_status)) {
    return apiError('declaration_locked',
      `This line belongs to a ${line.decl_status} declaration and cannot be deleted.`,
      { hint: 'Reopen the declaration first (approved → review).', status: 409 });
  }

  const reason = body.reason || 'other';
  await execute(
    `UPDATE invoice_lines SET state = 'deleted', deleted_at = NOW(), deleted_reason = $1, updated_at = NOW() WHERE id = $2`,
    [reason, id]
  );

  await logAudit({
    entityId: line.entity_id,
    declarationId: line.declaration_id,
    action: 'delete', targetType: 'invoice_line', targetId: id,
    oldValue: JSON.stringify(line), newValue: reason,
  });

  return NextResponse.json({ success: true });
}
