'use client';

// ════════════════════════════════════════════════════════════════════════
// ExcelImportModal
//
// The "client sent us an Excel instead of PDFs" flow.
//
// Why this exists: per Diego's customer discovery 2026-04-18, VAT
// professionals regularly receive client data in spreadsheets (not
// PDFs). Forcing the client to fill cifra's template is unrealistic —
// the reviewer has to work with whatever arrives. cifra's answer:
// accept anything, ask Claude to map the columns, show a preview, and
// let the reviewer confirm before inserting.
//
// Flow:
//   1. pick:       reviewer picks .xlsx / .csv file
//   2. previewing: we POST to /excel/preview → Claude suggests mapping
//                  + all rows parsed, nothing saved yet
//   3. review:     reviewer sees suggested mapping + every row's
//                  parsed state + per-row warnings. They can re-map
//                  any column from a dropdown of actual headers.
//   4. importing:  POST /excel/import with reviewer-confirmed rows
//   5. done:       toast with "X imported / Y skipped". Close.
//
// The preview/confirm split is deliberate. Blind-inserting 150 rows
// where "Amount" is actually VAT destroys a declaration. The two-
// phase design turns that from "undo hell" into "fix the mapping,
// re-confirm".
// ════════════════════════════════════════════════════════════════════════

import { useMemo, useRef, useState } from 'react';
import {
  FileSpreadsheetIcon, UploadIcon, XIcon, CheckIcon, Loader2Icon,
  AlertTriangleIcon, SparklesIcon,
} from 'lucide-react';

const CANONICAL_FIELDS = [
  'provider',
  'provider_vat',
  'country',
  'invoice_number',
  'invoice_date',
  'description',
  'amount_eur',
  'vat_rate',
  'vat_applied',
  'direction',
  'currency',
] as const;
type CanonicalField = typeof CANONICAL_FIELDS[number];
type Mapping = Partial<Record<CanonicalField, string | null>>;

// Human-readable labels for the mapping table.
const FIELD_LABEL: Record<CanonicalField, string> = {
  provider:       'Provider',
  provider_vat:   'Provider VAT',
  country:        'Country',
  invoice_number: 'Invoice #',
  invoice_date:   'Invoice date',
  description:    'Description',
  amount_eur:     'Amount (EUR)',
  vat_rate:       'VAT rate',
  vat_applied:    'VAT amount',
  direction:      'Direction (in/out)',
  currency:       'Currency',
};
const REQUIRED_FIELDS: CanonicalField[] = ['provider', 'amount_eur'];

interface ParsedRow {
  idx: number;
  raw: Record<string, unknown>;
  parsed: {
    provider: string | null;
    provider_vat: string | null;
    country: string | null;
    invoice_number: string | null;
    invoice_date: string | null;
    description: string | null;
    amount_eur: number | null;
    vat_rate: number | null;
    vat_applied: number | null;
    direction: 'incoming' | 'outgoing' | null;
    currency: string | null;
  };
  warnings: string[];
}

interface PreviewResponse {
  source: {
    filename: string; sheet_name: string; rows_detected: number;
    mapping_source: 'ai' | 'heuristic';
  };
  headers: string[];
  mapping: Mapping;
  rows: ParsedRow[];
  warnings: string[];
}

type Phase = 'pick' | 'previewing' | 'review' | 'importing' | 'done';

