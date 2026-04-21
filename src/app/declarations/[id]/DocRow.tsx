'use client';

// ════════════════════════════════════════════════════════════════════════
// DocRow + its supporting pills (StatusBadge, DocStatusTag, TriageTag,
// FileIcon).
//
// These are dumb presentational components — they take a DocumentRec
// and render a single row. No state, no side effects. Extracted from
// page.tsx to shrink the orchestrator and make it easier to test /
// restyle independently.
// ════════════════════════════════════════════════════════════════════════

import type { DocumentRec } from './_types';
import { Spinner } from './_atoms';

export function DocRow({
  doc, selected, loading, onSelect, onRetry,
}: {
  doc: DocumentRec;
  selected: boolean;
  loading: boolean;
  onSelect: () => void;
  onRetry: () => void;
}) {
  // We use a div + role="button" + keydown handler because the row
  // visually contains an interior button (Retry) — nesting a real
  // <button> inside another <button> would be invalid HTML. The
  // role+tabIndex+keydown combo gives us the same a11y surface.
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect();
    }
  }
  return (
    <div
      id={`row-doc-${doc.id}`}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Document ${doc.filename}, status ${doc.status}${doc.triage_result ? `, triage ${doc.triage_result}` : ''}`}
      className={`px-4 py-2 border-b border-divider last:border-0 text-[12px] cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-inset ${selected ? 'bg-blue-50' : 'hover:bg-surface-alt'}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileIcon type={doc.file_type} />
          <span className="truncate">{doc.filename}</span>
          <span className="text-[10px] text-ink-faint shrink-0">{(doc.file_size / 1024).toFixed(0)} KB</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <TriageTag triage={doc.triage_result} />
          <DocStatusTag status={doc.status} />
        </div>
      </div>
      {doc.status === 'error' && doc.error_message && (
        <div
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          className="mt-1 ml-6 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 break-words flex items-start justify-between gap-2"
        >
          <div className="flex-1"><span className="font-semibold">Error:</span> {doc.error_message}</div>
          <button
            disabled={loading}
            onClick={onRetry}
            aria-label={`Retry extraction for ${doc.filename}`}
            className="text-blue-600 hover:underline shrink-0 font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
          >
            {loading && <Spinner small />}Retry
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────── pills ──────────────────────────

export function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    created: 'bg-surface-alt text-ink-soft',
    uploading: 'bg-blue-100 text-blue-700',
    extracting: 'bg-purple-100 text-purple-700',
    classifying: 'bg-yellow-100 text-yellow-700',
    review: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    filed: 'bg-emerald-100 text-emerald-800',
    paid: 'bg-teal-100 text-teal-800',
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${colors[status] || 'bg-surface-alt'}`}>
      {status}
    </span>
  );
}

export function DocStatusTag({ status }: { status: string }) {
  const colors: Record<string, string> = {
    uploaded: 'bg-surface-alt text-ink-soft',
    triaging: 'bg-purple-100 text-purple-600',
    triaged: 'bg-blue-100 text-blue-600',
    extracting: 'bg-yellow-100 text-yellow-600',
    extracted: 'bg-green-100 text-green-600',
    rejected: 'bg-orange-100 text-orange-600',
    error: 'bg-red-100 text-red-600',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[status] || 'bg-surface-alt'}`}>
      {status}
    </span>
  );
}

// Human labels for the triage classifier output. The raw snake_case
// codes ('wrong_entity', 'credit_note', …) were leaking into the
// reviewer UI — Diego flagged this on 2026-04-21 as "copy that would
// embarrass us in a demo". Mapping table keeps the codes stable on the
// backend while the reviewer sees sentence-case labels.
const TRIAGE_LABEL: Record<string, string> = {
  invoice: 'Invoice',
  credit_note: 'Credit note',
  wrong_entity: 'Wrong entity',
  receipt: 'Receipt',
  aed_letter: 'AED letter',
  expense_claim: 'Expense claim',
  duplicate: 'Duplicate',
  proforma_invoice: 'Pro-forma invoice',
  purchase_order: 'Purchase order',
  aed_attestation: 'AED attestation',
  power_of_attorney: 'Power of attorney',
  kyc_document: 'KYC document',
  other: 'Other',
};

export function TriageTag({ triage }: { triage: string | null }) {
  if (!triage) return <span className="text-[10px] text-ink-faint">—</span>;
  const colors: Record<string, string> = {
    invoice: 'bg-blue-100 text-blue-700',
    credit_note: 'bg-purple-100 text-purple-700',
    wrong_entity: 'bg-orange-100 text-orange-700',
    receipt: 'bg-yellow-100 text-yellow-700',
    aed_letter: 'bg-red-100 text-red-700',
    expense_claim: 'bg-pink-100 text-pink-700',
    duplicate: 'bg-surface-alt text-ink-soft',
    proforma_invoice: 'bg-amber-100 text-amber-700',
    purchase_order: 'bg-amber-100 text-amber-700',
    aed_attestation: 'bg-red-100 text-red-700',
    power_of_attorney: 'bg-surface-alt text-ink-soft',
    kyc_document: 'bg-surface-alt text-ink-soft',
    other: 'bg-surface-alt text-ink-soft',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[triage] || 'bg-surface-alt'}`}>
      {TRIAGE_LABEL[triage] ?? triage}
    </span>
  );
}

export function FileIcon({ type }: { type: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint shrink-0">
      {type === 'image' ? (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </>
      ) : (
        <>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
        </>
      )}
    </svg>
  );
}
