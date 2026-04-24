'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/tax-ops/wht/monthly',  label: 'Monthly (director fees)' },
  { href: '/tax-ops/wht/semester', label: 'Semester' },
  { href: '/tax-ops/wht/annual',   label: 'Annual summary' },
];

export function WhtTabs() {
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
