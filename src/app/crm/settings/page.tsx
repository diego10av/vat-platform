import Link from 'next/link';
import { BuildingIcon, ChevronRightIcon, ZapIcon, ListChecksIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

// CRM settings landing — lists sub-areas.
export default function CrmSettingsIndex() {
  const items = [
    {
      href: '/crm/settings/firm',
      icon: BuildingIcon,
      title: 'Firm identity',
      blurb: 'Name, address, VAT, bank details, default payment terms. Used on invoice PDFs.',
    },
    {
      href: '/crm/settings/automations',
      icon: ZapIcon,
      title: 'Automations',
      blurb: 'Rules that auto-create follow-up tasks on stage changes, invoice events, etc.',
    },
    {
      href: '/crm/settings/taxonomies',
      icon: ListChecksIcon,
      title: 'Categories',
      blurb: 'Editable dropdown values — countries, industries, practice areas, fee types, contact roles, sources, loss reasons.',
    },
  ];
  return (
    <div>
      <PageHeader title="CRM settings" subtitle="Configure firm-wide defaults used across the CRM" />
      <div className="grid gap-2 max-w-[640px]">
        {items.map(it => {
          const Icon = it.icon;
          return (
            <Link
              key={it.href}
              href={it.href}
              className="flex items-start gap-3 p-3 border border-border rounded-md bg-white hover:bg-surface-alt hover:border-border-strong transition-colors"
            >
              <div className="shrink-0 mt-0.5 w-8 h-8 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center">
                <Icon size={15} />
              </div>
              <div className="flex-1">
                <div className="text-[13px] font-semibold text-ink">{it.title}</div>
                <div className="text-[11.5px] text-ink-muted mt-0.5">{it.blurb}</div>
              </div>
              <ChevronRightIcon size={14} className="text-ink-muted mt-2" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
