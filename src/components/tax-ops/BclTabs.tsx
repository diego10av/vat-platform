'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/tax-ops/bcl/sbs',     label: 'SBS (quarterly)' },
  { href: '/tax-ops/bcl/bcl216',  label: 'BCL 2.16 (monthly)' },
];

export function BclTabs() {
  const pathname = usePathname();
  return (
    <div className="flex gap-1 border-b border-border">
      {TABS.map(tab => {
        const isActive = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={[
              'px-3 py-1.5 text-[12.5px] border-b-2 transition-colors',
              isActive
                ? 'border-brand-500 text-brand-700 font-medium'
                : 'border-transparent text-ink-muted hover:text-ink hover:border-border-strong',
            ].join(' ')}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
