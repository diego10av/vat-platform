'use client';

// ════════════════════════════════════════════════════════════════════════
// TaxProvisionInlineCell — stint 64.J + 64.L
//
// Generic tax-provision cell. Used twice on /tax-ops/cit:
//   • "CIT Provision {year}" → tax_type='cit_annual', service_kind='provision'
//   • "NWT Provision {year}" → tax_type='nwt_annual', service_kind='provision'
//
// Tracks the interim provision calculation that some clients (~20 of
// 160 entities at writing) ask for before their year-end financial
// statements close. Same workflow for both taxes — Diego confirmed
// 2026-04-28. Diego's words:
//
//   "Hay a veces que algunos clientes nos mandan un borrador de los
//   estados financieros para que calculemos las tax provisions. El
//   cliente me mandó los estados financieros, yo los he trabajado, lo
//   he preparado y hoy lo he enviado. Y normalmente ya no pasa nada
//   más, ya lo siguiente es que nos suele mandar los estados
//   financieros finales y hacemos la declaración del impuesto a
//   sociedades final. Aunque hay alguna vez que sí que pueden tener
//   algún comentario."
//
// Same shape + UX as NwtReviewInlineCell (stint 37.D), with a
// provision-specific 6-state workflow that captures the client's
// possible round-trip of comments before finalisation.
//
//   awaiting_fs       Client hasn't sent the draft FS yet.
//   fs_received       Draft FS in our hands; not started yet.
//   working           Calculating the provision.
//   sent              Provision delivered to the client; awaiting feedback.
//   comments_received Client returned with comments — Diego's queue (revise + resend).
//   finalized         Done. Next step is the final CIT return when final FS arrive.
//
// Diego can flow forwards or backwards through these (e.g. sent → comments_received →
// working → sent → finalized). No deadline tracking on this cell — Diego confirmed
// 2026-04-28 that provisions don't have a regulatory date, just client-driven timing.
//
// Re-uses the existing tax_obligations + tax_filings tables with
// service_kind='provision'. The matrix API is parametric and accepts
// the new kind without code changes.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import Link from 'next/link';
import { followUpSignal, PROVISION_WAITING_STATES } from './follow-up';
import { FollowUpChip } from './FollowUpChip';
// Stint 64.X.2.b — shared source of truth so the matrix cell + the
// cross-cutting Filings list / detail / EntityFilingsMatrix all use
// identical labels + tones. Local PROVISION_STATUS_META removed.
import { PROVISION_STATUS_META, provisionStatusLabel } from './FilingStatusBadge';

interface ProvisionCellData {
  obligation_id: string | null;
  filing_id: string | null;
  status: string | null;
  comments: string | null;
  last_action_at?: string | null;
}

interface Props {
  entityId: string;
  year: number;
  cell: ProvisionCellData;
  onOptIn: () => Promise<void>;
  onCreateFiling: (nextStatus: string) => Promise<void>;
  onUpdateStatus: (nextStatus: string) => Promise<void>;
  onOptOut?: () => Promise<void>;
}

// ─────────────────────────── Status enum ──────────────────────────────
//
// Stint 64.X.2.b — PROVISION_STATUS_META and provisionStatusLabel
// moved to FilingStatusBadge.tsx so cross-cutting screens (Filings
// list, Filing detail, EntityFilingsMatrix) render the same labels.
// Imported at the top of this file. Local copies removed.

const PROVISION_STATUSES = [
  'awaiting_fs',
  'fs_received',
  'working',
  'sent',
  'comments_received',
  'finalized',
];

// Stint 64.K — states where we're waiting on the client (not on
// Diego) live in `follow-up.ts` (PROVISION_WAITING_STATES). The
// follow-up chip turns amber/red after these sit too long without
// a status change. Imported above; redeclared here only as a
// reminder of which states they are:
//   awaiting_fs       — client owes us the draft FS
//   sent              — we delivered the provision, client owes
//                       confirmation or comments
// NOT counted: fs_received (Diego's queue), working (Diego's queue),
//   comments_received (Diego's queue), finalized (terminal).

// ─────────────────────────── Component ────────────────────────────────

export function TaxProvisionInlineCell({
  year, cell, onOptIn, onCreateFiling, onUpdateStatus, onOptOut,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOptIn() {
    setBusy(true); setError(null);
    try { await onOptIn(); }
    catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(false); }
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
  // Stint 64.M — Diego: "cuanto más minimalista mejor". Most rows
  // aren't opted in to provision tracking; this cell renders as a
  // subtle em-dash by default and only reveals "+ Opt in" on hover.
  // Removes the bulk of the visual noise across the matrix.
  if (!cell.obligation_id) {
    return (
      <button
        type="button"
        onClick={handleOptIn}
        disabled={busy}
        className="group inline-flex items-center justify-center min-w-[44px] h-5 px-1.5 rounded-full text-2xs text-ink-faint hover:text-ink hover:bg-surface-alt transition-colors disabled:opacity-50"
        title="Click to track a tax-provision calc for this entity. Use when a client sends a draft FS and asks us to compute the provision."
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

  // State B / C: has obligation, with or without filing.
  const statusValue = cell.status ?? 'awaiting_fs';
  const meta = PROVISION_STATUS_META[statusValue];
  const signal = followUpSignal(
    PROVISION_WAITING_STATES.has(statusValue),
    cell.last_action_at,
  );
  const tooltip = [
    provisionStatusLabel(statusValue),
    meta?.description,
    cell.comments ? `Comments: ${cell.comments.slice(0, 120)}${cell.comments.length > 120 ? '…' : ''}` : null,
  ].filter(Boolean).join('\n\n');

  return (
    <div className="inline-flex flex-wrap items-center gap-1">
      <select
        value={statusValue}
        onChange={(e) => void handleStatusPick(e.target.value)}
        disabled={busy}
        title={tooltip}
        className={`px-1 py-0 text-2xs border border-border rounded disabled:opacity-50 ${meta?.tone ?? 'bg-surface'}`}
      >
        {PROVISION_STATUSES.map(s => (
          <option key={s} value={s}>{provisionStatusLabel(s)}</option>
        ))}
      </select>
      <FollowUpChip signal={signal} />
      {cell.last_action_at && (
        <span
          className="inline-flex items-center text-2xs text-ink-faint"
          title={`Last provision action: ${cell.last_action_at}`}
        >
          · {cell.last_action_at.slice(5)}
        </span>
      )}
      {cell.filing_id && (
        <Link
          href={`/tax-ops/filings/${cell.filing_id}`}
          className="text-2xs text-ink-muted hover:text-ink underline"
          title={`Open Tax Provision ${year} filing for full edit (comments, dates, etc.)`}
        >
          edit
        </Link>
      )}
      {onOptOut && (
        <button
          type="button"
          onClick={async () => {
            if (!window.confirm('Opt this entity out of tax-provision tracking? The obligation will be archived (filings kept in the audit log).')) return;
            setBusy(true); setError(null);
            try { await onOptOut(); }
            catch (e) { setError(String(e instanceof Error ? e.message : e)); }
            finally { setBusy(false); }
          }}
          disabled={busy}
          className="text-2xs text-ink-muted hover:text-danger-600 underline disabled:opacity-50"
          title="Archive the tax-provision obligation"
        >
          opt out
        </button>
      )}
      {error && <span className="text-2xs text-danger-700" title={error}>⚠</span>}
    </div>
  );
}
