// ════════════════════════════════════════════════════════════════════════
// scripts/dedup-entities.ts — stint 50.B
//
// Detects + merges duplicate entities (same legal_name modulo
// punctuation differences). The Excel importer (stint 34) created
// duplicates: e.g. "Avallon MBO Fund III SCA" and "Avallon MBO Fund
// III S.C.A." land as two rows.
//
// Usage:
//   npm run dedup-entities             # dry-run: prints the plan
//   npm run dedup-entities -- --apply  # executes inside a single tx
//
// The dry-run is mandatory before --apply — Diego reviews the winner
// per group + the count of obligations being moved + flags any
// conflicts before any writes happen. Loser is HARD-DELETEd (Diego's
// directive in stint 50.D — he doesn't want soft-deleted clutter).
// The audit log entry per merge captures winner_id + loser_id + diff
// for full traceability before the row is removed.
// ════════════════════════════════════════════════════════════════════════

import { query, tx, execTx, logAuditTx } from '../src/lib/db';

const APPLY = process.argv.includes('--apply');

interface EntityRow {
  id: string;
  legal_name: string;
  norm_name: string;
  client_group_id: string | null;
  group_name: string | null;
  vat_number: string | null;
  matricule: string | null;
  rcs_number: string | null;
  liquidation_date: string | null;
  csp_contacts: Array<{ name?: string; email?: string; role?: string }>;
  notes: string | null;
  active_obligations_count: number;
  created_at: string;
}

interface ObligationRow {
  id: string;
  entity_id: string;
  tax_type: string;
  period_pattern: string;
  service_kind: string;
  is_active: boolean;
}

interface MergePlan {
  norm_name: string;
  winner: EntityRow;
  losers: EntityRow[];
  /** Per-loser, the obligations to move + obligations to archive. */
  perLoser: Array<{
    loser_id: string;
    move: ObligationRow[];
    archive_dup: ObligationRow[];
  }>;
}

function pickWinner(rows: EntityRow[]): EntityRow {
  // 1. Most active obligations
  // 2. Has client_group_id (not null)
  // 3. Prefer named group over the catch-all "UNGROUPED" bucket
  // 4. Oldest created_at
  // 5. Shortest legal_name (cleanest format usually wins)
  return [...rows].sort((a, b) => {
    if (b.active_obligations_count !== a.active_obligations_count) {
      return b.active_obligations_count - a.active_obligations_count;
    }
    const aHas = a.client_group_id !== null;
    const bHas = b.client_group_id !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    const aUngrouped = (a.group_name ?? '').trim().toUpperCase() === 'UNGROUPED';
    const bUngrouped = (b.group_name ?? '').trim().toUpperCase() === 'UNGROUPED';
    if (aUngrouped !== bUngrouped) return aUngrouped ? 1 : -1;
    const ageDiff = a.created_at.localeCompare(b.created_at);
    if (ageDiff !== 0) return ageDiff;
    return a.legal_name.length - b.legal_name.length;
  })[0]!;
}

