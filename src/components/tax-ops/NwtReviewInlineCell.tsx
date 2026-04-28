'use client';

// ════════════════════════════════════════════════════════════════════════
// NwtReviewInlineCell — stint 37.D
//
// Cell shown on /tax-ops/cit for the "NWT Review {year}" column.
//
// Three states:
//   - No nwt_annual obligation (service_kind='review') for this entity
//     → "Not opted in" muted chip + click to opt-in
//   - Obligation exists but no filing yet for this year
//     → status dropdown defaulting to info_to_request, creates the
//       filing on first status change
//   - Filing exists
//     → status badge + hover tooltip showing interim_received +
//       recommendation_sent dates. Click → filing detail for full edit.
//
// Opt-in flow is simplified: we POST a new obligation with
// service_kind='review' for this entity. The matrix page refetches.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import {
  FilingStatusBadge, filingStatusLabel, FILING_STATUSES,
} from './FilingStatusBadge';
import { followUpSignal, FILING_WAITING_STATES } from './follow-up';
import { FollowUpChip } from './FollowUpChip';

// Stint 64.K + 64.L — the "waiting on client" state set lives in
// `follow-up.ts` so the toolbar's "Needs follow-up" toggle uses
// exactly the same semantics as the chip. NWT Review uses the
// generic filing_status enum, so it imports FILING_WAITING_STATES.

interface NwtCellData {
  obligation_id: string | null;
  filing_id: string | null;
  status: string | null;
  draft_sent_at: string | null;   // interim financials received
  filed_at: string | null;        // recommendation sent
  comments: string | null;
  /** Stint 43.D10 — surfaced for the "Last NWT action" chip; auto-stamped
   *  by the filings PATCH endpoint on every meaningful change. */
  last_action_at?: string | null;
}

interface Props {
  entityId: string;
  year: number;
  cell: NwtCellData;
  onOptIn: () => Promise<void>;      // POST new obligation
  onCreateFiling: (nextStatus: string) => Promise<void>;
  onUpdateStatus: (nextStatus: string) => Promise<void>;
  /** Stint 40.F — "Opt out" archives the nwt_annual obligation
   *  (is_active=false). Diego mis-clicked Opt-in and had no way to
   *  undo. Passes the obligation_id when available; no-op otherwise. */
  onOptOut?: () => Promise<void>;
  /** Stint 43.D10 — quick-action: PATCH the filing with the supplied
   *  date fields. Used by the "Mark interim today" + "Mark reco today"
   *  buttons so Diego doesn't have to open the drawer for a 1-click
   *  date update. No-op when the cell has no filing yet. */
  onPatchDates?: (patch: { draft_sent_at?: string | null; filed_at?: string | null }) => Promise<void>;
}

