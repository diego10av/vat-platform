// Shared classification runner. Called from:
//   - /api/agents/extract (auto-run at end of extraction)
//   - /api/agents/classify (manual "Re-run rules" button)

import { query, queryOne, execute, logAudit } from '@/lib/db';
import {
  classifyInvoiceLine,
  normaliseProviderName,
  levenshtein,
  type EntityContext,
  type PrecedentMatch,
} from '@/config/classification-rules';
import type { TreatmentCode } from '@/config/treatment-codes';

export interface ClassifyReport {
  processed: number;
  classified: number;
  unclassified: number;
  skipped_manual: number;
  by_rule: Record<string, number>;
  by_source: Record<string, number>;
}

export async function classifyDeclaration(declarationId: string): Promise<ClassifyReport> {
  const declaration = await queryOne<{ entity_id: string; }>(
    'SELECT entity_id FROM declarations WHERE id = $1',
    [declarationId]
  );
  if (!declaration) throw new Error('Declaration not found');

  const entity = await queryOne<{ entity_type: string | null }>(
    'SELECT entity_type FROM entities WHERE id = $1',
    [declaration.entity_id]
  );

  // Build entity context: outgoing exempt total for INFERENCE A/B magnitude check
  const outSum = await queryOne<{ sum: number | null }>(
    `SELECT COALESCE(SUM(il.amount_eur), 0)::float as sum
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE i.declaration_id = $1
        AND il.state != 'deleted'
        AND i.direction = 'outgoing'
        AND il.treatment = 'OUT_LUX_00'`,
    [declarationId]
  );

  const ctx: EntityContext = {
    entity_type: (entity?.entity_type as EntityContext['entity_type']) || null,
    exempt_outgoing_total: Number(outSum?.sum ?? 0),
  };

  // Load active legal overrides (effective_date <= today). Higher-priority than
  // both precedent and inference per PRD §6.3 / §15.
  const overrides = await query<{
    id: string; rule_changed: string; new_treatment: string;
    legal_basis: string; provider_match: string | null; description_match: string | null;
  }>(
    `SELECT id, rule_changed, new_treatment, legal_basis, provider_match, description_match
       FROM legal_overrides
      WHERE effective_date <= CURRENT_DATE::text
      ORDER BY effective_date DESC`
  );

  function findOverride(provider: string, description: string | null): typeof overrides[0] | null {
    const p = (provider || '').toLowerCase();
    const d = (description || '').toLowerCase();
    for (const o of overrides) {
      const providerOk = !o.provider_match || p.includes(o.provider_match.toLowerCase());
      const descOk = !o.description_match || d.includes(o.description_match.toLowerCase());
      // Both filters are AND. If both empty, the override is global (rare).
      if (providerOk && descOk && (o.provider_match || o.description_match)) {
        return o;
      }
    }
    return null;
  }

  // Load precedents for this entity
  const precedents = await query<{
    provider: string;
    country: string | null;
    treatment: string;
    description: string | null;
    last_amount: number | null;
  }>(
    'SELECT provider, country, treatment, description, last_amount FROM precedents WHERE entity_id = $1',
    [declaration.entity_id]
  );

  const normalisedPrecedents = precedents.map(p => ({
    ...p,
    normalised: normaliseProviderName(p.provider),
  }));

  // Find precedent match for a given provider+country (fuzzy)
  function findPrecedent(provider: string, country: string | null): PrecedentMatch | null {
    if (!provider) return null;
    const target = normaliseProviderName(provider);
    if (!target) return null;
    const countryKey = (country || '').toUpperCase();
    const candidates = normalisedPrecedents.filter(p =>
      (p.country || '').toUpperCase() === countryKey || !p.country
    );
    // Exact normalised match first
    let best = candidates.find(p => p.normalised === target);
    if (!best) {
      // Levenshtein within 2 (configurable tolerance)
      best = candidates
        .map(p => ({ p, dist: levenshtein(p.normalised, target) }))
        .filter(r => r.dist <= 2 && r.p.normalised.length > 2)
        .sort((a, b) => a.dist - b.dist)[0]?.p;
    }
    if (!best) return null;
    return {
      treatment: best.treatment as TreatmentCode,
      description: best.description,
      last_amount: best.last_amount,
    };
  }

  // Fetch lines to (re)classify — all non-manual active lines
  const lines = await query<{
    id: string;
    direction: string;
    country: string | null;
    vat_rate: number | null;
    vat_applied: number | null;
    amount_eur: number | null;
    description: string | null;
    treatment_source: string | null;
    treatment: string | null;
    provider: string | null;
  }>(
    `SELECT il.id, i.direction, i.country, il.vat_rate, il.vat_applied, il.amount_eur, il.description,
            il.treatment_source, il.treatment, i.provider
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'`,
    [declarationId]
  );

  const byRule: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let classifiedCount = 0;
  let unclassifiedCount = 0;
  let skippedManual = 0;

  for (const line of lines) {
    // PRIORITY 1 — never override manual classifications
    if (line.treatment_source === 'manual') {
      skippedManual += 1;
      continue;
    }

    // PRIORITY 3 — legal override wins over precedent and inference, but
    // direct-evidence rules still take precedence (an explicit invoice rate
    // is an objective fact about the invoice; the override is interpretive).
    const override = findOverride(line.provider || '', line.description);
    const precedent = findPrecedent(line.provider || '', line.country);

    let result;
    if (override) {
      // Run direct-evidence rules first; if no direct match, apply override.
      const direct = classifyInvoiceLine(
        {
          direction: line.direction as 'incoming' | 'outgoing',
          country: line.country,
          vat_rate: line.vat_rate == null ? null : Number(line.vat_rate),
          vat_applied: line.vat_applied == null ? null : Number(line.vat_applied),
          amount_eur: line.amount_eur == null ? null : Number(line.amount_eur),
          description: line.description,
        },
        ctx,
        null  // skip precedent so we can decide
      );
      // If the result came from a numbered RULE 1-9, keep it (direct evidence).
      // Otherwise apply the override.
      const isDirectEvidenceRule = /^RULE [1-9]$/.test(direct.rule);
      if (isDirectEvidenceRule) {
        result = direct;
      } else {
        result = {
          treatment: override.new_treatment as TreatmentCode,
          rule: `OVERRIDE · ${override.rule_changed}`,
          reason: `Legal position override: ${override.legal_basis}`,
          source: 'override' as const,
          flag: false,
        };
      }
    } else {
      result = classifyInvoiceLine(
        {
          direction: line.direction as 'incoming' | 'outgoing',
          country: line.country,
          vat_rate: line.vat_rate == null ? null : Number(line.vat_rate),
          vat_applied: line.vat_applied == null ? null : Number(line.vat_applied),
          amount_eur: line.amount_eur == null ? null : Number(line.amount_eur),
          description: line.description,
        },
        ctx,
        precedent
      );
    }

    await execute(
      `UPDATE invoice_lines
          SET treatment = $1,
              treatment_source = $2,
              classification_rule = $3,
              flag = $4,
              flag_reason = $5,
              state = CASE WHEN state = 'extracted' THEN 'classified' ELSE state END,
              updated_at = NOW()
        WHERE id = $6`,
      [result.treatment, result.source, result.rule, result.flag, result.flag_reason ?? null, line.id]
    );

    byRule[result.rule] = (byRule[result.rule] || 0) + 1;
    bySource[result.source] = (bySource[result.source] || 0) + 1;
    if (result.treatment) classifiedCount += 1;
    else unclassifiedCount += 1;

    // Audit only when treatment actually changed
    if (line.treatment !== result.treatment) {
      await logAudit({
        entityId: declaration.entity_id,
        declarationId: declarationId,
        action: 'classify',
        targetType: 'invoice_line',
        targetId: line.id,
        field: 'treatment',
        oldValue: String(line.treatment ?? ''),
        newValue: `${result.treatment ?? 'UNCLASSIFIED'} (${result.rule} · ${result.source})`,
      });
    }
  }

  return {
    processed: lines.length,
    classified: classifiedCount,
    unclassified: unclassifiedCount,
    skipped_manual: skippedManual,
    by_rule: byRule,
    by_source: bySource,
  };
}
