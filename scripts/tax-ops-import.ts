#!/usr/bin/env tsx
// ════════════════════════════════════════════════════════════════════════
// scripts/tax-ops-import.ts
//
// One-shot migration: load Diego's two Excel files into the new
// /tax-ops tables. Notion "Tasks & Follow-ups" migration is deferred
// to a separate script (see scripts/tax-ops-notion-import.ts, landed
// with the tasks-module surface in stint 34.E) — the Notion REST
// token doesn't have the DB grant (only the MCP OAuth does), and
// the tasks table exists but has no UI yet, so migrating them now
// would be invisible anyway.
//
// Usage:
//   tsx scripts/tax-ops-import.ts --dry-run
//   tsx scripts/tax-ops-import.ts --commit
//
// Paths default to ~/Desktop/*.xlsx — override with flags:
//   --cit    /path/to/CIT.xlsx
//   --vat    /path/to/VAT.xlsx
//
// Dry-run prints a per-sheet summary + preview of entities + filings
// without touching the DB. Commit runs everything in a single
// transaction — if anything fails, nothing is written.
// ════════════════════════════════════════════════════════════════════════

import path from 'path';
import os from 'os';
import fs from 'fs';
import ExcelJS from 'exceljs';
import {
  parseStatusCell, normalizeLegalName, parsePeriodicity,
  parsePreparedWith, type FilingStatus,
} from '../src/lib/tax-ops-parsers';
import {
  computeDeadline, type DeadlineRule,
} from '../src/lib/tax-ops-deadlines';
import { tx, query, qTx, execTx, generateId, logAuditTx } from '../src/lib/db';

// ─── CLI args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const mode = args.includes('--commit') ? 'commit' : 'dry_run';
const citPath = flagValue('--cit') ?? path.join(os.homedir(), 'Desktop', 'CIT (DGM) - 2026.xlsx');
const vatPath = flagValue('--vat') ?? path.join(os.homedir(), 'Desktop', 'VAT & Others (DGM) - 2026.xlsx');

