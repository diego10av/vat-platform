'use client';

// ════════════════════════════════════════════════════════════════════════
// LiquidationChip — stint 43.D15
//
// Small inline-editable chip rendered next to the entity name when the
// entity has a liquidation_date set. Click → popover with date picker +
// "Mark today" + "Clear" actions. PATCH hits /api/tax-ops/entities/[id].
//
// Three visual states:
//   - liquidation_date in the future or current year → amber chip
//     "Liquidating · DD-MM"
//   - liquidation_date strictly in the past → gray-faint chip
//     "Liquidated · YYYY-MM-DD"
//   - liquidation_date null → "Set liquidation" muted ghost button
//     (shown via a separate prop on consumer side; the chip itself
//     renders only when a date is set, by design)
//
// Diego: "lo de liquidated está enterrado en detalles" — this surfaces
// it where he actually looks (next to the entity name in the sticky col).
// ════════════════════════════════════════════════════════════════════════

import { useState, useRef, useEffect } from 'react';
import { useToast } from '@/components/Toaster';
// Re-export pure helpers from their own module so they're testable
// without pulling this 'use client' component into the test env.
export { periodWindow, isFinalReturnPeriod } from './liquidationPeriods';
export type { PeriodWindow } from './liquidationPeriods';

interface Props {
  entityId: string;
  entityName: string;
  liquidationDate: string | null;
  /** Called after a successful PATCH so the matrix refetches. */
  onChanged: () => void;
  /** When true, even a null date renders a small "+ liquidate" ghost
   *  button. Default: only render the chip when a date is set. */
  alwaysVisible?: boolean;
}

export function LiquidationChip({
  entityId, entityName, liquidationDate, onChanged, alwaysVisible,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(liquidationDate ?? '');
  const [busy, setBusy] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const toast = useToast();

  // Sync draft when prop changes (after refetch)
  useEffect(() => { setDraft(liquidationDate ?? ''); }, [liquidationDate]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  async function save(nextDate: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/tax-ops/entities/${entityId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ liquidation_date: nextDate }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(
        nextDate
          ? `${entityName} liquidation set to ${nextDate}`
          : `${entityName} liquidation cleared`,
      );
      onChanged();
      setOpen(false);
    } catch (e) {
      toast.error(`Save failed: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(false);
    }
  }

  // Visual state
  const today = new Date().toISOString().slice(0, 10);
  const isPast = liquidationDate !== null && liquidationDate < today;
  const chipClass = liquidationDate
    ? isPast
      ? 'bg-surface-alt text-ink-faint border border-border'
      : 'bg-amber-100 text-amber-800 border border-amber-300'
    : 'bg-transparent text-ink-faint border border-dashed border-border hover:bg-amber-50 hover:text-amber-700 hover:border-amber-300';

  const chipLabel = liquidationDate
    ? (isPast ? `Liquidated · ${liquidationDate}` : `Liquidating · ${liquidationDate.slice(5)}`)
    : '+ liquidate';

  // When no date is set and we're not in alwaysVisible mode, render
  // nothing — the consumer can choose to show the "+ liquidate" button
  // in a row-action slot if they want.
  if (!liquidationDate && !alwaysVisible) return null;

  return (
    <span ref={wrapperRef} className="relative inline-block ml-1.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        disabled={busy}
        className={[
          'inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium whitespace-nowrap',
          chipClass,
          'disabled:opacity-50',
        ].join(' ')}
        title={
          liquidationDate
            ? `Liquidation date: ${liquidationDate} · click to change`
            : 'Set liquidation date'
        }
      >
        {chipLabel}
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-30 min-w-[260px] bg-surface border border-border rounded-md shadow-lg p-2 space-y-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="text-[11px] font-medium text-ink">Liquidation date</div>
          <div className="text-[10.5px] text-ink-muted">
            {entityName}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="px-2 py-1 text-[12px] border border-border rounded bg-surface flex-1"
            />
            <button
              type="button"
              onClick={() => void save(draft || null)}
              disabled={busy || draft === (liquidationDate ?? '')}
              className="px-2 py-1 text-[11.5px] bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
            >
              Save
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => void save(today)}
              disabled={busy}
              className="text-[11px] text-brand-700 hover:underline disabled:opacity-50"
            >
              Mark today ({today})
            </button>
            {liquidationDate && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(`Clear liquidation date for ${entityName}? The entity returns to active status.`)) return;
                  void save(null);
                }}
                disabled={busy}
                className="text-[11px] text-danger-600 hover:underline disabled:opacity-50"
              >
                Clear
              </button>
            )}
          </div>
          <div className="text-[10px] text-ink-faint italic pt-1 border-t border-border">
            Future returns are auto-hidden once the date passes year-end.
            Current-year matrix keeps showing it so wrap-up filings stay
            visible.
          </div>
        </div>
      )}
    </span>
  );
}

