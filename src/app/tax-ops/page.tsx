'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  CalendarPlusIcon, LandmarkIcon, CalculatorIcon, PercentIcon,
  WalletIcon, LibraryBigIcon, FolderIcon,
} from 'lucide-react';
import { TaxOpsHomeWidgets } from '@/components/tax-ops/HomeWidgets';
import { TasksDueWidget } from '@/components/tax-ops/TasksDueWidget';
import { RolloverModal } from '@/components/tax-ops/RolloverModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageContainer } from '@/components/ui/PageContainer';
import { Button } from '@/components/ui/Button';

// /tax-ops home — daily landing for compliance work.
//
// Stint 59.B redesign — actionable-first per Hard Rule §11.
// "Today's focus" sits at the top (tasks due + 4 filing widgets); the
// "Browse by tax type" grid moves to the bottom because it's a
// navigation shortcut (the sidebar already has every category), not a
// daily-work surface.
//
// Layout, top to bottom:
//   1. Header + "Open {nextYear}" button (the only headline action).
//   2. Today's focus
//      ├── Tasks due this week (TasksDueWidget)
//      └── Filings 2×2 grid (Deadline radar / My action / Client
//          approval / Stale assessments)
//   3. Browse by tax type — 6-card grid (CIT / BCL / VAT / Subtax /
//      WHT / Other), useful for "I want to open the VAT matrix now"
//      but secondary to actionable work.

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
    icon: CalculatorIcon,
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
    <PageContainer width="wide">
      <div className="space-y-5">
      <PageHeader
        title="Tax-Ops"
        subtitle="Today's actionable work first; tax-type matrices below."
        actions={
          <Button
            variant="primary"
            size="md"
            icon={<CalendarPlusIcon size={14} />}
            onClick={() => setRolloverOpen(true)}
          >
            Open {nextYear}
          </Button>
        }
      />

      {/* ── Today's focus ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink uppercase tracking-wide">
            Today&apos;s focus
          </h2>
          <span className="text-2xs text-ink-muted">
            Press{' '}
            <kbd className="text-2xs px-1 py-0.5 rounded bg-surface-alt border border-border">⌘K</kbd>
            {' '}for search ·{' '}
            <kbd className="text-2xs px-1 py-0.5 rounded bg-surface-alt border border-border">N</kbd>
            {' '}to capture a task
          </span>
        </div>
        <TasksDueWidget />
        <TaxOpsHomeWidgets />
      </section>

      {/* ── Browse by tax type — secondary navigation ─────────────── */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">
          Browse by tax type
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
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
                    <div className="text-sm font-semibold text-ink truncate">
                      {cat.title}
                    </div>
                    <div className="text-xs text-ink-muted mt-0.5 line-clamp-2">
                      {cat.description}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <RolloverModal
        open={rolloverOpen}
        year={nextYear}
        onClose={() => setRolloverOpen(false)}
      />
      </div>
    </PageContainer>
  );
}
