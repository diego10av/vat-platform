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
//       recommendation_sent dates. Click → /tax-ops/nwt for full row edit.
//
// Opt-in flow is simplified: we POST a new obligation with
// service_kind='review' for this entity. The matrix page refetches.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import {
  FilingStatusBadge, filingStatusLabel, FILING_STATUSES,
} from './FilingStatusBadge';

interface NwtCellData {
  obligation_id: string | null;
  filing_id: string | null;
  status: string | null;
  draft_sent_at: string | null;   // interim financials received
  filed_at: string | null;        // recommendation sent
  comments: string | null;
}

interface Props {
  entityId: string;
  year: number;
  cell: NwtCellData;
  onOptIn: () => Promise<void>;      // POST new obligation
  onCreateFiling: (nextStatus: string) => Promise<void>;
  onUpdateStatus: (nextStatus: string) => Promise<void>;
}

export function NwtReviewInlineCell({
  year, cell, onOptIn, onCreateFiling, onUpdateStatus,
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

  // State A: not opted in
  if (!cell.obligation_id) {
    return (
      <button
        type="button"
        onClick={handleOptIn}
        disabled={busy}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] bg-surface-alt text-ink-muted hover:bg-surface-alt/80 hover:text-ink transition-colors"
        title="Click to opt this entity into year-end NWT review"
      >
        {busy ? 'Adding…' : '+ Opt in'}
      </button>
    );
  }

  // State B or C: has obligation, with or without filing
  const statusValue = cell.status ?? 'info_to_request';
  const tooltip = [
    filingStatusLabel(statusValue),
    cell.draft_sent_at ? `Interim received: ${cell.draft_sent_at}` : null,
    cell.filed_at ? `Recommendation sent: ${cell.filed_at}` : null,
    cell.comments ? `Comments: ${cell.comments.slice(0, 120)}${cell.comments.length > 120 ? '…' : ''}` : null,
  ].filter(Boolean).join('\n');

  return (
    <div className="inline-flex items-center gap-1">
      <select
        value={statusValue}
        onChange={(e) => void handleStatusPick(e.target.value)}
        disabled={busy}
        title={tooltip}
        className="px-1 py-0 text-[10.5px] border border-border rounded bg-surface disabled:opacity-50"
      >
        {FILING_STATUSES.map(s => (
          <option key={s} value={s}>{filingStatusLabel(s)}</option>
        ))}
      </select>
      {cell.draft_sent_at && (
        <span className="inline-flex items-center px-1 py-0 rounded bg-blue-50 text-blue-700 text-[9px]" title={`Interim financials received ${cell.draft_sent_at}`}>
          IF ✓
        </span>
      )}
      {cell.filed_at && (
        <span className="inline-flex items-center px-1 py-0 rounded bg-green-100 text-green-800 text-[9px]" title={`Recommendation sent ${cell.filed_at}`}>
          RS ✓
        </span>
      )}
      {cell.filing_id && (
        <Link
          href={`/tax-ops/filings/${cell.filing_id}`}
          className="text-[9px] text-ink-muted hover:text-ink underline"
          title={`Open NWT Review ${year} filing`}
        >
          edit
        </Link>
      )}
      {error && <span className="text-[10px] text-danger-700" title={error}>⚠</span>}
    </div>
  );
}

// Suppress unused var warning — displayed via title
void FilingStatusBadge;