function flagValue(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

// ─── Normalized shape ────────────────────────────────────────────────

interface Row {
  source_file: 'cit' | 'vat';
  source_sheet: string;
  source_row: number;
  client_group_name: string | null;
  legal_name: string;
  periodicity_raw: string | null;
  tax_type: string;
  status: FilingStatus;
  status_residual: string | null;
  filed_at: string | null;
  draft_sent_at: string | null;
  prepared_with: string[];
  comment: string | null;
  period_label: string;          // "2026", "2026-Q1", "2026-01", …
  period_year: number;
  amount_due: number | null;
}

// ─── CIT parser ─────────────────────────────────────────────────────

async function parseCit(filePath: string): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const rows: Row[] = [];

  for (const ws of wb.worksheets) {
    const sheetName = ws.name.trim();
    // Find header row (first row with >=3 non-empty cells)
    let headerRow = 0;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r += 1) {
      const cells = ws.getRow(r).values as (unknown[] | null | undefined);
      if (!cells) continue;
      const nonEmpty = (cells as unknown[]).filter(v => v !== null && v !== undefined && String(v).trim() !== '').length;
      if (nonEmpty >= 3) { headerRow = r; break; }
    }
    if (!headerRow) continue;

    const headersRaw = ws.getRow(headerRow).values as unknown[];
    const headers = headersRaw.map(v => (v == null ? '' : String(v).trim()));

    const col = (name: string) => headers.findIndex(h => (h ?? '').toLowerCase().includes(name.toLowerCase()));
    const cCompany    = col('company');
    const cPeriodicty = headers.findIndex(h => /periodicity|scope of work|scope/i.test(h ?? ''));
    const cStatus     = col('status');
    const cComment    = col('comment');
    const cPrep       = col('prepared');
    const c2024TAR    = headers.findIndex(h => /2024.*tax.*assessment/i.test(h ?? ''));
    const c2026NWT    = headers.findIndex(h => /2026.*nwt/i.test(h ?? ''));

    // Sheet-shape detection: some sheets are "container" sheets where
    // col B carries the sub-group label (a fund family) per row. Others
    // are flat — col B is empty or constant and the sheet name itself
    // is the group. We decide dynamically: a sheet is a container if
    // col B has ≥3 distinct non-empty values across data rows.
    //
    // This keeps real customer names out of the source tree: no hardcoded
    // sheet-name check, pure structural heuristic.
    const colBValues = new Set<string>();
    for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
      const v = ws.getRow(r).values as unknown[] | null | undefined;
      if (v && typeof v[1] === 'string' && (v[1] as string).trim()) {
        colBValues.add((v[1] as string).trim());
      }
    }
    const isContainerSheet = colBValues.size >= 3;

    // Sheet may be a functional-currency-request sheet (CIT-adjacent but
    // distinct tax_type). Detect by sheet name OR a header pattern so
    // the check survives renames.
    const isFcrSheet =
      /^fcr$/i.test(sheetName) ||
      headers.some(h => /functional.*currency.*request/i.test(h ?? ''));

    for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
      const rv = ws.getRow(r).values as unknown[];
      if (!rv) continue;
      const companyRaw = rv[cCompany];
      if (!companyRaw || typeof companyRaw !== 'string' || !companyRaw.trim()) continue;

      // Container sheets: group = col B; flat sheets: group = sheet name.
      const groupInline = rv[1] && typeof rv[1] === 'string' ? (rv[1] as string).trim() : null;
      const groupName = (isContainerSheet && groupInline) ? groupInline : sheetName.replace(/\s+$/, '');

      const periodicity = cPeriodicty >= 0 ? String(rv[cPeriodicty] ?? '') : '';
      const statusText = cStatus >= 0 ? String(rv[cStatus] ?? '') : '';
      const commentText = cComment >= 0 ? String(rv[cComment] ?? '') : '';
      const prepText = cPrep >= 0 ? String(rv[cPrep] ?? '') : '';

      const parsed = parseStatusCell(statusText || commentText || '');
      const prepared = parsePreparedWith(prepText);

      // Main 2026 CIT annual filing
      rows.push({
        source_file: 'cit', source_sheet: sheetName, source_row: r,
        client_group_name: groupName, legal_name: companyRaw.trim(),
        periodicity_raw: periodicity || 'Annual',
        tax_type: isFcrSheet ? 'functional_currency_request' : 'cit_annual',
        status: parsed.status,
        status_residual: parsed.residual_comment ?? null,
        filed_at: parsed.filed_at ?? null,
        draft_sent_at: parsed.draft_sent_at ?? null,
        prepared_with: prepared,
        comment: commentText || parsed.residual_comment || null,
        period_label: '2026', period_year: 2026,
        amount_due: null,
      });

      // 2024 tax assessment received column → historical 2024 filing
      if (c2024TAR >= 0) {
        const cell2024 = String(rv[c2024TAR] ?? '').trim();
        if (cell2024) {
          const isYes = /^yes$/i.test(cell2024);
          rows.push({
            source_file: 'cit', source_sheet: sheetName, source_row: r,
            client_group_name: groupName, legal_name: companyRaw.trim(),
            periodicity_raw: 'Annual', tax_type: 'cit_annual',
            // Stint 43 enum v3: assessment_received was retired; the
            // date lives separately in tax_assessment_received_at. We
            // tag both rows as 'filed'; the actual assessment date is
            // captured by other columns of the import script.
            status: 'filed',
            status_residual: isYes ? null : cell2024,
            filed_at: null, draft_sent_at: null,
            prepared_with: prepared, comment: cell2024,
            period_label: '2024', period_year: 2024, amount_due: null,
          });
        }
      }

      // NWT 2026 check column → nwt_annual 2026 filing
      if (c2026NWT >= 0) {
        const cellNwt = String(rv[c2026NWT] ?? '').trim();
        if (cellNwt) {
          const nwtParsed = parseStatusCell(cellNwt);
          rows.push({
            source_file: 'cit', source_sheet: sheetName, source_row: r,
            client_group_name: groupName, legal_name: companyRaw.trim(),
            periodicity_raw: 'Annual', tax_type: 'nwt_annual',
            status: nwtParsed.status,
            status_residual: nwtParsed.residual_comment ?? null,
            filed_at: nwtParsed.filed_at ?? null,
            draft_sent_at: null, prepared_with: prepared, comment: cellNwt,
            period_label: '2026', period_year: 2026, amount_due: null,
          });
        }
      }
    }
  }
  return rows;
}

