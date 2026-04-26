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

/** Stint 44.F3 — three explicit outcome categories. */
export type AssessmentOutcome = 'aligned' | 'under_audit' | null;

interface Props {
  filingId: string | null;
  currentStatus: string | null;
  assessmentDate: string | null;
  /** Stint 44.F3 — outcome category once received. NULL = not yet
   *  categorised (legacy rows). */
  assessmentOutcome?: AssessmentOutcome;
  onSave: (args: {
    status: string;
    assessmentDate: string | null;
    assessmentOutcome: AssessmentOutcome;
  }) => Promise<void>;
}

export function AssessmentInlineEditor({
  filingId, currentStatus, assessmentDate, assessmentOutcome, onSave,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState(currentStatus ?? 'info_to_request');
  const [draftDate, setDraftDate] = useState(assessmentDate ?? '');
  const [draftOutcome, setDraftOutcome] = useState<AssessmentOutcome>(assessmentOutcome ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setDraftStatus(currentStatus ?? 'info_to_request');
      setDraftDate(assessmentDate ?? '');
      setDraftOutcome(assessmentOutcome ?? null);
      setError(null);
    }
  }, [open, currentStatus, assessmentDate, assessmentOutcome]);

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
    // Auto-clear outcome if the date is being cleared (outcome only
    // makes sense when there's a received date).
    const effectiveOutcome: AssessmentOutcome = draftDate === '' ? null : draftOutcome;
    // No-op if nothing changed
    if (
      draftStatus === (currentStatus ?? '')
      && draftDate === (assessmentDate ?? '')
      && effectiveOutcome === (assessmentOutcome ?? null)
    ) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave({
        status: draftStatus,
        assessmentDate: draftDate === '' ? null : draftDate,
        assessmentOutcome: effectiveOutcome,
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

  // Stint 44.F3 — pragmatic tri-state restored, this time with a real
  // outcome category instead of overloading the status enum. Three chips:
  //   - no date              → "Not yet" amber
  //   - date + aligned       → "✓ Aligned · DATE" green
  //   - date + under_audit   → "⚠ Under audit · DATE" orange
  //   - date + null outcome  → legacy "✓ Received · DATE" gray-green
  //                            (entries created before mig 062 don't have
  //                            an outcome; preserved verbatim)
  let triStateChip: React.ReactNode;
  if (!assessmentDate) {
    triStateChip = (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-amber-100 text-amber-800">
        Not yet
      </span>
    );
  } else if (assessmentOutcome === 'aligned') {
    triStateChip = (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-green-100 text-green-800">
        ✓ Aligned · {assessmentDate}
      </span>
    );
  } else if (assessmentOutcome === 'under_audit') {
    triStateChip = (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-orange-100 text-orange-800">
        ⚠ Under audit · {assessmentDate}
      </span>
    );
  } else {
    // Legacy row: date set, outcome NULL. Soft "received" chip nudges
    // Diego to categorise on next click without screaming.
    triStateChip = (
      <span
        className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10.5px] bg-emerald-50 text-emerald-700 border border-emerald-200"
        title="Received but outcome not categorised — click to mark Aligned or Under audit"
      >
        ✓ Received · {assessmentDate}
      </span>
    );
  }

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
        {draftDate && (
          <>
            <label className="block text-[10.5px] text-ink-muted mt-1">Outcome</label>
            <div className="flex flex-col gap-0.5">
              <label className="inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer">
                <input
                  type="radio"
                  name="assessment-outcome"
                  checked={draftOutcome === 'aligned'}
                  onChange={() => setDraftOutcome('aligned')}
                />
                <span>✓ Aligned (matches our return)</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11.5px] cursor-pointer">
                <input
                  type="radio"
                  name="assessment-outcome"
                  checked={draftOutcome === 'under_audit'}
                  onChange={() => setDraftOutcome('under_audit')}
                />
                <span>⚠ Under audit / clarifications</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-[11px] cursor-pointer text-ink-muted">
                <input
                  type="radio"
                  name="assessment-outcome"
                  checked={draftOutcome === null}
                  onChange={() => setDraftOutcome(null)}
                />
                <span>Not categorised yet</span>
              </label>
            </div>
          </>
        )}
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
