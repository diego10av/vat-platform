'use client';

// ════════════════════════════════════════════════════════════════════════
// AssessmentInlineEditor — stint 37.D
//
// Dedicated inline cell for "Assessment {year-1}" on the CIT page.
// The cell maps to the PRIOR-year filing row — when Diego changes it,
// we PATCH the year-1 filing with:
//   - tax_assessment_received_at = picked date (or null)
//   - status = 'assessment_received' (when a date is present)
//
// Display collapses to:
//   - "Received DD Mmm" green chip (when tax_assessment_received_at set)
//   - status badge + dropdown (when still awaiting)
//   - "—" when no prior-year filing exists
//
// On click → popover with status dropdown + date picker + Save/Cancel.
// ════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react';
import { filingStatusLabel, FILING_STATUSES } from './FilingStatusBadge';

interface Props {
  filingId: string | null;
  currentStatus: string | null;
  assessmentDate: string | null;
  onSave: (args: { status: string; assessmentDate: string | null }) => Promise<void>;
}

export function AssessmentInlineEditor({
  filingId, currentStatus, assessmentDate, onSave,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState(currentStatus ?? 'info_to_request');
  const [draftDate, setDraftDate] = useState(assessmentDate ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraftStatus(currentStatus ?? 'info_to_request');
      setDraftDate(assessmentDate ?? '');
      setError(null);
    }
  }, [open, currentStatus, assessmentDate]);

  // Click-outside = save + close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!popRef.current) return;
      if (popRef.current.contains(e.target as Node)) return;
      void commit();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draftStatus, draftDate]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  async function commit() {
    if (busy) return;
    // No-op if nothing changed
    if (draftStatus === (currentStatus ?? '') && draftDate === (assessmentDate ?? '')) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        status: draftStatus,
        assessmentDate: draftDate === '' ? null : draftDate,
      });
      setOpen(false);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  // Display node
  if (!filingId) {
    return <span className="text-ink-faint italic text-[11px]">No prior filing</span>;
  }

  // Stint 40.F — Diego wanted a pragmatic tri-state: "Not yet / Yes /
  // Stint 43 — simplified to a 2-state chip after the status rework:
  // assessment_received and waived are no longer valid statuses.
  // The signal is the date itself in tax_assessment_received_at.
  //   - assessmentDate set → "✓ Received {date}" green chip
  //   - assessmentDate null → "Not yet" amber chip
  // The popover dropdown still exposes the full FILING_STATUSES so
  // Diego can flip the prior-year filing status if needed.
  const triStateChip = assessmentDate ? (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">
      ✓ Received {assessmentDate}
    </span>
  ) : (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-amber-100 text-amber-800">
      Not yet
    </span>
  );

  const displayNode = triStateChip;

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="inline-block text-left hover:bg-brand-50/50 rounded px-0.5 cursor-text"
        title="Click to edit assessment status + date"
      >
        {displayNode}
      </button>
    );
  }

  return (
    <div
      ref={popRef}
      className="inline-block relative"
      style={{ zIndex: 20 }}
    >
      <div className="absolute top-0 left-0 mt-0 bg-surface border border-border rounded-md shadow-lg p-2 space-y-1.5 min-w-[220px]">
        <label className="block text-[10.5px] text-ink-muted">Status</label>
        <select
          autoFocus
          value={draftStatus}
          onChange={(e) => setDraftStatus(e.target.value)}
          className="w-full px-1.5 py-0.5 text-[11.5px] border border-border rounded bg-surface"
        >
          {FILING_STATUSES.map(s => (
            <option key={s} value={s}>{filingStatusLabel(s)}</option>
          ))}
        </select>
        <label className="block text-[10.5px] text-ink-muted mt-1">Assessment date</label>
        <input
          type="date"
          value={draftDate}
          onChange={(e) => setDraftDate(e.target.value)}
          className="w-full px-1.5 py-0.5 text-[11.5px] border border-border rounded bg-surface tabular-nums"
        />
        <div className="flex gap-1 pt-1">
          <button
            type="button"
            onClick={commit}
            disabled={busy}
            className="flex-1 px-2 py-0.5 text-[11px] rounded bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={busy}
            className="px-2 py-0.5 text-[11px] rounded border border-border hover:bg-surface-alt"
          >
            Cancel
          </button>
        </div>
        {error && <div className="text-[10px] text-danger-700">{error}</div>}
      </div>
      {/* Display stays visible under the popover */}
      {displayNode}
    </div>
  );
}