// ─── VAT parser ─────────────────────────────────────────────────────

const VAT_SHEET_TO_TYPE: Record<string, { tax_type: string; period_pattern: string }> = {
  '2026 Annual':           { tax_type: 'vat_annual',                 period_pattern: 'annual' },
  'Quarterly 2026':        { tax_type: 'vat_quarterly',              period_pattern: 'quarterly' },
  'Monthly 2026':          { tax_type: 'vat_monthly',                period_pattern: 'monthly' },
  'Subscription Tax':      { tax_type: 'subscription_tax_quarterly', period_pattern: 'quarterly' },
  'WHT director':          { tax_type: 'wht_director_monthly',       period_pattern: 'monthly' },
  'VAT (de)registration':  { tax_type: 'vat_registration',           period_pattern: 'adhoc' },
  'BCL Reporting':         { tax_type: 'bcl_sbs_quarterly',          period_pattern: 'quarterly' },
};

const QUARTER_LABELS = ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4'];
const MONTH_LABELS = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);

async function parseVat(filePath: string): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const rows: Row[] = [];

  for (const ws of wb.worksheets) {
    const mapping = VAT_SHEET_TO_TYPE[ws.name.trim()];
    if (!mapping) continue;

    let headerRow = 0;
    for (let r = 1; r <= Math.min(10, ws.rowCount); r += 1) {
      const cells = ws.getRow(r).values as unknown[] | null | undefined;
      if (!cells) continue;
      const nonEmpty = (cells as unknown[]).filter(v => v !== null && v !== undefined && String(v).trim() !== '').length;
      if (nonEmpty >= 3) { headerRow = r; break; }
    }
    if (!headerRow) continue;
    const headers = (ws.getRow(headerRow).values as unknown[]).map(v => v == null ? '' : String(v).trim());
    const col = (name: string) => headers.findIndex(h => (h ?? '').toLowerCase().includes(name.toLowerCase()));
    const cCompany = col('company');
    const cStatus  = col('status');
    const cPeriod  = headers.findIndex(h => /periodicity|periodicidad/i.test(h ?? ''));
    const cComment = col('comment');
    const cPrep    = col('prepared');

    // Per-period column indices
    const cQ1 = headers.findIndex(h => /^q1/i.test(h ?? ''));
    const cQ2 = headers.findIndex(h => /^q2/i.test(h ?? ''));
    const cQ3 = headers.findIndex(h => /^q3/i.test(h ?? ''));
    const cQ4 = headers.findIndex(h => /^q4/i.test(h ?? ''));
    const monthCols: Array<[string, number]> = [
      ['January', col('january')], ['February', col('february')], ['March', col('march')],
      ['April', col('april')], ['May', col('may')], ['June', col('june')],
      ['July', col('july')], ['August', col('august')], ['September', col('september')],
      ['October', col('october')], ['November', col('november')], ['December', col('december')],
    ];

    for (let r = headerRow + 1; r <= ws.rowCount; r += 1) {
      const rv = ws.getRow(r).values as unknown[];
      if (!rv) continue;
      const companyRaw = rv[cCompany];
      if (!companyRaw || typeof companyRaw !== 'string' || !companyRaw.trim()) continue;

      const groupRaw = rv[1];
      const groupName = groupRaw && typeof groupRaw === 'string' ? (groupRaw as string).trim() : 'UNGROUPED';
      const prepared  = parsePreparedWith(cPrep >= 0 ? String(rv[cPrep] ?? '') : '');
      const comment   = cComment >= 0 ? String(rv[cComment] ?? '').trim() : '';

      // Per-period cells: create one filing per non-empty cell
      const perPeriodCells: Array<[string, string]> = [];
      if (cQ1 >= 0 && rv[cQ1]) perPeriodCells.push([QUARTER_LABELS[0]!, String(rv[cQ1])]);
      if (cQ2 >= 0 && rv[cQ2]) perPeriodCells.push([QUARTER_LABELS[1]!, String(rv[cQ2])]);
      if (cQ3 >= 0 && rv[cQ3]) perPeriodCells.push([QUARTER_LABELS[2]!, String(rv[cQ3])]);
      if (cQ4 >= 0 && rv[cQ4]) perPeriodCells.push([QUARTER_LABELS[3]!, String(rv[cQ4])]);
      monthCols.forEach(([, idx], i) => {
        if (idx >= 0 && rv[idx]) perPeriodCells.push([MONTH_LABELS[i]!, String(rv[idx])]);
      });

      const periodicityRaw = cPeriod >= 0 ? String(rv[cPeriod] ?? '') : '';
      const statusText = cStatus >= 0 ? String(rv[cStatus] ?? '') : '';

      if (perPeriodCells.length > 0) {
        // Per-period rows. Status for each is parsed from its cell.
        for (const [label, cellText] of perPeriodCells) {
          const parsed = parseStatusCell(cellText);
          rows.push({
            source_file: 'vat', source_sheet: ws.name.trim(), source_row: r,
            client_group_name: groupName, legal_name: companyRaw.trim(),
            periodicity_raw: periodicityRaw || null,
            tax_type: mapping.tax_type,
            status: parsed.status,
            status_residual: parsed.residual_comment ?? null,
            filed_at: parsed.filed_at ?? null,
            draft_sent_at: parsed.draft_sent_at ?? null,
            prepared_with: prepared, comment: comment || null,
            period_label: label,
            period_year: Number(label.slice(0, 4)),
            amount_due: null,
          });
        }
      } else {
        // Single-filing row (annual / adhoc).
        const parsed = parseStatusCell(statusText || comment);
        const label = mapping.period_pattern === 'adhoc' ? `2026-ADHOC-${r}` : '2026';
        rows.push({
          source_file: 'vat', source_sheet: ws.name.trim(), source_row: r,
          client_group_name: groupName, legal_name: companyRaw.trim(),
          periodicity_raw: periodicityRaw || null,
          tax_type: mapping.tax_type,
          status: parsed.status,
          status_residual: parsed.residual_comment ?? null,
          filed_at: parsed.filed_at ?? null,
          draft_sent_at: parsed.draft_sent_at ?? null,
          prepared_with: prepared, comment: comment || null,
          period_label: label, period_year: 2026, amount_due: null,
        });
      }
    }
  }
  return rows;
}

