'use client';

// ════════════════════════════════════════════════════════════════════════
// /clients/[id]/bulk-import — batch-create entities under a client from
// a pasted CSV/TSV. Gassner audit item #2: the onboarding cost for a
// 40-entity client should not be 40 separate clicks.
//
// UX flow:
//   1. Paste CSV/TSV (header row required).
//   2. Parse client-side, map columns to canonical names (case-
//      insensitive, accepts several aliases). Show parsed preview
//      with a count + warnings for unrecognised columns.
//   3. Hit Import. The server validates each row independently and
//      returns { created, skipped }. Skipped rows appear with their
//      per-row reason so the reviewer fixes + re-imports.
// ════════════════════════════════════════════════════════════════════════

import { useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  UploadCloudIcon, CheckCircle2Icon, AlertTriangleIcon,
  ArrowLeftIcon, FileTextIcon, Loader2Icon,
} from 'lucide-react';

// Canonical column names — the server expects these after mapping.
type CanonicalCol =
  | 'name' | 'vat_number' | 'matricule' | 'rcs_number'
  | 'legal_form' | 'entity_type' | 'regime' | 'frequency' | 'address';

// Aliases → canonical. Keys lowercase + stripped of spaces/underscores.
const ALIASES: Record<string, CanonicalCol> = {
  name: 'name',
  entityname: 'name',
  denomination: 'name',
  denominacion: 'name',
  raisonsociale: 'name',
  vat: 'vat_number',
  vatnumber: 'vat_number',
  vatid: 'vat_number',
  numtva: 'vat_number',
  ntva: 'vat_number',
  iva: 'vat_number',
  matricule: 'matricule',
  matriculenum: 'matricule',
  matriculenational: 'matricule',
  rcs: 'rcs_number',
  rcsnumber: 'rcs_number',
  rcsnum: 'rcs_number',
  rcsno: 'rcs_number',
  legalform: 'legal_form',
  legal_form: 'legal_form',
  form: 'legal_form',
  entitytype: 'entity_type',
  type: 'entity_type',
  entity_type: 'entity_type',
  regime: 'regime',
  regim: 'regime',
  frequency: 'frequency',
  filingfrequency: 'frequency',
  freq: 'frequency',
  address: 'address',
  addr: 'address',
  adresse: 'address',
  direccion: 'address',
};

interface PreviewRow {
  raw: string[];
  mapped: Record<string, string>;
  warnings: string[];
}

interface ImportResult {
  created: Array<{ id: string; name: string }>;
  skipped: Array<{ row_index: number; reason: string; input: Record<string, unknown> }>;
  summary: { total: number; created: number; skipped: number };
}

function normaliseHeader(h: string): string {
  return h.toLowerCase().replace(/[\s_-]+/g, '').trim();
}

function parseCSV(text: string): { header: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [] };

  // Accept tab-separated OR comma-separated; detect by first line.
  const delim = lines[0].includes('\t') ? '\t' : ',';

  const parseLine = (line: string): string[] => {
    if (delim === '\t') return line.split('\t').map(c => c.trim());
    // CSV: handle quoted cells with embedded commas.
    const cells: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  };

  const header = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine);
  return { header, rows };
}

