'use client';

// Shared tabs strip for the 3 VAT sub-pages. Rendered inside each page
// so deep-links survive and sidebar state stays in sync.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/tax-ops/vat/annual',    label: 'Annual' },
  { href: '/tax-ops/vat/quarterly', label: 'Quarterly' },
  { href: '/tax-ops/vat/monthly',   label: 'Monthly' },
];

export function VatTabs() {
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
