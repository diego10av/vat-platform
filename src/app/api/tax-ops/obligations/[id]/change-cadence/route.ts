import { NextRequest, NextResponse } from 'next/server';
import { tx, qTx, execTx, logAuditTx } from '@/lib/db';

// POST /api/tax-ops/obligations/[id]/change-cadence
//   Body: { new_tax_type: string, new_period_pattern: string }
//
// Stint 41. Moves an obligation between cadences WITHIN A FAMILY of
// tax types (e.g. WHT: monthly ↔ quarterly ↔ semester ↔ annual ↔
// adhoc). The obligation's tax_type + period_pattern are updated
// in place so the obligation keeps its filings history (orphaned
// period_labels from the old cadence stay readable in the audit
// log; they just won't render in the new cadence's matrix).
//
// Safety:
//   - Only allows moves within the same "family prefix" (wht_director_*
//     → wht_director_*). Never crosses VAT ↔ CIT ↔ WHT.
//   - Target tax_type + period_pattern must match a known rule in
//     tax_deadline_rules.
//   - Audit log captures before + after values.
//
// Today's supported families: wht_director_*. Extending to other
// variable-cadence taxes is a one-line whitelist change below.

const FAMILY_PREFIXES = ['wht_director_'] as const;

function sameFamily(oldType: string, newType: string): boolean {
  return FAMILY_PREFIXES.some(p => oldType.startsWith(p) && newType.startsWith(p));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  const body = await request.json() as {
    new_tax_type?: unknown;
    new_period_pattern?: unknown;
  };
  const newTaxType = typeof body.new_tax_type === 'string' ? body.new_tax_type : null;
  const newPeriodPattern = typeof body.new_period_pattern === 'string' ? body.new_period_pattern : null;
  if (!newTaxType || !newPeriodPattern) {
    return NextResponse.json(
      { error: 'new_tax_type and new_period_pattern are required' },
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
      const oldPeriodPattern = current[0].period_pattern;

      if (oldTaxType === newTaxType && oldPeriodPattern === newPeriodPattern) {
        return { changed: false, old_tax_type: oldTaxType, new_tax_type: newTaxType };
      }

      if (!sameFamily(oldTaxType, newTaxType)) {
        throw new Error('cross_family_move_not_allowed');
      }

      // Validate the target rule exists.
      const rule = await qTx<{ tax_type: string }>(
        client,
        `SELECT tax_type FROM tax_deadline_rules
          WHERE tax_type = $1 AND period_pattern = $2
          LIMIT 1`,
        [newTaxType, newPeriodPattern],
      );
      if (!rule[0]) throw new Error('target_rule_not_found');

      // Check no OTHER active obligation on this entity already owns
      // the target (tax_type, period_pattern, service_kind) tuple.
      // If one exists, the move would create a duplicate.
      const conflict = await qTx<{ id: string }>(
        client,
        `SELECT id FROM tax_obligations
          WHERE entity_id = $1
            AND tax_type = $2
            AND period_pattern = $3
            AND service_kind = $4
            AND is_active = TRUE
            AND id <> $5
          LIMIT 1`,
        [current[0].entity_id, newTaxType, newPeriodPattern, current[0].service_kind, id],
      );
      if (conflict[0]) throw new Error('target_obligation_already_exists');

      await execTx(
        client,
        `UPDATE tax_obligations
            SET tax_type = $1, period_pattern = $2, updated_at = NOW()
          WHERE id = $3`,
        [newTaxType, newPeriodPattern, id],
      );

      await logAuditTx(client, {
        userId: 'founder',
        action: 'tax_obligation_cadence_change',
        targetType: 'tax_obligation',
        targetId: id,
        newValue: JSON.stringify({
          old_tax_type: oldTaxType,
          old_period_pattern: oldPeriodPattern,
          new_tax_type: newTaxType,
          new_period_pattern: newPeriodPattern,
        }),
      });

      return {
        changed: true,
        old_tax_type: oldTaxType,
        old_period_pattern: oldPeriodPattern,
        new_tax_type: newTaxType,
        new_period_pattern: newPeriodPattern,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e);
    const status = msg === 'obligation_not_found' ? 404
      : ['cross_family_move_not_allowed', 'target_rule_not_found', 'target_obligation_already_exists'].includes(msg) ? 409
      : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
