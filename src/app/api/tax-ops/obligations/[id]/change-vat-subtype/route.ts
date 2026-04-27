import { NextRequest, NextResponse } from 'next/server';
import { tx, qTx, execTx, logAuditTx } from '@/lib/db';

// POST /api/tax-ops/obligations/[id]/change-vat-subtype
//   Body: { new_subtype: 'standard' | 'simplified' }
//
// Stint 48.F1.A. Switches a VAT annual obligation between the standard
// (`vat_annual`) and simplified (`vat_simplified_annual`) regime in
// place — the obligation keeps its filings history; future-year
// matrices render under the new subtype.
//
// Diego: "el switch es permanente hasta el día que se cambie. Hay
// veces que las entidades cambian de régimen." Per-obligation, audit
// log so the change is traceable.
//
// Safety:
//   - Only valid for vat_annual ↔ vat_simplified_annual. Any other
//     tax_type is rejected (cadence switch lives at change-cadence).
//   - Same period_pattern (annual) on both sides — no period rewriting.
//   - Audit log captures before + after.

const VAT_ANNUAL = 'vat_annual';
const VAT_SIMPLIFIED = 'vat_simplified_annual';

function targetTaxType(subtype: string): string | null {
  if (subtype === 'standard') return VAT_ANNUAL;
  if (subtype === 'simplified') return VAT_SIMPLIFIED;
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as { new_subtype?: unknown };
  const subtype = typeof body.new_subtype === 'string' ? body.new_subtype : null;
  const newTaxType = subtype ? targetTaxType(subtype) : null;
  if (!newTaxType) {
    return NextResponse.json(
      { error: 'new_subtype must be "standard" or "simplified"' },
      { status: 400 },
    );
  }

  try {
    const result = await tx(async (client) => {
      const current = await qTx<{
        id: string; entity_id: string; tax_type: string;
        period_pattern: string; service_kind: string;
      }>(
        client,
        `SELECT id, entity_id, tax_type, period_pattern, service_kind
           FROM tax_obligations WHERE id = $1`,
        [id],
      );
      if (!current[0]) throw new Error('obligation_not_found');

      const oldTaxType = current[0].tax_type;
      if (oldTaxType !== VAT_ANNUAL && oldTaxType !== VAT_SIMPLIFIED) {
        throw new Error('not_a_vat_annual_obligation');
      }

      if (oldTaxType === newTaxType) {
        return { changed: false, old_tax_type: oldTaxType, new_tax_type: newTaxType };
      }

      // Conflict: another active obligation on the same entity already
      // owns the target tax_type.
      const conflict = await qTx<{ id: string }>(
        client,
        `SELECT id FROM tax_obligations
          WHERE entity_id = $1
            AND tax_type = $2
            AND period_pattern = 'annual'
            AND service_kind = $3
            AND is_active = TRUE
            AND id <> $4
          LIMIT 1`,
        [current[0].entity_id, newTaxType, current[0].service_kind, id],
      );
      if (conflict[0]) throw new Error('target_obligation_already_exists');

      await execTx(
        client,
        `UPDATE tax_obligations
            SET tax_type = $1, updated_at = NOW()
          WHERE id = $2`,
        [newTaxType, id],
      );

      await logAuditTx(client, {
        userId: 'founder',
        action: 'tax_obligation_vat_subtype_change',
        targetType: 'tax_obligation',
        targetId: id,
        newValue: JSON.stringify({
          old_tax_type: oldTaxType,
          new_tax_type: newTaxType,
        }),
      });

      return {
        changed: true,
        old_tax_type: oldTaxType,
        new_tax_type: newTaxType,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const status = msg === 'obligation_not_found' ? 404
      : ['not_a_vat_annual_obligation', 'target_obligation_already_exists'].includes(msg) ? 409
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
