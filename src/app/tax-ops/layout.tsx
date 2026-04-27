'use client';

// ════════════════════════════════════════════════════════════════════════
// /tax-ops — layout shared by all sub-routes of the Tax-Ops module.
//
// Independent from /crm (by Diego's explicit call — the Excels contain
// partners' clients that don't belong in his CRM book). Mirrors the
// CRM nav shape for muscle memory but routes its own URLs + data.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboardIcon, FileTextIcon, BuildingIcon, CheckSquareIcon,
  SettingsIcon, HelpCircleIcon,
} from 'lucide-react';
import { OverflowMenu } from '@/components/ui/OverflowMenu';
import { QuickCaptureModal } from '@/components/tax-ops/QuickCaptureModal';

// Stint 59.B — tabs reordered + Calendar tab removed.
// • Tasks promoted to second slot (most-used surface for daily work).
// • Calendar tab removed: it pointed to /tax-ops/calendar which was a
//   ghost route (404). Calendar view lives inside /tax-ops/tasks as
//   `view=calendar` toggle — go to Tasks → click Calendar layout.
// • Filings demoted to last: it's a cross-tax-type search, useful but
//   secondary. Daily flow is Sidebar → category matrix → filing detail.
const PRIMARY_TABS = [
  { href: '/tax-ops',          label: 'Home',     icon: LayoutDashboardIcon },
  { href: '/tax-ops/tasks',    label: 'Tasks',    icon: CheckSquareIcon },
  { href: '/tax-ops/entities', label: 'Entities', icon: BuildingIcon },
  { href: '/tax-ops/filings',  label: 'Filings',  icon: FileTextIcon },
];

const OVERFLOW_ITEMS = [
  { href: '/tax-ops/settings', label: 'Settings', icon: SettingsIcon },
  { href: '/tax-ops/help',     label: 'Help',     icon: HelpCircleIcon },
];

export default function TaxOpsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="max-w-[1400px] mx-auto px-4 pt-4">
      <nav className="flex items-center gap-1 border-b border-border mb-4">
        {PRIMARY_TABS.map(tab => {
          // Exact match for /tax-ops (the home) so every sub-route
          // doesn't also light up the Home tab.
          const isActive = tab.href === '/tax-ops'
            ? pathname === '/tax-ops'
            : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-brand-500 text-brand-700'
                  : 'border-transparent text-ink-muted hover:text-ink hover:border-border-strong'
              }`}
            >
              <Icon size={13} />
              {tab.label}
            </Link>
          );
        })}
        <div className="ml-auto flex items-center gap-1 pb-1.5">
          <OverflowMenu items={OVERFLOW_ITEMS} ariaLabel="More tax-ops sections" />
        </div>
      </nav>
      <div>{children}</div>
      <QuickCaptureModal />
    </div>
  );
}