export function NwtReviewInlineCell({
  year, cell, onOptIn, onCreateFiling, onUpdateStatus, onOptOut, onPatchDates,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOptIn() {
    setBusy(true); setError(null);
    try {
      await onOptIn();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  async function handleStatusPick(next: string) {
    setBusy(true); setError(null);
    try {
      if (cell.filing_id) {
        await onUpdateStatus(next);
      } else {
        await onCreateFiling(next);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  // State A: not opted in.
  // Stint 64.M — Diego: "cuanto más minimalista mejor". 140 of 160
  // entities aren't opted in to NWT review, so this cell renders 140
  // times as a subtle em-dash by default and only reveals "+ Opt in"
  // on hover. Removes most of the visual noise from the matrix.
  if (!cell.obligation_id) {
    return (
      <button
        type="button"
        onClick={handleOptIn}
        disabled={busy}
        className="group inline-flex items-center justify-center min-w-[44px] h-5 px-1.5 rounded-full text-2xs text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-50"
        title="Click to opt this entity into year-end NWT review"
      >
        {busy ? (
          'Adding…'
        ) : (
          <>
            <span className="group-hover:hidden">—</span>
            <span className="hidden group-hover:inline">+ Opt in</span>
          </>
        )}
      </button>
    );
  }

  // State B or C: has obligation, with or without filing
  const statusValue = cell.status ?? 'info_to_request';
  const signal = followUpSignal(
    FILING_WAITING_STATES.has(statusValue),
    cell.last_action_at,
  );
  const tooltip = [
    filingStatusLabel(statusValue),
    cell.draft_sent_at ? `Interim received: ${cell.draft_sent_at}` : null,
    cell.filed_at ? `Recommendation sent: ${cell.filed_at}` : null,
    cell.comments ? `Comments: ${cell.comments.slice(0, 120)}${cell.comments.length > 120 ? '…' : ''}` : null,
  ].filter(Boolean).join('\n');

  // Stint 43.D10 — quick-action handler: PATCH a date field to today.
  // Wraps the parent-supplied onPatchDates with the same busy/error
  // plumbing as the status handler so the UI stays consistent.
  async function markDateToday(field: 'draft_sent_at' | 'filed_at') {
    if (!onPatchDates || !cell.filing_id) return;
    setBusy(true); setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await onPatchDates({ [field]: today });
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      <select
        value={statusValue}
        onChange={(e) => void handleStatusPick(e.target.value)}
        disabled={busy}
        title={tooltip}
        className="px-1 py-0 text-2xs border border-border rounded bg-surface disabled:opacity-50"
      >
        {FILING_STATUSES.map(s => (
          <option key={s} value={s}>{filingStatusLabel(s)}</option>
        ))}
      </select>
      <FollowUpChip signal={signal} />
      {/* Stint 43.D10 — IF / RS chips bumped to 10px + show date inline so
          Diego doesn't need to hover. Quick "+ today" buttons appear when
          the field is unset and onPatchDates is wired. */}
      {cell.draft_sent_at ? (
        <span
          className="inline-flex items-center px-1 py-0 rounded bg-blue-50 text-blue-700 text-2xs"
          title={`Interim financials received ${cell.draft_sent_at}`}
        >
          IF · {cell.draft_sent_at.slice(5)}
        </span>
      ) : onPatchDates && cell.filing_id ? (
        <button
          type="button"
          onClick={() => void markDateToday('draft_sent_at')}
          disabled={busy}
          className="inline-flex items-center px-1 py-0 rounded border border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 text-2xs disabled:opacity-50"
          title="Mark interim financials received today"
        >
          + IF
        </button>
      ) : null}
      {cell.filed_at ? (
        <span
          className="inline-flex items-center px-1 py-0 rounded bg-green-100 text-green-800 text-2xs"
          title={`Recommendation sent ${cell.filed_at}`}
        >
          RS · {cell.filed_at.slice(5)}
        </span>
      ) : onPatchDates && cell.filing_id ? (
        <button
          type="button"
          onClick={() => void markDateToday('filed_at')}
          disabled={busy}
          className="inline-flex items-center px-1 py-0 rounded border border-dashed border-green-300 text-green-700 hover:bg-green-50 text-2xs disabled:opacity-50"
          title="Mark recommendation sent today"
        >
          + RS
        </button>
      ) : null}
      {cell.last_action_at && (
        <span
          className="inline-flex items-center text-2xs text-ink-faint"
          title={`Last NWT action: ${cell.last_action_at}`}
        >
          · {cell.last_action_at.slice(5)}
        </span>
      )}
      {cell.filing_id && (
        <Link
          href={`/tax-ops/filings/${cell.filing_id}`}
          className="text-2xs text-ink-muted hover:text-ink underline"
          title={`Open NWT Review ${year} filing`}
        >
          edit
        </Link>
      )}
      {/* Stint 40.F — Opt-out button for when Diego mis-clicked opt-in
          or the client no longer wants the NWT review service. */}
      {onOptOut && (
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm('Opt this entity out of NWT reviews? The obligation will be archived (filings kept in the audit log).')) return;
            setBusy(true); setError(null);
            try { await onOptOut(); }
            catch (e) { setError(String(e instanceof Error ? e.message : e)); }
            finally { setBusy(false); }
          }}
          disabled={busy}
          className="text-2xs text-ink-muted hover:text-danger-600 underline disabled:opacity-50"
          title="Archive the NWT review obligation"
        >
          opt out
        </button>
      )}
      {error && <span className="text-2xs text-danger-700" title={error}>⚠</span>}
    </div>
  );
}

// Suppress unused var warning — displayed via title
void FilingStatusBadge;
