'use client';

// ════════════════════════════════════════════════════════════════════════
// OutputsPanel — renders the eCDF summary, payment instructions, and
// download buttons (Excel, PDF front-page, eCDF XML, ECSL, Draft email).
//
// Extracted from page.tsx during the 2026-04-18 refactor. Verbatim move:
// no behaviour changes, no prop changes.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import type { BoxResult, OutputsResponse } from './_types';
import { fmtEUR } from './_helpers';
import { KeyBox, Spinner } from './_atoms';
import { EmailDrafterModal } from './EmailDrafterModal';

export function OutputsPanel({ declarationId }: { declarationId: string }) {
  const [data, setData] = useState<OutputsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/declarations/${declarationId}/outputs`);
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [declarationId]);

  useEffect(() => { load(); }, [load]);

  function copyReference() {
    if (!data?.payment?.reference) return;
    navigator.clipboard.writeText(data.payment.reference).then(() => {
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 1500);
    });
  }

  if (loading && !data) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4 mb-8 flex items-center gap-2 text-sm text-ink-muted">
        <Spinner small /> Computing outputs…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-red-200 rounded-lg p-4 mb-8 text-sm text-red-700">
        Error computing outputs: {error}
      </div>
    );
  }

  if (!data) return null;

  const boxesBySection: Record<string, BoxResult[]> = {};
  for (const b of data.ecdf.boxes) {
    if (!boxesBySection[b.section]) boxesBySection[b.section] = [];
    boxesBySection[b.section]!.push(b);
  }
  const sectionOrder = ['A', 'B', 'D', 'F', 'I', 'III', 'IV'];
  const sections = sectionOrder.filter(s => boxesBySection[s]);

  const download = (path: string) => () => {
    window.location.href = `/api/declarations/${declarationId}/${path}`;
  };

  return (
    <div className="bg-surface border border-border rounded-lg mb-8 overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-alt flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Outputs</h3>
          <div className="text-xs text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{data.ecdf.regime === 'simplified' ? 'Simplified return' : 'Ordinary return'}</span>
            <span className="text-ink-faint">·</span>
            <span>{data.ecdf.year} {data.ecdf.period}</span>
            <span className="text-ink-faint">·</span>
            <span>form {data.ecdf.form_version}</span>
            {data.cost && data.cost.calls > 0 && (
              <>
                <span className="text-ink-faint">·</span>
                <span
                  className="inline-flex items-center gap-1 text-2xs font-mono bg-surface-alt text-ink-soft px-1.5 py-0.5 rounded border border-border"
                  title={`${data.cost.calls} Anthropic API call${data.cost.calls === 1 ? '' : 's'} for this declaration`}
                >
                  €{data.cost.eur.toFixed(data.cost.eur < 1 ? 4 : 2)} API
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={download('excel')}
            className="h-8 px-3 rounded bg-brand-500 text-white text-xs font-semibold hover:bg-brand-600 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <DownloadIcon /> Excel
          </button>
          <button
            onClick={download('pdf')}
            className="h-8 px-3 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <DownloadIcon /> Front page PDF
          </button>
          <button
            onClick={download('xml')}
            className="h-8 px-3 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <DownloadIcon /> eCDF XML
          </button>
          <button
            onClick={download('ecsl?format=xlsx')}
            className="h-8 px-3 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
            title="EC Sales List (état récapitulatif) — only meaningful if the entity supplies B2B services to EU customers"
          >
            <DownloadIcon /> ECSL
          </button>
          <button
            onClick={() => setEmailOpen(true)}
            className="h-8 px-3 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            Draft email
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="h-8 px-3 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface-alt hover:border-gray-400 transition-all duration-150 cursor-pointer"
          >
            {expanded ? 'Hide boxes' : 'All boxes'}
          </button>
        </div>
      </div>
      {emailOpen && <EmailDrafterModal declarationId={declarationId} onClose={() => setEmailOpen(false)} />}

      {/* Stint 67.D + 67.E — eCDF XML XSD-compliance warning. The five
          flagged items are now extracted into src/config/ecdf-xsd-config.ts
          (one constant + *_VERIFIED flag per item) so an XSD-pull update
          is mechanical. See docs/ECDF_XSD_RECONCILIATION.md for the
          unblock procedure (CIGUE → AED developer space). Until all
          five flags flip, the XML produced by the "eCDF XML" download
          is FOR REVIEWER INSPECTION ONLY. */}
      <div className="px-4 py-2.5 bg-warning-50 border-b border-warning-200 flex items-start gap-2 text-xs text-warning-900">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>
          <strong>The generated eCDF XML is for reviewer inspection only.</strong>{' '}
          Five XSD-compliance items are pending verification against the
          AED&apos;s current schema (namespace, FormVersion, box element
          shape, period encoding, &lt;Agent&gt; block). Each is now a
          one-line flip in <code className="font-mono">src/config/ecdf-xsd-config.ts</code>{' '}
          once we obtain the XSD via the AED developer space —
          see <code className="font-mono">docs/ECDF_XSD_RECONCILIATION.md</code>{' '}
          for the unblock procedure. Until then, validate in MyGuichet&apos;s
          preview before any real submission.
        </span>
      </div>

      <div className="p-4">
        {/* Totals row */}
        <div className="grid grid-cols-3 gap-4 mb-4 pb-4 border-b border-border">
          <KeyBox
            label={`VAT due (box ${data.ecdf.regime === 'simplified' ? '076' : '097'})`}
            value={fmtEUR(data.ecdf.totals.vat_due)}
            bold
          />
          <KeyBox
            label="Payable to AED"
            value={`€${fmtEUR(data.ecdf.totals.payable)}`}
            color={data.ecdf.totals.payable > 0 ? 'text-ink' : 'text-ink-faint'}
          />
          <KeyBox
            label="Credit"
            value={`€${fmtEUR(data.ecdf.totals.credit)}`}
            color={data.ecdf.totals.credit > 0 ? 'text-green-600' : 'text-ink-faint'}
          />
        </div>

        {/* Payment instructions */}
        {data.payment ? (
          <div className="mb-4">
            <h4 className="text-xs uppercase tracking-wide font-semibold text-ink-muted mb-2">Payment instructions</h4>
            <div className="bg-surface-alt border border-border rounded-md p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="font-mono text-sm font-semibold text-ink tracking-tight break-all">
                  {data.payment.reference}
                </div>
                <button
                  onClick={copyReference}
                  className="shrink-0 h-7 px-2.5 rounded border border-border-strong text-xs font-medium text-ink-soft hover:bg-surface hover:border-gray-400 transition-all duration-150 cursor-pointer flex items-center gap-1"
                >
                  {copiedRef ? '✓ Copied' : 'Copy reference'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-ink-muted uppercase tracking-wide text-2xs font-semibold">Beneficiary</div>
                  <div className="text-ink font-medium mt-0.5">{data.payment.beneficiary}</div>
                </div>
                <div>
                  <div className="text-ink-muted uppercase tracking-wide text-2xs font-semibold">IBAN</div>
                  <div className="text-ink font-mono mt-0.5">{data.payment.iban}</div>
                </div>
                <div>
                  <div className="text-ink-muted uppercase tracking-wide text-2xs font-semibold">BIC</div>
                  <div className="text-ink font-mono mt-0.5">{data.payment.bic}</div>
                </div>
              </div>
            </div>
          </div>
        ) : data.payment_error ? (
          <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Payment reference unavailable — {data.payment_error}. Add the matricule on the Entity page.
          </div>
        ) : null}

        {/* Warnings */}
        {data.ecdf.warnings.length > 0 && (
          <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
            {data.ecdf.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
          </div>
        )}
        {data.ecdf.manual_boxes_pending.length > 0 && (
          <div className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Manual input required for box{data.ecdf.manual_boxes_pending.length === 1 ? '' : 'es'}{' '}
            {data.ecdf.manual_boxes_pending.join(', ')} (ordinary-regime pro-rata).
          </div>
        )}

        {/* Box list */}
        {expanded && (
          <div className="space-y-4 mt-4">
            {sections.map(section => (
              <div key={section}>
                <h4 className="text-xs uppercase tracking-wide font-semibold text-ink-muted mb-1.5">Section {section}</h4>
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      {boxesBySection[section]!.map((b, i) => (
                        <tr key={b.box} className={`border-b border-divider last:border-0 ${i % 2 === 1 ? 'bg-surface-alt/60' : ''}`}>
                          <td className="px-3 py-1.5 font-mono text-ink-muted w-14">{b.box}</td>
                          <td className="px-3 py-1.5 text-ink-soft">
                            {b.label}
                            {b.manual && <span className="ml-2 text-2xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 uppercase tracking-wide font-semibold">manual</span>}
                            {b.formula && <span className="ml-2 text-2xs text-ink-faint font-mono">= {b.formula}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-ink w-32">
                            {fmtEUR(b.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Shared inline icon. Keeps Lucide out of OutputsPanel for payload size.
function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>
  );
}
