'use client';

import { useState } from 'react';
import { CalendarPlusIcon } from 'lucide-react';
import { TaxOpsHomeWidgets } from '@/components/tax-ops/HomeWidgets';
import { RolloverModal } from '@/components/tax-ops/RolloverModal';

// /tax-ops home — daily landing for compliance work.
//
// Shape (stint 34.C):
//   1. 4 actionable widgets stacked top-to-bottom (HomeWidgets.tsx)
//   2. "Open next year" button — year-rollover modal (replaces the
//      annual pain of rebuilding Excel from scratch)
//
// 5th widget "Upcoming tasks" lands with the tasks surface in 34.E.
export default function TaxOpsHomePage() {
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const nextYear = new Date().getFullYear() + 1;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Tax-Ops</h1>
          <p className="text-[12.5px] text-ink-muted mt-0.5">
            Compliance tracker for CIT, VAT, WHT, subscription tax and BCL reporting —
            with live deadlines, status filters, and one-click year rollover.
          </p>
        </div>
        <button
          onClick={() => setRolloverOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[12.5px] font-medium rounded-md bg-brand-500 hover:bg-brand-600 text-white whitespace-nowrap"
        >
          <CalendarPlusIcon size={14} />
          Open {nextYear}
        </button>
      </div>

      <TaxOpsHomeWidgets />

      <RolloverModal
        open={rolloverOpen}
        year={nextYear}
        onClose={() => setRolloverOpen(false)}
      />
    </div>
  );
}
