'use client';

// ════════════════════════════════════════════════════════════════════════
// EntityActionsMenu — stint 44.F4
//
// Tiny kebab `⋯` button rendered next to the entity name in the matrix's
// sticky entity column. Click → dropdown with low-frequency-but-important
// per-entity actions. Currently:
//
//   • Entity status: Active / Liquidating / Liquidated (+ date picker
//     when Liquidating or Liquidated). PATCHes liquidation_date on
//     /api/tax-ops/entities/[id].
//
// Diego: "una pestañita pequeña al lado del nombre y al click una de
// las opciones que te pusiese 'Liquidada' / 'No liquidada'… y luego
// más cosas que se nos vayan ocurriendo, las podemos meter ahí."
//
// The kebab is intentionally discreet (text-ink-faint, opacity-60,
// hover:opacity-100) so it doesn't compete with the entity name. The
// LiquidationChip renders independently when a date is actually set —
// this menu is the SETTING surface, the chip is the SIGNAL.
//
// Future hooks: notes, archive, mark inactive, merge, etc.
// ════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MoreVerticalIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

interface Props {
  entityId: string;
  entityName: string;
  liquidationDate: string | null;
  /** Called after a successful PATCH so the matrix refetches. */
  onChanged: () => void;
}

type EntityStatus = 'active' | 'liquidating' | 'liquidated';

function deriveStatus(liquidationDate: string | null): EntityStatus {
  if (!liquidationDate) return 'active';
  const today = new Date().toISOString().slice(0, 10);
  return liquidationDate < today ? 'liquidated' : 'liquidating';
}

export function EntityActionsMenu({
  entityId, entityName, liquidationDate, onChanged,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStatus, setDraftStatus] = useState<EntityStatus>(deriveStatus(liquidationDate));
  const [draftDate, setDraftDate] = useState<string>(liquidationDate ?? '');
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const toast = useToast();

  // Stint 64.V.5 — popover is portaled to <body> instead of being
  // rendered inside the table flow. The previous `position: absolute`
  // inside a sticky parent + z-[15] sticky neighbours made the popover
  // visually clipped / overlapped (Diego's "totally corrupted screen"
  // screenshot). Same pattern as SearchableSelect (stint 49.B2).
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null);

  const recomputePos = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r = t.getBoundingClientRect();
    setPopupPos({ left: r.left, top: r.bottom + 4 });
  }, []);

  // Re-sync drafts when external state changes (e.g. after a refetch)
  useEffect(() => {
    setDraftStatus(deriveStatus(liquidationDate));
    setDraftDate(liquidationDate ?? '');
  }, [liquidationDate]);

  // Click outside to close. The popover lives in a portal outside
  // wrapperRef's tree, so we have to check both the wrapper AND the
  // portaled popover before deciding "this click was outside".
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapperRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open]);

  // Compute + track popup position so it follows scroll/resize.
  useEffect(() => {
    if (!open) { setPopupPos(null); return; }
    recomputePos();
    const onScroll = () => recomputePos();
    const onResize = () => recomputePos();
    // capture=true so we catch scroll on inner overflow:auto ancestors too.
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, recomputePos]);

  async function saveStatus() {
    if (busy) return;
    // Resolve target date based on the picked status
    let targetDate: string | null;
    if (draftStatus === 'active') {
      targetDate = null;
    } else {
      // Liquidating or Liquidated — require a date
      if (!draftDate) {
        toast.error('Pick a liquidation date first.');
        return;
      }
      targetDate = draftDate;
    }
    // No-op if nothing changed
    if (targetDate === (liquidationDate ?? null)) {
      setOpen(false);
      return;
    }
    // Confirm before clearing a previously-set liquidation
    if (targetDate === null && liquidationDate) {
      if (!window.confirm(
        `Mark ${entityName} as Active again? Its liquidation date (${liquidationDate}) will be cleared.`,
      )) return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/tax-ops/entities/${entityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liquidation_date: targetDate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(
        targetDate
          ? `${entityName} status updated to ${draftStatus} · ${targetDate}`
          : `${entityName} marked active`,
      );
      onChanged();
      setOpen(false);
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Popover JSX rendered to body via portal. Clamp to viewport so a
  // click near the right/bottom edge doesn't render off-screen.
  const W = 260;
  const H = 200; // rough approximation; tighter clamp not worth the
                 // measurement round-trip for a small popover
  const popupNode = open && popupPos && typeof document !== 'undefined'
    ? createPortal(
        <div
          ref={popoverRef}
          className="fixed z-popover min-w-[260px] bg-surface border border-border rounded-md shadow-lg p-2 space-y-2"
          style={{
            left: Math.min(popupPos.left, (typeof window !== 'undefined' ? window.innerWidth  : 1200) - W - 4),
            top:  Math.min(popupPos.top,  (typeof window !== 'undefined' ? window.innerHeight : 800)  - H - 4),
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-xs font-medium text-ink">Entity actions</div>
          <div className="text-2xs text-ink-muted -mt-1.5">{entityName}</div>

          <div className="pt-1.5 border-t border-border">
            <div className="text-2xs text-ink-muted mb-0.5">Status</div>
            <div className="flex flex-col gap-0.5">
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name={`entity-status-${entityId}`}
                  checked={draftStatus === 'active'}
                  onChange={() => { setDraftStatus('active'); setDraftDate(''); }}
                />
                <span>Active</span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name={`entity-status-${entityId}`}
                  checked={draftStatus === 'liquidating'}
                  onChange={() => setDraftStatus('liquidating')}
                />
                <span>Liquidating <span className="text-ink-muted">(in progress)</span></span>
              </label>
              <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer">
                <input
                  type="radio"
                  name={`entity-status-${entityId}`}
                  checked={draftStatus === 'liquidated'}
                  onChange={() => setDraftStatus('liquidated')}
                />
                <span>Liquidated <span className="text-ink-muted">(closed)</span></span>
              </label>
            </div>
            {(draftStatus === 'liquidating' || draftStatus === 'liquidated') && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  type="date"
                  value={draftDate}
                  onChange={(e) => setDraftDate(e.target.value)}
                  className="px-1.5 py-0.5 text-xs border border-border rounded bg-surface tabular-nums"
                />
                <button
                  type="button"
                  onClick={() => setDraftDate(new Date().toISOString().slice(0, 10))}
                  className="text-2xs text-brand-700 hover:underline"
                >
                  today
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-1.5 pt-1 border-t border-border">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="px-2 py-0.5 text-xs rounded border border-border hover:bg-surface-alt"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveStatus()}
              disabled={busy}
              className="px-2 py-0.5 text-xs rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="text-2xs text-ink-faint italic pt-1 border-t border-border">
            Future returns auto-hide once the date passes year-end.
            Current-year matrix keeps the entity visible so wrap-up
            filings stay actionable.
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <span ref={wrapperRef} className="relative inline-block ml-1">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label={`Actions for ${entityName}`}
        title="Entity actions"
        // Stint 64.X.11 — kebab now reveals on row hover only (Linear /
        // Notion pattern). Was `opacity-60` at rest which still painted
        // 140 dots of grey across /tax-ops/cit; the parent <tr> carries
        // `group` so this descendant's `group-hover:` works. While the
        // menu is OPEN we force opacity-100 so the trigger doesn't
        // disappear from the user's mouse path the moment they move it
        // off the row to use the popover.
        className={[
          'inline-flex items-center justify-center w-5 h-5 rounded transition-opacity',
          'text-ink-faint hover:bg-surface-alt hover:text-ink',
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      >
        <MoreVerticalIcon size={12} />
      </button>
      {popupNode}
    </span>
  );
}
