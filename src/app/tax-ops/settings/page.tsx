import Link from 'next/link';
import { UsersIcon, ClockIcon, RefreshCwIcon, ChevronRightIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

// /tax-ops/settings — small index of admin surfaces.
//
// Two cards live today:
//   1. Team members   (tax_team_members CRUD — Diego adds 8 people)
//   2. Deadline rules (the 13 seeded rules, editable, with propagation
//                       to open filings)
// A third card (Obligations templates) is sketched but greyed out —
// build if/when Diego asks for it.

export default function TaxOpsSettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Manage the team roster and the deadline rules that drive every filing."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <SettingsCard
          href="/tax-ops/settings/team"
          icon={UsersIcon}
          title="Team members"
          description="The people you can assign filings to. Add short-name aliases that match your Excel 'Prepared with' conventions (Gab, Andrew, …)."
        />
        <SettingsCard
          href="/tax-ops/settings/deadlines"
          icon={ClockIcon}
          title="Deadline rules"
          description="Seeded from Luxembourg statutory + AED market practice. Edit when the practice shifts — the change propagates to every open filing of that tax type."
        />
        <SettingsCard
          href="#"
          icon={RefreshCwIcon}
          title="Obligations templates"
          description="Bulk-create recurring obligations for a new entity. Coming later — for now, use the entity detail page's 'Add obligation' button."
          disabled
        />
      </div>
    </div>
  );
}

function SettingsCard({
  href, icon: Icon, title, description, disabled,
}: {
  href: string;
  icon: typeof UsersIcon;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  const content = (
    <div className={`rounded-md border border-border bg-surface p-4 flex items-start gap-3 h-full ${
      disabled ? 'opacity-60' : 'hover:border-brand-500 hover:shadow-sm transition-all'
    }`}>
      <Icon size={18} className="shrink-0 mt-0.5 text-ink-soft" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink flex items-center gap-1.5">
          {title}
          {!disabled && <ChevronRightIcon size={12} className="text-ink-faint" />}
          {disabled && <span className="text-[10.5px] font-normal text-ink-muted px-1.5 py-0.5 bg-surface-alt rounded">Soon</span>}
        </div>
        <p className="text-[12px] text-ink-muted mt-1">{description}</p>
      </div>
    </div>
  );
  if (disabled) return content;
  return <Link href={href} className="block">{content}</Link>;
}
