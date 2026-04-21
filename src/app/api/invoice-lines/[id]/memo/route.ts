import { NextRequest, NextResponse } from 'next/server';
import { queryOne, logAudit } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { draftMemo } from '@/lib/memo-drafter';

// POST /api/invoice-lines/[id]/memo
//
// Generates a formal defense memo (markdown) for a single invoice line.
// Response: { markdown, model }
//
// Optional JSON body:
//   { reviewer_note?: string, override_reason?: string }
//
// The markdown can be downloaded as a .md file by the client UI, or
// later attached to the audit-trail PDF. No DB persistence in the MVP
// — if Diego uses the feature a lot, we'll add an invoice_memos table.

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    const body = (await request.json().catch(() => ({}))) as {
      reviewer_note?: string;
      override_reason?: string;
    };

    // Fetch the line + invoice + declaration + entity in one query.
    const row = await queryOne<{
      line_id: string;
      direction: string;
      amount_eur: number | null;
      vat_rate: number | null;
      vat_applied: number | null;
      description: string | null;
      treatment: string | null;
      classification_rule: string | null;
      classification_reason: string | null;
      ai_suggested_treatment: string | null;
      flag_reason: string | null;
      invoice_number: string | null;
      invoice_date: string | null;
      provider: string | null;
      country: string | null;
      customer_country: string | null;
      declaration_id: string;
      year: number;
      period: string;
      entity_id: string;
      entity_name: string;
      entity_type: string | null;
      vat_number: string | null;
      regime: string;
      frequency: string;
    }>(
      `SELECT il.id        AS line_id,
              i.direction,
              il.amount_eur,
              il.vat_rate,
              il.vat_applied,
              il.description,
              il.treatment,
              il.classification_rule,
              il.classification_reason,
              il.ai_suggested_treatment,
              il.flag_reason,
              i.invoice_number,
              i.invoice_date::text AS invoice_date,
              i.provider,
              i.country,
              i.customer_country,
              d.id     AS declaration_id,
              d.year,
              d.period,
              e.id     AS entity_id,
              e.name   AS entity_name,
              e.entity_type,
              e.vat_number,
              e.regime,
              e.frequency
         FROM invoice_lines il
         JOIN invoices i ON il.invoice_id = i.id
         JOIN declarations d ON il.declaration_id = d.id
         JOIN entities e ON d.entity_id = e.id
        WHERE il.id = $1`,
      [id],
    );

    if (!row) {
      return apiError('line_not_found', 'Invoice line not found.', { status: 404 });
    }

    const result = await draftMemo(
      {
        line_id: row.line_id,
        invoice_number: row.invoice_number,
        invoice_date: row.invoice_date,
        supplier: row.provider,
        supplier_country: row.country,
        customer_country: row.customer_country,
        description: row.description,
        amount_eur: row.amount_eur,
        vat_rate: row.vat_rate,
        vat_applied: row.vat_applied,
        direction: row.direction as 'incoming' | 'outgoing',
        treatment: row.treatment,
        classification_rule: row.classification_rule,
        classification_reason: row.classification_reason,
        ai_suggested_treatment: row.ai_suggested_treatment,
        flag_reason: row.flag_reason,
      },
      {
        entity_name: row.entity_name,
        entity_type: row.entity_type,
        vat_number: row.vat_number,
        regime: row.regime,
        frequency: row.frequency,
      },
      {
        declaration_year: row.year,
        declaration_period: row.period,
        reviewer_note: body.reviewer_note,
        override_reason: body.override_reason,
      },
      {
        entityId: row.entity_id,
        declarationId: row.declaration_id,
      },
    );

    await logAudit({
      entityId: row.entity_id,
      declarationId: row.declaration_id,
      action: 'memo_drafted',
      targetType: 'invoice_line',
      targetId: id,
      field: 'memo',
      newValue: result.model,
    });

    return NextResponse.json({
      markdown: result.markdown,
      model: result.model,
      line_id: row.line_id,
      entity_name: row.entity_name,
    });
  } catch (err) {
    return apiFail(err, 'invoice-lines/memo');
  }
}
