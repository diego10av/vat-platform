'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CalendarPlusIcon, LandmarkIcon, EuroIcon, PercentIcon,
  WalletIcon, LibraryBigIcon, FolderIcon,
} from 'lucide-react';
import { TaxOpsHomeWidgets } from '@/components/tax-ops/HomeWidgets';
import { TasksDueWidget } from '@/components/tax-ops/TasksDueWidget';
import { RolloverModal } from '@/components/tax-ops/RolloverModal';

// /tax-ops home — daily landing for compliance work.
//
// Shape (stint 35 redesign):
//   1. Header + year-rollover button (top-right)
//   2. 8-card category grid (CIT, NWT, VAT, Subscription, WHT, BCL,
//      Other, Entities) — one click per category, matches Excel mental
//      model. The grid is NOT decorative: each card takes you to a
//      matrix page where real work happens.
//   3. Actionable widgets (deadline radar, pending my action, etc.) —
//      reused from stint 34.
//
// Paths like /tax-ops/tasks and /tax-ops/settings are in the sidebar
// and don't get their own home card (secondary workflows).

// Stint 40.J — NWT Reviews card removed from the grid: Diego said
// "esa caja habría que borrarla porque no tiene sentido que esté ahí".
// NWT is a column inside CIT (stint 37.D) and still reachable via sidebar.
// BCL now routes to /tax-ops/bcl (stint 40.D merge).
const CATEGORIES = [
  {
    href: '/tax-ops/cit',
    icon: LandmarkIcon,
    title: 'Corporate tax returns',
    description: 'Form 500 — annual CIT + municipal business tax + NWT reviews',
  },
  {
    href: '/tax-ops/bcl',
    icon: LibraryBigIcon,
    title: 'BCL reporting',
    description: 'SBS quarterly + 2.16 monthly (both in one flow)',
  },
  {
    href: '/tax-ops/vat/annual',
    icon: EuroIcon,
    title: 'VAT',
    description: 'Annual · Quarterly · Monthly (tabs inside)',
  },
  {
    href: '/tax-ops/subscription-tax',
    icon: PercentIcon,
    title: 'Subscription tax',
    description: 'UCI / AIF quarterly — strict deadlines',
  },
  {
    href: '/tax-ops/wht/monthly',
    icon: WalletIcon,
    title: 'Withholding tax',
    description: 'Director fees — monthly / semester / annual / ad-hoc',
  },
  {
    href: '/tax-ops/other',
    icon: FolderIcon,
    title: 'Other (ad-hoc)',
    description: 'VAT registrations, deregistrations, FCR',
  },
];

export default function TaxOpsHomePage() {
  const [rolloverOpen, setRolloverOpen] = useState(false);
  const nextYear = new Date().getFullYear() + 1;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Tax-Ops</h1>
          <p className="text-[12.5px] text-ink-muted mt-0.5">
            Pick a tax category below for its Excel-style matrix view. Sidebar
            has every category + Entities + Tasks; use <kbd className="text-[10px] px-1 py-0.5 rounded bg-surface-alt border border-border">g t</kbd> to jump
            here from anywhere, or <kbd className="text-[10px] px-1 py-0.5 rounded bg-surface-alt border border-border">⌘K</kbd> to search.
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

      {/* Category grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {CATEGORIES.map(cat => {
          const Icon = cat.icon;
          return (
            <Link
              key={cat.href}
              href={cat.href}
              className="group rounded-md border border-border bg-surface px-3 py-2.5 hover:border-brand-500 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-2">
                <Icon size={16} className="shrink-0 mt-0.5 text-ink-soft group-hover:text-brand-500 transition-colors" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink truncate">
                    {cat.title}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5 line-clamp-2">
                    {cat.description}
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <TasksDueWidget />

      <TaxOpsHomeWidgets />

      <RolloverModal
        open={rolloverOpen}
        year={nextYear}
        onClose={() => setRolloverOpen(false)}
      />
    </div>
  );
}