export function ExcelImportModal({
  declarationId, onClose, onImported,
}: {
  declarationId: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('pick');
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [finalResult, setFinalResult] = useState<{ imported: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handlePick(files: FileList | null) {
    const f = files?.[0];
    if (!f) return;
    setError(null);
    setPhase('previewing');
    try {
      const form = new FormData();
      form.append('file', f);
      const res = await fetch(`/api/declarations/${declarationId}/excel/preview`, {
        method: 'POST', body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Could not parse the file.');
        setPhase('pick');
        return;
      }
      setPreview(data as PreviewResponse);
      setMapping(data.mapping as Mapping);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setPhase('pick');
    }
  }

  // Live-reparse rows when the user edits the mapping. This is purely
  // client-side: we shuffle the same raw values around according to the
  // new header→field binding. No extra API call.
  const remappedRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.map(r => {
      const newParsed = { ...r.parsed };
      for (const field of CANONICAL_FIELDS) {
        const header = mapping[field];
        const rawVal = header ? r.raw[header] : undefined;
        if (rawVal == null || rawVal === '') {
          (newParsed as Record<string, unknown>)[field] = null;
        } else if (field === 'amount_eur' || field === 'vat_applied') {
          (newParsed as Record<string, unknown>)[field] = typeof rawVal === 'number'
            ? rawVal
            : Number(String(rawVal).replace(/[^\d.,-]/g, '').replace(/\./g, '').replace(',', '.'));
        } else if (field === 'vat_rate') {
          const n = typeof rawVal === 'number' ? rawVal : Number(String(rawVal).replace('%', '').replace(',', '.'));
          (newParsed as Record<string, unknown>)[field] = Number.isFinite(n) ? (n > 1 ? n / 100 : n) : null;
        } else {
          (newParsed as Record<string, unknown>)[field] = String(rawVal);
        }
      }
      return { ...r, parsed: newParsed };
    });
  }, [preview, mapping]);

  const validRows = remappedRows.filter(r => r.parsed.provider && r.parsed.amount_eur != null);
  const skippedRows = remappedRows.length - validRows.length;
  const missingRequired = REQUIRED_FIELDS.filter(f => !mapping[f]);

  async function handleImport() {
    if (!preview) return;
    setError(null);
    setPhase('importing');
    try {
      const rows = validRows.map(r => r.parsed);
      const res = await fetch(`/api/declarations/${declarationId}/excel/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Import failed.');
        setPhase('review');
        return;
      }
      setFinalResult({
        imported: Number(data.imported) || 0,
        errors: Array.isArray(data.errors) ? data.errors.length : 0,
      });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setPhase('review');
    }
  }

  function handleClose() {
    // If we imported anything, refresh the parent before closing.
    if (phase === 'done' && finalResult && finalResult.imported > 0) {
      onImported();
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-modal bg-ink/75 backdrop-blur-[6px] flex items-center justify-center p-4 animate-fadeIn"
      role="presentation"
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="xl-title"
        className="bg-surface rounded-lg w-full max-w-4xl shadow-2xl max-h-[90vh] flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center">
              <FileSpreadsheetIcon size={14} />
            </div>
            <div>
              <h3 id="xl-title" className="text-base font-semibold text-ink leading-tight">
                Import invoices from Excel
              </h3>
              <p className="text-xs text-ink-muted mt-0.5 leading-tight">
                {phase === 'pick'       && 'Upload the client\u2019s xlsx or csv — cifra will map the columns.'}
                {phase === 'previewing' && 'Reading the file…'}
                {phase === 'review'     && preview?.source.filename}
                {phase === 'importing'  && 'Inserting invoices…'}
                {phase === 'done'       && 'Done.'}
              </p>
            </div>
          </div>
          <button onClick={handleClose} aria-label="Close"
                  className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft">
            <XIcon size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {phase === 'pick' && (
            <PickPhase onPick={handlePick} inputRef={fileRef} />
          )}
          {phase === 'previewing' && (
            <div className="py-16 text-center text-sm text-ink-muted">
              <Loader2Icon className="inline-block animate-spin mr-2" size={16} />
              Parsing the spreadsheet and asking cifra to map the columns…
            </div>
          )}
          {phase === 'review' && preview && (
            <ReviewPhase
              preview={preview}
              mapping={mapping}
              setMapping={setMapping}
              rows={remappedRows}
              validCount={validRows.length}
              skippedCount={skippedRows}
              missingRequired={missingRequired}
            />
          )}
          {phase === 'importing' && (
            <div className="py-16 text-center text-sm text-ink-muted">
              <Loader2Icon className="inline-block animate-spin mr-2" size={16} />
              Importing {validRows.length} invoice{validRows.length === 1 ? '' : 's'}…
            </div>
          )}
          {phase === 'done' && finalResult && (
            <div className="py-12 text-center">
              <div className="w-14 h-14 mx-auto rounded-full bg-emerald-50 text-emerald-600 inline-flex items-center justify-center mb-4">
                <CheckIcon size={26} />
              </div>
              <div className="text-base font-semibold text-ink">
                {finalResult.imported} invoice{finalResult.imported === 1 ? '' : 's'} imported
              </div>
              {finalResult.errors > 0 && (
                <div className="text-sm text-warning-800 mt-2">
                  {finalResult.errors} row{finalResult.errors === 1 ? '' : 's'} skipped — missing required fields.
                </div>
              )}
              <div className="text-xs text-ink-muted mt-3 max-w-md mx-auto leading-relaxed">
                They&rsquo;re now in the declaration as regular invoices. Run the classifier to apply LTVA/CJEU treatments.
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 text-sm text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
              <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        {phase === 'review' && (
          <div className="px-5 py-3 border-t border-border bg-surface-alt flex items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-ink-muted">
              {validRows.length} valid · {skippedRows > 0 ? `${skippedRows} skipped · ` : ''}
              mapping source: <span className="font-medium">{preview?.source.mapping_source === 'ai' ? 'cifra AI' : 'heuristic'}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handleClose}
                      className="h-9 px-3 rounded border border-border-strong text-sm font-medium text-ink-soft hover:bg-surface-alt">
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={validRows.length === 0 || missingRequired.length > 0}
                className="h-9 px-4 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                <CheckIcon size={13} /> Import {validRows.length} invoice{validRows.length === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        )}
        {phase === 'done' && (
          <div className="px-5 py-3 border-t border-border bg-surface-alt flex justify-end shrink-0">
            <button onClick={handleClose}
                    className="h-9 px-4 rounded bg-brand-500 text-white text-sm font-semibold hover:bg-brand-600">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ────────────────────────── phase components ──────────────────────────

function PickPhase({
  onPick, inputRef,
}: { onPick: (f: FileList | null) => void; inputRef: React.RefObject<HTMLInputElement | null> }) {
  const [drag, setDrag] = useState(false);
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files); }}
      className={[
        'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-all',
        drag ? 'border-brand-500 bg-brand-50' : 'border-border-strong hover:border-gray-400 hover:bg-surface-alt',
      ].join(' ')}
    >
      <input
        ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv" className="hidden"
        onChange={e => onPick(e.target.files)}
      />
      <div className="w-14 h-14 mx-auto rounded-full bg-brand-50 text-brand-700 inline-flex items-center justify-center mb-3">
        <UploadIcon size={22} />
      </div>
      <div className="text-base font-semibold text-ink">Drop a spreadsheet here</div>
      <div className="text-sm text-ink-muted mt-1 max-w-md mx-auto">
        Accepts <code className="text-xs bg-surface-alt px-1 rounded">.xlsx</code>, <code className="text-xs bg-surface-alt px-1 rounded">.xlsm</code>, or <code className="text-xs bg-surface-alt px-1 rounded">.csv</code>. cifra detects column headers automatically (<SparklesIcon className="inline-block -mt-0.5" size={11} /> powered by Claude) and shows a preview before importing.
      </div>
      <div className="text-xs text-ink-faint mt-3">
        Max 8 MB · max 500 rows
      </div>
    </div>
  );
}

function ReviewPhase({
  preview, mapping, setMapping, rows, validCount, skippedCount, missingRequired,
}: {
  preview: PreviewResponse;
  mapping: Mapping;
  setMapping: (m: Mapping) => void;
  rows: ParsedRow[];
  validCount: number;
  skippedCount: number;
  missingRequired: CanonicalField[];
}) {
  return (
    <div className="space-y-5">
      {/* Source banner */}
      <div className="flex items-center gap-3 text-sm text-ink-muted bg-surface-alt rounded px-3 py-2">
        <FileSpreadsheetIcon size={13} />
        <span className="font-medium text-ink">{preview.source.filename}</span>
        <span className="text-ink-faint">·</span>
        <span>Sheet &ldquo;{preview.source.sheet_name}&rdquo;</span>
        <span className="text-ink-faint">·</span>
        <span>{preview.source.rows_detected} rows</span>
        {preview.source.mapping_source === 'ai' && (
          <span className="ml-auto inline-flex items-center gap-1 text-brand-700">
            <SparklesIcon size={11} /> cifra-mapped
          </span>
        )}
      </div>

      {/* Overall warnings */}
      {preview.warnings.length > 0 && (
        <div className="space-y-1">
          {preview.warnings.map((w, i) => (
            <div key={i} className="text-xs text-warning-800 bg-warning-50 border border-warning-200 rounded px-3 py-1.5 flex items-start gap-2">
              <AlertTriangleIcon size={12} className="mt-0.5 shrink-0" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Mapping editor */}
      <div>
        <h4 className="text-sm font-semibold text-ink mb-2 uppercase tracking-wide">Column mapping</h4>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {CANONICAL_FIELDS.map(field => (
            <label key={field} className="flex items-center gap-2 text-sm">
              <span className={`w-32 shrink-0 ${REQUIRED_FIELDS.includes(field) ? 'font-semibold' : 'text-ink-soft'}`}>
                {FIELD_LABEL[field]}
                {REQUIRED_FIELDS.includes(field) && <span className="text-danger-600 ml-0.5">*</span>}
              </span>
              <select
                value={mapping[field] ?? ''}
                onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || null })}
                className={[
                  'flex-1 h-8 px-2 text-sm border rounded bg-surface',
                  !mapping[field] && REQUIRED_FIELDS.includes(field) ? 'border-danger-300' : 'border-border-strong',
                ].join(' ')}
              >
                <option value="">— not mapped —</option>
                {preview.headers.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {missingRequired.length > 0 && (
          <div className="mt-2 text-xs text-danger-700">
            Required fields not mapped: <strong>{missingRequired.map(f => FIELD_LABEL[f]).join(', ')}</strong>
          </div>
        )}
      </div>

      {/* Preview rows */}
      <div>
        <h4 className="text-sm font-semibold text-ink mb-2 uppercase tracking-wide">
          Preview ({validCount} valid{skippedCount > 0 ? `, ${skippedCount} skipped` : ''})
        </h4>
        <div className="border border-border rounded overflow-hidden">
          <div className="max-h-[280px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-alt sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left font-semibold text-ink-muted w-8">#</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-ink-muted">Provider</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-ink-muted">Date</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-ink-muted">Amount</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-ink-muted">VAT rate</th>
                  <th className="px-2 py-1.5 text-right font-semibold text-ink-muted">VAT</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-ink-muted">Country</th>
                  <th className="px-2 py-1.5 text-left font-semibold text-ink-muted">Dir.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-divider">
                {rows.slice(0, 30).map(r => {
                  const valid = !!(r.parsed.provider && r.parsed.amount_eur != null);
                  return (
                    <tr key={r.idx} className={valid ? '' : 'bg-danger-50/40'}>
                      <td className="px-2 py-1.5 text-ink-muted tabular-nums">{r.idx + 1}</td>
                      <td className="px-2 py-1.5 text-ink truncate max-w-[160px]" title={r.parsed.provider ?? ''}>
                        {r.parsed.provider || <span className="text-danger-700">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-ink-soft tabular-nums">{r.parsed.invoice_date ?? '—'}</td>
                      <td className="px-2 py-1.5 text-ink text-right tabular-nums">
                        {r.parsed.amount_eur != null
                          ? r.parsed.amount_eur.toLocaleString('en-LU', { minimumFractionDigits: 2 })
                          : <span className="text-danger-700">—</span>}
                      </td>
                      <td className="px-2 py-1.5 text-ink-soft text-right tabular-nums">
                        {r.parsed.vat_rate != null ? `${(r.parsed.vat_rate * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-ink-soft text-right tabular-nums">
                        {r.parsed.vat_applied != null
                          ? r.parsed.vat_applied.toLocaleString('en-LU', { minimumFractionDigits: 2 })
                          : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-ink-soft font-mono">{r.parsed.country ?? '—'}</td>
                      <td className="px-2 py-1.5 text-ink-soft">{r.parsed.direction ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {rows.length > 30 && (
          <div className="mt-1.5 text-2xs text-ink-muted">
            Showing first 30 of {rows.length} rows. The full set will be imported.
          </div>
        )}
      </div>
    </div>
  );
}
