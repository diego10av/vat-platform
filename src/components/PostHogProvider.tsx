'use client';

// ════════════════════════════════════════════════════════════════════════
// PostHogProvider
//
// Top-level wrapper that:
//   - Initialises PostHog on first render (idempotent, no-op if no key)
//   - Fires a `$pageview` event on every client-side route change
//
// Mounted once in `src/app/layout.tsx` around the whole tree.
// ════════════════════════════════════════════════════════════════════════

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { initPostHog, posthog } from '@/lib/posthog-client';

function PageviewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return;
    if (!pathname) return;
    let url = window.location.origin + pathname;
    const q = searchParams?.toString();
    if (q) url += `?${q}`;
    posthog.capture('$pageview', { $current_url: url });
  }, [pathname, searchParams]);

  return null;
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => { initPostHog(); }, []);
  return (
    <>
      {/* useSearchParams must be inside a Suspense boundary under Next 15+ */}
      <Suspense fallback={null}>
        <PageviewTracker />
      </Suspense>
      {children}
    </>
  );
}