export default function BulkImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: clientId } = use(params);
  const router = useRouter();

  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<number, CanonicalCol | null>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleParse() {
    setError(null);
    setResult(null);
    const parsed = parseCSV(text);
    if (parsed.header.length === 0) {
      setError('Could not parse — did you paste a header row?');
      return;
    }

    // Auto-map via alias dictionary.
    const initialMapping: Record<number, CanonicalCol | null> = {};
    parsed.header.forEach((h, i) => {
      const key = normaliseHeader(h);
      initialMapping[i] = ALIASES[key] ?? null;
    });

    // Build preview rows.
    const previewRows = parsed.rows.slice(0, 20).map(raw => {
      const mapped: Record<string, string> = {};
      const warnings: string[] = [];
      raw.forEach((cell, i) => {
        const col = initialMapping[i];
        if (col) mapped[col] = cell;
      });
      if (!mapped.name) warnings.push('Missing name');
      return { raw, mapped, warnings };
    });

    setHeader(parsed.header);
    setMapping(initialMapping);
    setPreview(previewRows);
    // Re-render the full dataset for the import step.
    (window as unknown as { __cifra_bulk_rows?: string[][] }).__cifra_bulk_rows = parsed.rows;
  }

  async function handleImport() {
    setError(null);
    setImporting(true);
    try {
      const raw = (window as unknown as { __cifra_bulk_rows?: string[][] }).__cifra_bulk_rows ?? [];
      const payload = raw.map(r => {
        const row: Record<string, string> = {};
        r.forEach((cell, i) => {
          const col = mapping[i];
          if (col) row[col] = cell;
        });
        return row;
      });

      const res = await fetch('/api/entities/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, rows: payload }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? 'Import failed.');
        return;
      }
      setResult(body as ImportResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setImporting(false);
    }
  }

  function updateMapping(index: number, col: CanonicalCol | null) {
    setMapping(m => ({ ...m, [index]: col }));
    // Re-render preview mapping.
    if (preview) {
      setPreview(preview.map(r => {
        const mapped: Record<string, string> = {};
        const warnings: string[] = [];
        r.raw.forEach((cell, i) => {
          const c = i === index ? col : mapping[i];
          if (c) mapped[c] = cell;
        });
        if (!mapped.name) warnings.push('Missing name');
        return { raw: r.raw, mapped, warnings };
      }));
    }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-5">
        <Link
          href={`/clients/${clientId}`}
          className="text-[11.5px] text-ink-muted hover:text-ink inline-flex items-center gap-1"
        >
          <ArrowLeftIcon size={12} /> Back to client
        </Link>
        <h1 className="text-[22px] font-semibold tracking-tight mt-1">
          Bulk-import entities
        </h1>
        <p className="text-[12.5px] text-ink-muted mt-1">
          Paste a CSV/TSV with a header row. Aliases are auto-mapped; you can tweak any column before importing.
        </p>
      </div>

      {!preview && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-[12px] text-ink-soft mb-2">
            <strong>Expected columns</strong> (any subset is fine; at minimum include a name column):
            <ul className="mt-1 ml-4 list-disc text-[11.5px] text-ink-muted">
              <li><code>name</code> — entity legal name (required)</li>
              <li><code>vat_number</code> — validated, e.g. <code>LU12345678</code></li>
              <li><code>matricule</code>, <code>rcs_number</code></li>
              <li><code>legal_form</code> — SARL, SA, SCSp, SICAV, RAIF, …</li>
              <li><code>entity_type</code> — <code>fund</code>, <code>active_holding</code>, <code>passive_holding</code>, <code>gp</code>, <code>manco</code>, <code>other</code></li>
              <li><code>regime</code> — <code>simplified</code> / <code>ordinary</code> (default simplified)</li>
              <li><code>frequency</code> — <code>monthly</code> / <code>quarterly</code> / <code>yearly</code> (default quarterly)</li>
              <li><code>address</code></li>
            </ul>
          </div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={`name,vat_number,entity_type,regime,frequency\nAcme SOPARFI SARL,LU12345678,active_holding,ordinary,quarterly\nBeta Fund SCSp,LU87654321,fund,simplified,quarterly`}
            rows={12}
            className="w-full border border-border-strong rounded px-3 py-2 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            spellCheck={false}
          />
          {error && (
            <div className="mt-2 px-3 py-2 bg-danger-50 border border-danger-200 text-[11.5px] text-danger-800 rounded">
              {error}
            </div>
          )}
          <div className="mt-3 flex justify-end">
            <button
              onClick={handleParse}
              disabled={!text.trim()}
              className="h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <FileTextIcon size={13} /> Parse + preview
            </button>
          </div>
        </div>
      )}

      {preview && !result && (
        <div className="space-y-4">
          {/* Column mapping */}
          <div className="bg-surface border border-border rounded-lg p-4">
            <h3 className="text-[13px] font-semibold text-ink mb-2">Column mapping</h3>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {header.map((h, i) => (
                <label key={i} className="block">
                  <div className="text-[10px] uppercase tracking-wide text-ink-muted mb-0.5">
                    Col {i + 1}: <span className="font-mono">{h}</span>
                  </div>
                  <select
                    value={mapping[i] ?? ''}
                    onChange={e => updateMapping(i, (e.target.value || null) as CanonicalCol | null)}
                    className="w-full border border-border-strong rounded px-2 py-1 text-[11.5px] bg-white"
                  >
                    <option value="">— ignore —</option>
                    <option value="name">name *</option>
                    <option value="vat_number">vat_number</option>
                    <option value="matricule">matricule</option>
                    <option value="rcs_number">rcs_number</option>
                    <option value="legal_form">legal_form</option>
                    <option value="entity_type">entity_type</option>
                    <option value="regime">regime</option>
                    <option value="frequency">frequency</option>
                    <option value="address">address</option>
                  </select>
                </label>
              ))}
            </div>
          </div>

          {/* Preview table */}
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-divider flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink">
                Preview · first {preview.length} row{preview.length === 1 ? '' : 's'}
              </h3>
              <div className="text-[11px] text-ink-muted">
                {preview.filter(p => p.warnings.length === 0).length} valid ·{' '}
                {preview.filter(p => p.warnings.length > 0).length} with warnings
              </div>
            </div>
            <div className="overflow-x-auto max-h-[420px]">
              <table className="w-full text-[11.5px]">
                <thead className="bg-surface-alt text-ink-muted uppercase text-[10px] tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2">Name</th>
                    <th className="text-left px-3 py-2">VAT</th>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Form</th>
                    <th className="text-left px-3 py-2">Regime / Freq</th>
                    <th className="text-left px-3 py-2">⚠</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} className="border-t border-divider">
                      <td className="px-3 py-1.5">{r.mapped.name || <span className="text-danger-600">—</span>}</td>
                      <td className="px-3 py-1.5 font-mono">{r.mapped.vat_number || '—'}</td>
                      <td className="px-3 py-1.5">{r.mapped.entity_type || '—'}</td>
                      <td className="px-3 py-1.5">{r.mapped.legal_form || '—'}</td>
                      <td className="px-3 py-1.5">
                        {(r.mapped.regime || 'simplified')} / {(r.mapped.frequency || 'quarterly')}
                      </td>
                      <td className="px-3 py-1.5 text-amber-600">
                        {r.warnings.join(', ') || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 bg-danger-50 border border-danger-200 text-[11.5px] text-danger-800 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-between items-center">
            <button
              onClick={() => { setPreview(null); setError(null); }}
              className="h-9 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
            >
              Change input
            </button>
            <button
              onClick={handleImport}
              disabled={importing}
              className="h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {importing ? <Loader2Icon size={13} className="animate-spin" /> : <UploadCloudIcon size={13} />}
              {importing ? 'Importing…' : 'Import entities'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 inline-flex items-center justify-center shrink-0">
              <CheckCircle2Icon size={20} />
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-ink">
                Created {result.summary.created} entit{result.summary.created === 1 ? 'y' : 'ies'} · Skipped {result.summary.skipped}
              </h3>
              <p className="text-[12.5px] text-ink-muted mt-1">
                From {result.summary.total} row{result.summary.total === 1 ? '' : 's'} submitted.
              </p>
            </div>
          </div>

          {result.skipped.length > 0 && (
            <div className="mt-5">
              <div className="text-[11.5px] uppercase tracking-wide font-semibold text-amber-800 mb-2 inline-flex items-center gap-1.5">
                <AlertTriangleIcon size={12} /> Rows skipped — fix + re-paste
              </div>
              <ul className="bg-amber-50 border border-amber-200 rounded divide-y divide-amber-200 text-[11.5px]">
                {result.skipped.map((s, i) => (
                  <li key={i} className="px-3 py-2">
                    <div className="text-amber-900 font-semibold">Row {s.row_index + 1}: {s.reason}</div>
                    <div className="text-amber-800/80 mt-0.5 font-mono text-[11px]">
                      {JSON.stringify(s.input)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 flex gap-2">
            <button
              onClick={() => router.push(`/clients/${clientId}`)}
              className="h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600"
            >
              Back to client
            </button>
            <button
              onClick={() => { setResult(null); setPreview(null); setText(''); setError(null); }}
              className="h-9 px-3 rounded border border-border-strong text-[12px] text-ink-muted hover:text-ink"
            >
              Import another batch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
