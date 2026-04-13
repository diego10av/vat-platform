import { NextRequest, NextResponse } from 'next/server';
import { queryOne, execute, logAudit, initializeSchema } from '@/lib/db';

// PATCH /api/invoice-lines/:id
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await initializeSchema();
  const { id } = await params;
  const body = await request.json();

  const line = await queryOne(
    `SELECT il.*, i.declaration_id, i.invoice_id as inv_id, i.document_id, d2.entity_id
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     JOIN declarations d2 ON i.declaration_id = d2.id
     WHERE il.id = $1`,
    [id]
  );
  if (!line) return NextResponse.json({ error: 'Invoice line not found' }, { status: 404 });

  const lineFields = [
    'description', 'amount_eur', 'vat_rate', 'vat_applied', 'rc_amount',
    'amount_incl', 'treatment', 'treatment_source', 'flag', 'flag_reason',
    'flag_acknowledged', 'reviewed', 'note', 'state', 'sort_order',
  ];
  const invoiceFields = [
    'provider', 'provider_vat', 'country', 'invoice_date', 'invoice_number',
    'direction', 'currency', 'currency_amount', 'ecb_rate',
  ];

  // Update invoice_lines
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
        await logAudit({
          entityId: line.entity_id as string,
          declarationId: line.declaration_id as string,
          action: 'update', targetType: 'invoice_line', targetId: id,
          field, oldValue: String(oldVal ?? ''), newValue: String(newVal ?? ''),
        });
      }
    }
  }

  if (lineUpdates.length > 0) {
    lineUpdates.push('updated_at = NOW()');
    lineValues.push(id);
    await execute(`UPDATE invoice_lines SET ${lineUpdates.join(', ')} WHERE id = $${idx}`, lineValues);
  }

  // Update parent invoice fields
  const invUpdates: string[] = [];
  const invValues: unknown[] = [];
  let invIdx = 1;
  for (const field of invoiceFields) {
    if (field in body) {
      invUpdates.push(`${field} = $${invIdx}`);
      invValues.push(body[field]);
      invIdx++;
    }
  }
  if (invUpdates.length > 0) {
    invValues.push(line.invoice_id);
    await execute(`UPDATE invoices SET ${invUpdates.join(', ')} WHERE id = $${invIdx}`, invValues);
  }

  const updated = await queryOne(
    `SELECT il.*, i.provider, i.provider_vat, i.country, i.invoice_date, i.invoice_number,
            i.direction, i.currency, i.currency_amount, i.ecb_rate, i.document_id,
            doc.filename as source_filename
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     JOIN documents doc ON i.document_id = doc.id
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

  const line = await queryOne(
    `SELECT il.*, i.declaration_id, d2.entity_id
     FROM invoice_lines il
     JOIN invoices i ON il.invoice_id = i.id
     JOIN declarations d2 ON i.declaration_id = d2.id
     WHERE il.id = $1`,
    [id]
  );
  if (!line) return NextResponse.json({ error: 'Invoice line not found' }, { status: 404 });

  const reason = body.reason || 'other';
  await execute(
    `UPDATE invoice_lines SET state = 'deleted', deleted_at = NOW(), deleted_reason = $1, updated_at = NOW() WHERE id = $2`,
    [reason, id]
  );

  await logAudit({
    entityId: line.entity_id as string,
    declarationId: line.declaration_id as string,
    action: 'delete', targetType: 'invoice_line', targetId: id,
    oldValue: JSON.stringify(line), newValue: reason,
  });

  return NextResponse.json({ success: true });
}
