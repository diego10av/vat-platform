import Link from 'next/link';
import { NextBestActionWidget } from '@/components/crm/NextBestActionWidget';
import { ForecastWidget } from '@/components/crm/ForecastWidget';
import { WipWidget } from '@/components/crm/WipWidget';
import {
  BuildingIcon, UsersIcon, TargetIcon, BriefcaseIcon,
  CalendarIcon, CheckSquareIcon, EuroIcon,
} from 'lucide-react';

// /crm — the landing / home view of the CRM module.
// Replaces the previous redirect-to-companies stub. Shows:
//   - Next Best Action widget (the "what should I do today?" list)
//   - Quick links to each of the 7 entity tabs
export default function CrmHomePage() {
  const shortcuts = [
    { href: '/crm/companies',     label: 'Companies',     icon: BuildingIcon,   blurb: 'Clients, prospects, service providers' },
    { href: '/crm/contacts',      label: 'Contacts',      icon: UsersIcon,      blurb: 'People at those companies' },
    { href: '/crm/opportunities', label: 'Opportunities', icon: TargetIcon,     blurb: 'Pipeline — drag-drop kanban' },
    { href: '/crm/matters',       label: 'Matters',       icon: BriefcaseIcon,  blurb: 'Won opps become engagements' },
    { href: '/crm/activities',    label: 'Activities',    icon: CalendarIcon,   blurb: 'Calls, meetings, emails logged' },
    { href: '/crm/tasks',         label: 'Tasks',         icon: CheckSquareIcon, blurb: 'To-dos with due dates' },
    { href: '/crm/billing',       label: 'Billing',       icon: EuroIcon,       blurb: 'Invoices, payments, dashboards' },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[18px] font-semibold text-ink">CRM home</h1>
        <p className="text-[12.5px] text-ink-muted mt-0.5">
          Start here every morning. The panel below is ranked by urgency — pipe from overdue invoices
          down to routine follow-ups.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ForecastWidget />
        <WipWidget />
      </div>

      <NextBestActionWidget />

      <section>
        <h2 className="text-[12px] uppercase tracking-wide font-semibold text-ink-muted mb-2">Jump into</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {shortcuts.map(s => {
            const Icon = s.icon;
            return (
              <Link
                key={s.href}
                href={s.href}
                className="flex items-start gap-2.5 p-3 border border-border rounded-md bg-white hover:bg-surface-alt hover:border-border-strong transition-colors"
              >
                <div className="shrink-0 mt-0.5 w-7 h-7 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center">
                  <Icon size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-[12.5px] font-semibold text-ink">{s.label}</div>
                  <div className="text-[11px] text-ink-muted truncate">{s.blurb}</div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