// ─── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('─────────────────────────────────────────────');
  console.log(`Tax-Ops importer · mode=${mode}`);
  console.log(`CIT file: ${citPath}`);
  console.log(`VAT file: ${vatPath}`);
  console.log('Notion migration deferred to 34.E (tasks surface).');
  console.log('─────────────────────────────────────────────\n');

  // Fail fast if files are missing — saves a confusing traceback
  if (!fs.existsSync(citPath)) { console.error(`CIT file not found: ${citPath}`); process.exit(1); }
  if (!fs.existsSync(vatPath)) { console.error(`VAT file not found: ${vatPath}`); process.exit(1); }

  const citRows = await parseCit(citPath);
  const vatRows = await parseVat(vatPath);
  const allRows = [...citRows, ...vatRows];

  // Normalize group names: "FOO" / "Foo" / "foo " all collapse to "FOO".
  // We uppercase + collapse whitespace so the same fund family doesn't split
  // across case / trailing-space variants in the source Excels.
  const normalizeGroup = (raw: string | null): string | null => {
    if (!raw) return null;
    const cleaned = raw.replace(/\s+/g, ' ').trim().toUpperCase();
    return cleaned || null;
  };
  for (const r of allRows) r.client_group_name = normalizeGroup(r.client_group_name);

  // Deduplicate entities by normalized legal_name + client_group
  const entityMap = new Map<string, { legal_name: string; client_group_name: string | null }>();
  for (const r of allRows) {
    const key = `${r.client_group_name ?? ''}|${normalizeLegalName(r.legal_name)}`;
    if (!entityMap.has(key)) {
      entityMap.set(key, { legal_name: r.legal_name, client_group_name: r.client_group_name });
    }
  }

  // Collect unique client groups
  const groupNames = new Set<string>();
  for (const r of allRows) if (r.client_group_name) groupNames.add(r.client_group_name);

  // Obligations = unique (entity, tax_type, period_pattern)
  const obligations = new Map<string, { entity_key: string; tax_type: string; period_pattern: string }>();
  for (const r of allRows) {
    const entityKey = `${r.client_group_name ?? ''}|${normalizeLegalName(r.legal_name)}`;
    for (const period_pattern of parsePeriodicity(r.periodicity_raw)) {
      const oblKey = `${entityKey}|${r.tax_type}|${period_pattern}`;
      if (!obligations.has(oblKey)) {
        obligations.set(oblKey, { entity_key: entityKey, tax_type: r.tax_type, period_pattern });
      }
    }
  }

  console.log('──── Summary ────');
  console.log(`  Client groups: ${groupNames.size}`);
  console.log(`  Unique entities: ${entityMap.size}`);
  console.log(`  Obligations: ${obligations.size}`);
  console.log(`  Filings: ${allRows.length}`);
  console.log();

  console.log('──── Group breakdown ────');
  const groupCounts = new Map<string, number>();
  for (const e of entityMap.values()) {
    const g = e.client_group_name ?? '(none)';
    groupCounts.set(g, (groupCounts.get(g) ?? 0) + 1);
  }
  for (const [g, n] of Array.from(groupCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${g.padEnd(30)} ${n} entities`);
  }
  console.log();

  console.log('──── Filings by tax_type ────');
  const byType = new Map<string, number>();
  for (const r of allRows) byType.set(r.tax_type, (byType.get(r.tax_type) ?? 0) + 1);
  for (const [t, n] of Array.from(byType.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t.padEnd(30)} ${n}`);
  }
  console.log();

  console.log('──── Filings by status ────');
  const byStatus = new Map<string, number>();
  for (const r of allRows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);
  for (const [s, n] of Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(30)} ${n}`);
  }
  console.log();

  if (mode === 'dry_run') {
    console.log('DRY RUN — no DB changes. Re-run with --commit to write.');
    return;
  }

  // ─── COMMIT MODE ──────────────────────────────────────────────────
  console.log('Writing to DB (transactional)…\n');

  // Load deadline rules for deadline_date computation
  const ruleRows = await query<DeadlineRule>(
    `SELECT tax_type, period_pattern, rule_kind, rule_params, admin_tolerance_days
       FROM tax_deadline_rules`,
  );
  const ruleByKey = new Map<string, DeadlineRule>();
  for (const r of ruleRows) ruleByKey.set(`${r.tax_type}|${r.period_pattern}`, r);

  const summary = await tx(async (txSql) => {
    // 1. Client groups — idempotent INSERT...ON CONFLICT, then read back the id
    const groupIdByName = new Map<string, string>();
    for (const name of groupNames) {
      const id = generateId();
      await execTx(
        txSql,
        `INSERT INTO tax_client_groups (id, name) VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET updated_at = NOW()`,
        [id, name],
      );
      const existing = await qTx<{ id: string }>(
        txSql,
        `SELECT id FROM tax_client_groups WHERE name = $1`,
        [name],
      );
      groupIdByName.set(name, existing[0]!.id);
    }

    // 2. Entities — no UNIQUE on legal_name, so we insert per dedup key
    const entityIdByKey = new Map<string, string>();
    for (const [key, entity] of entityMap) {
      const id = generateId();
      const groupId = entity.client_group_name
        ? groupIdByName.get(entity.client_group_name) ?? null
        : null;
      await execTx(
        txSql,
        `INSERT INTO tax_entities (id, client_group_id, legal_name)
         VALUES ($1, $2, $3)`,
        [id, groupId, entity.legal_name],
      );
      entityIdByKey.set(key, id);
    }

    // 3. Obligations — UNIQUE (entity_id, tax_type, period_pattern). We insert
    //    with ON CONFLICT DO NOTHING then read back by the natural key, so the
    //    obligationIdByKey always maps to the row actually in the DB.
    const obligationIdByKey = new Map<string, string>();
    for (const [key, ob] of obligations) {
      const entityId = entityIdByKey.get(ob.entity_key);
      if (!entityId) continue;
      const id = generateId();
      await execTx(
        txSql,
        `INSERT INTO tax_obligations (id, entity_id, tax_type, period_pattern)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (entity_id, tax_type, period_pattern) DO NOTHING`,
        [id, entityId, ob.tax_type, ob.period_pattern],
      );
      const readBack = await qTx<{ id: string }>(
        txSql,
        `SELECT id FROM tax_obligations
          WHERE entity_id = $1 AND tax_type = $2 AND period_pattern = $3`,
        [entityId, ob.tax_type, ob.period_pattern],
      );
      if (readBack[0]) obligationIdByKey.set(key, readBack[0].id);
    }

    // 4. Filings — one row per parsed Excel cell. UNIQUE (obligation_id,
    //    period_label) so re-runs are idempotent.
    let filingCount = 0;
    for (const r of allRows) {
      const entityKey = `${r.client_group_name ?? ''}|${normalizeLegalName(r.legal_name)}`;
      const patterns = parsePeriodicity(r.periodicity_raw);
      // Heuristic: pick the obligation pattern matching the filing's period label.
      const matchedPattern =
        r.period_label.includes('-Q') ? 'quarterly' :
        /^\d{4}-\d{2}$/.test(r.period_label) ? 'monthly' :
        r.period_label.includes('-S') ? 'semester' :
        r.period_label.startsWith('2024-ADHOC') || r.period_label.startsWith('2025-ADHOC') || r.period_label.startsWith('2026-ADHOC') ? 'adhoc' :
        /^\d{4}$/.test(r.period_label) ? 'annual' :
        patterns[0] ?? 'annual';
      const oblKey = `${entityKey}|${r.tax_type}|${matchedPattern}`;
      const oblId = obligationIdByKey.get(oblKey);
      if (!oblId) continue;

      const rule = ruleByKey.get(`${r.tax_type}|${matchedPattern}`);
      let deadlineIso: string | null = null;
      if (rule && !r.period_label.includes('-ADHOC')) {
        try { deadlineIso = computeDeadline(rule, r.period_year, r.period_label).effective; }
        catch { deadlineIso = null; }
      }

      const id = generateId();
      await execTx(
        txSql,
        `INSERT INTO tax_filings
           (id, obligation_id, period_year, period_label, deadline_date,
            status, prepared_with, filed_at, draft_sent_at, comments, import_source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (obligation_id, period_label) DO NOTHING`,
        [
          id, oblId, r.period_year, r.period_label, deadlineIso,
          r.status, r.prepared_with, r.filed_at, r.draft_sent_at,
          r.comment ?? r.status_residual ?? null, 'excel_import',
        ],
      );
      filingCount += 1;
    }

    // 5. Audit trail — one summary row for the whole import. Cheap + lets
    //    Diego see in /audit that 2026-04-24 had a bulk excel_import.
    await logAuditTx(txSql, {
      userId: 'founder',
      action: 'tax_ops_bulk_import',
      targetType: 'tax_filings',
      targetId: 'excel_import_' + new Date().toISOString().slice(0, 10),
      newValue: JSON.stringify({
        groups: groupNames.size,
        entities: entityMap.size,
        obligations: obligations.size,
        filings: filingCount,
      }),
    });

    return {
      groups: groupNames.size,
      entities: entityMap.size,
      obligations: obligations.size,
      filings: filingCount,
    };
  });

  console.log(`✓ Inserted: ${summary.groups} groups, ${summary.entities} entities,`);
  console.log(`  ${summary.obligations} obligations, ${summary.filings} filings.`);
  console.log('  (Notion tasks deferred to stint 34.E.)');

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
