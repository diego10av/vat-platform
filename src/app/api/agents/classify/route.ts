import { NextRequest, NextResponse } from 'next/server';
import { query, execute, logAudit, queryOne } from '@/lib/db';
import { classifyInvoiceLine } from '@/config/classification-rules';

// POST /api/agents/classify
// Body: { declaration_id: string }
// Applies the deterministic rules engine to every line in the declaration that
// - is not deleted
// - is not already manually classified (treatment_source = 'manual')
// Returns a summary of how many lines got classified by each rule.
export async function POST(request: NextRequest) {
  const { declaration_id } = await request.json();
  if (!declaration_id) return NextResponse.json({ error: 'declaration_id required' }, { status: 400 });

  const declaration = await queryOne(
    'SELECT entity_id FROM declarations WHERE id = $1',
    [declaration_id]
  );
  if (!declaration) return NextResponse.json({ error: 'Declaration not found' }, { status: 404 });

  // Join invoice_lines with their parent invoice to get direction/country.
  const lines = await query<{
    id: string;
    direction: string;
    country: string | null;
    vat_rate: number | null;
    vat_applied: number | null;
    description: string | null;
    treatment_source: string | null;
    treatment: string | null;
  }>(
    `SELECT il.id, i.direction, i.country, il.vat_rate, il.vat_applied, il.description,
            il.treatment_source, il.treatment
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'`,
    [declaration_id]
  );

  const byRule: Record<string, number> = {};
  let classifiedCount = 0;
  let unclassifiedCount = 0;
  let skippedManual = 0;

  for (const line of lines) {
    if (line.treatment_source === 'manual') {
      skippedManual += 1;
      continue;
    }

    const result = classifyInvoiceLine({
      direction: line.direction as 'incoming' | 'outgoing',
      country: line.country,
      vat_rate: line.vat_rate == null ? null : Number(line.vat_rate),
      vat_applied: line.vat_applied == null ? null : Number(line.vat_applied),
      description: line.description,
    });

    // Persist the classification
    await execute(
      `UPDATE invoice_lines
          SET treatment = $1,
              treatment_source = 'rule',
              classification_rule = $2,
              flag = $3,
              flag_reason = $4,
              state = CASE WHEN state = 'extracted' THEN 'classified' ELSE state END,
              updated_at = NOW()
        WHERE id = $5`,
      [
        result.treatment,
        result.rule,
        result.flag,
        result.flag_reason ?? null,
        line.id,
      ]
    );

    byRule[result.rule] = (byRule[result.rule] || 0) + 1;
    if (result.treatment) classifiedCount += 1;
    else unclassifiedCount += 1;

    // Audit only actual changes (not no-ops)
    if (line.treatment !== result.treatment) {
      await logAudit({
        entityId: declaration.entity_id as string,
        declarationId: declaration_id,
        action: 'classify',
        targetType: 'invoice_line',
        targetId: line.id,
        field: 'treatment',
        oldValue: String(line.treatment ?? ''),
        newValue: `${result.treatment ?? 'UNCLASSIFIED'} (${result.rule})`,
      });
    }
  }

  // Move declaration forward from classifying → review if applicable
  const current = await queryOne<{ status: string }>(
    'SELECT status FROM declarations WHERE id = $1',
    [declaration_id]
  );
  if (current?.status === 'classifying' || current?.status === 'extracting') {
    await execute(
      "UPDATE declarations SET status = 'review', updated_at = NOW() WHERE id = $1",
      [declaration_id]
    );
  }

  return NextResponse.json({
    processed: lines.length,
    classified: classifiedCount,
    unclassified: unclassifiedCount,
    skipped_manual: skippedManual,
    by_rule: byRule,
  });
}
