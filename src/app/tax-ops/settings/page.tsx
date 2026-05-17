import Link from 'next/link';
import {
  ClockIcon, LayersIcon,
  BookUserIcon, DatabaseIcon, ChevronRightIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

// /tax-ops/settings — small index of admin surfaces.
//
// Stint 96 — removed the Team members card (single-user; the
// tax_team_members table + UI page were vestigial multi-user
// plumbing) and the Entity deduplication card (one-shot tool that
// finished its job in stint 40.A; nothing left to dedupe). The
// "Obligations templates" greyed card also goes — it's been "Soon"
// for too long to keep advertising.

export default function TaxOpsSettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage the deadline rules that drive every filing + supporting reference data."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SettingsCard
          href="/tax-ops/settings/deadlines"
          icon={ClockIcon}
          title="Deadline rules"
          description="Seeded from Luxembourg statutory + AED market practice. Edit when the practice shifts — the change propagates to every open filing of that tax type."
        />
        <SettingsCard
          href="/tax-ops/settings/groups"
          icon={LayersIcon}
          title="Client groups (families)"
          description="Create, rename, archive the fund families that group your entities (Peninsula, Trilantic, ...). Inline-assignable from any tax-type page."
        />
        <SettingsCard
          href="/tax-ops/contacts"
          icon={BookUserIcon}
          title="Contacts book"
          description="Reverse index of every CSP contact across entities and filings. Rename a contact once, propagate to every row in one transaction."
        />
        <SettingsCard
          href="/tax-ops/settings/backup"
          icon={DatabaseIcon}
          title="Backup snapshot"
          description="Download a point-in-time JSON of every Tax-Ops table. Cheap insurance to take before risky operations."
        />
      </div>
    </div>
  );
}

function SettingsCard({
  href, icon: Icon, title, description,
}: {
  href: string;
  icon: typeof ClockIcon;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="block">
      <div className="rounded-md border border-border bg-surface p-4 flex items-start gap-3 h-full hover:border-brand-500 hover:shadow-sm transition-all">
        <Icon size={18} className="shrink-0 mt-0.5 text-ink-soft" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink flex items-center gap-1.5">
            {title}
            <ChevronRightIcon size={12} className="text-ink-faint" />
          </div>
          <p className="text-sm text-ink-muted mt-1">{description}</p>
        </div>
      </div>
    </Link>
  );
}