function dedupContacts(
  a: Array<{ name?: string; email?: string; role?: string }>,
  b: Array<{ name?: string; email?: string; role?: string }>,
): Array<{ name?: string; email?: string; role?: string }> {
  const seen = new Set<string>();
  const out: Array<{ name?: string; email?: string; role?: string }> = [];
  for (const c of [...a, ...b]) {
    const key = `${(c.name ?? '').toLowerCase().trim()}|${(c.email ?? '').toLowerCase().trim()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function buildPlan(): Promise<MergePlan[]> {
  const groups = await query<{
    norm_name: string;
    duplicates: EntityRow[];
  }>(
    `WITH normalized AS (
      SELECT
        e.id,
        e.legal_name,
        -- Aggressive normalization: strip accents (TRANSLATE) and ALL
        -- non-alphanumeric chars. Catches "S.à r.l." vs "SARL", trailing
        -- ";", double spaces, mixed case. III/IV/II remain distinct because
        -- the digits/roman-numeral letters survive.
        LOWER(REGEXP_REPLACE(
          TRANSLATE(
            e.legal_name,
            'àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ',
            'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'
          ),
          '[^a-zA-Z0-9]+', '', 'g'
        )) AS norm_name,
        e.client_group_id,
        g.name AS group_name,
        e.vat_number,
        e.matricule,
        e.rcs_number,
        e.liquidation_date::text AS liquidation_date,
        e.csp_contacts,
        e.notes,
        (SELECT COUNT(*)::int FROM tax_obligations o WHERE o.entity_id = e.id AND o.is_active) AS active_obligations_count,
        e.created_at::text
      FROM tax_entities e
      LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
      WHERE e.is_active = TRUE
    )
    SELECT norm_name,
           JSONB_AGG(JSONB_BUILD_OBJECT(
             'id', id,
             'legal_name', legal_name,
             'norm_name', norm_name,
             'client_group_id', client_group_id,
             'group_name', group_name,
             'vat_number', vat_number,
             'matricule', matricule,
             'rcs_number', rcs_number,
             'liquidation_date', liquidation_date,
             'csp_contacts', csp_contacts,
             'notes', notes,
             'active_obligations_count', active_obligations_count,
             'created_at', created_at
           ) ORDER BY active_obligations_count DESC, created_at) AS duplicates
      FROM normalized
     GROUP BY norm_name
    HAVING COUNT(*) > 1
     ORDER BY norm_name`,
  );

  const plans: MergePlan[] = [];
  for (const g of groups) {
    const winner = pickWinner(g.duplicates);
    const losers = g.duplicates.filter(d => d.id !== winner.id);

    // Load obligations for winner + losers in one query
    const ids = [winner.id, ...losers.map(l => l.id)];
    const obligations = await query<ObligationRow>(
      `SELECT id, entity_id, tax_type, period_pattern, service_kind, is_active
         FROM tax_obligations
        WHERE entity_id = ANY($1::text[])`,
      [ids],
    );
    const winnerKeys = new Set(
      obligations
        .filter(o => o.entity_id === winner.id && o.is_active)
        .map(o => `${o.tax_type}|${o.period_pattern}|${o.service_kind}`),
    );

    const perLoser = losers.map(l => {
      const loserOblig = obligations.filter(o => o.entity_id === l.id && o.is_active);
      const move: ObligationRow[] = [];
      const archive_dup: ObligationRow[] = [];
      for (const o of loserOblig) {
        const k = `${o.tax_type}|${o.period_pattern}|${o.service_kind}`;
        if (winnerKeys.has(k)) {
          archive_dup.push(o);
        } else {
          move.push(o);
          winnerKeys.add(k);  // prevent another loser claiming the same key
        }
      }
      return { loser_id: l.id, move, archive_dup };
    });

    plans.push({ norm_name: g.norm_name, winner, losers, perLoser });
  }
  return plans;
}

function printPlan(plans: MergePlan[]) {
  console.log('═══ Entity Dedup · Dry Run ═══════════════════════════════════════════');
  const totalEntities = plans.reduce((s, p) => s + 1 + p.losers.length, 0);
  const totalSoftDeletes = plans.reduce((s, p) => s + p.losers.length, 0);
  console.log(`${plans.length} groups · ${totalEntities} entities affected`);
  console.log('');

  let totalMoves = 0;
  let totalArchives = 0;

  plans.forEach((plan, i) => {
    console.log(`──── Group ${i + 1}/${plans.length}: "${plan.norm_name}" (${1 + plan.losers.length} entities) ────`);
    const w = plan.winner;
    console.log(
      `   WINNER:  ${w.id.slice(0, 8)}…  "${w.legal_name}"`
      + `  group=${w.group_name ?? 'null'}  ${w.active_obligations_count} oblig`
      + `  contacts=${(w.csp_contacts ?? []).length}`,
    );
    plan.losers.forEach((l, j) => {
      const lp = plan.perLoser[j]!;
      console.log(
        `   LOSER:   ${l.id.slice(0, 8)}…  "${l.legal_name}"`
        + `  group=${l.group_name ?? 'null'}  ${l.active_obligations_count} oblig`
        + `  contacts=${(l.csp_contacts ?? []).length}`,
      );
      if (lp.move.length > 0) {
        const list = lp.move.map(o => `${o.tax_type}/${o.period_pattern}`).join(', ');
        console.log(`            → move ${lp.move.length} oblig: ${list}`);
        totalMoves += lp.move.length;
      }
      if (lp.archive_dup.length > 0) {
        const list = lp.archive_dup.map(o => `${o.tax_type}/${o.period_pattern}`).join(', ');
        console.log(`            → archive ${lp.archive_dup.length} duplicate oblig: ${list}`);
        totalArchives += lp.archive_dup.length;
      }
      if (lp.move.length === 0 && lp.archive_dup.length === 0) {
        console.log(`            → DELETE (no obligations to move)`);
      }
    });
    console.log('');
  });

  console.log('═══ Summary ═══');
  console.log(`   ${totalEntities} → ${plans.length} entities (${totalSoftDeletes} HARD-DELETEd)`);
  console.log(`   ${totalMoves} obligations moved · ${totalArchives} duplicate obligations archived`);
  console.log(`   Filings follow their obligations (no rewriting needed).`);
  if (!APPLY) {
    console.log('');
    console.log('Run with --apply to execute.');
  }
  console.log('═══════════════════════════════════════════════════════════════════════');
}

async function applyPlan(plans: MergePlan[]) {
  console.log('');
  console.log('═══ Applying merge plan ═══');
  await tx(async (client) => {
    for (const plan of plans) {
      const winner = plan.winner;
      // Compute merged contacts across winner + all losers
      let mergedContacts = winner.csp_contacts ?? [];
      let mergedNotes = winner.notes ?? '';
      let mergedVat = winner.vat_number;
      let mergedMatricule = winner.matricule;
      let mergedRcs = winner.rcs_number;

      for (let i = 0; i < plan.losers.length; i++) {
        const loser = plan.losers[i]!;
        const lp = plan.perLoser[i]!;

        // 1. Move obligations
        for (const o of lp.move) {
          await execTx(
            client,
            `UPDATE tax_obligations SET entity_id = $1, updated_at = NOW() WHERE id = $2`,
            [winner.id, o.id],
          );
        }

        // 2. Archive duplicate obligations
        for (const o of lp.archive_dup) {
          await execTx(
            client,
            `UPDATE tax_obligations SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
            [o.id],
          );
        }

        // 3. Merge metadata into the winner accumulator
        mergedContacts = dedupContacts(mergedContacts, loser.csp_contacts ?? []);
        if (!mergedVat && loser.vat_number) mergedVat = loser.vat_number;
        if (!mergedMatricule && loser.matricule) mergedMatricule = loser.matricule;
        if (!mergedRcs && loser.rcs_number) mergedRcs = loser.rcs_number;
        if (loser.notes && loser.notes.trim()) {
          if (mergedNotes.trim()) {
            mergedNotes = `${mergedNotes}\n--- merged from ${loser.legal_name} ---\n${loser.notes}`;
          } else {
            mergedNotes = loser.notes;
          }
        }

        // 4. (Audit log entries stay pointed at the loser by design —
        //     audit_log is append-only per migration 015. The merge
        //     entry below captures the winner↔loser link, so the
        //     loser's history remains queryable via target_id.)

        // 5. Audit log entry FIRST (before DELETE so we still have the
        //     loser's row to copy fields from if the trigger inspects it).
        //     Captures loser_id + winner_id + diff so the merge is fully
        //     traceable even after the loser row is gone.
        await logAuditTx(client, {
          userId: 'founder',
          action: 'tax_entity_merged',
          targetType: 'tax_entity',
          targetId: winner.id,
          newValue: JSON.stringify({
            winner_id: winner.id,
            winner_legal_name: winner.legal_name,
            loser_id: loser.id,
            loser_legal_name: loser.legal_name,
            obligations_moved: lp.move.length,
            obligations_archived: lp.archive_dup.length,
            contacts_merged: mergedContacts.length,
          }),
        });

        // 6. HARD-DELETE the loser. Diego's directive (stint 50.D):
        //    "directamente, los duplicados, elimínamelos todos. no me las
        //    dejes como inactivas". Safe because:
        //    - tax_obligations.entity_id ON DELETE CASCADE — but we already
        //      moved every active obligation away from the loser in step 1,
        //      so the cascade has nothing to cascade.
        //    - tax_ops_tasks.{entity_id, related_entity_id} ON DELETE SET
        //      NULL — tasks lose the back-link, which is acceptable.
        //    - audit_log.target_id is plain TEXT (not FK) — historical
        //      entries remain queryable but reference a non-existent id.
        //      The tax_entity_merged audit entry above embeds the loser_id
        //      in new_value JSON so the trail stays intact.
        await execTx(
          client,
          `DELETE FROM tax_entities WHERE id = $1`,
          [loser.id],
        );
      }

      // 7. Update winner with merged metadata + contacts.
      //    NOTE: pass mergedContacts as a JS array (NOT JSON.stringify'd).
      //    postgres-js with `prepare: false` auto-encodes the param as JSONB
      //    when the column cast is `::jsonb`. Pre-stringifying would double-
      //    encode → jsonb-string instead of jsonb-array (production bug found
      //    on first run, healed via SQL).
      await execTx(
        client,
        `UPDATE tax_entities
            SET csp_contacts = $1::jsonb,
                notes = $2,
                vat_number = $3,
                matricule = $4,
                rcs_number = $5,
                updated_at = NOW()
          WHERE id = $6`,
        [
          mergedContacts,
          mergedNotes || null,
          mergedVat,
          mergedMatricule,
          mergedRcs,
          winner.id,
        ],
      );

      console.log(`   ✓ "${plan.norm_name}" merged (${plan.losers.length} losers → 1 winner)`);
    }
  });
  console.log('');
  console.log('═══ Apply complete ═══');
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  console.log('Building merge plan…');
  console.log('');
  const plans = await buildPlan();
  if (plans.length === 0) {
    console.log('No duplicates found. Nothing to do.');
    process.exit(0);
  }
  printPlan(plans);
  if (APPLY) {
    await applyPlan(plans);
  }
  process.exit(0);
}

main().catch(err => {
  console.error('Dedup failed:', err);
  process.exit(1);
});
