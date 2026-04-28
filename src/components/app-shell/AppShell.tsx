'use client';

// The app shell: sidebar (left, fixed) + topbar + content column.
// Login / signup pages bypass the shell via the usePathname check so
// unauthenticated screens stay full-bleed.
//
// The shell owns the live badge counts so the same numbers that light
// up sidebar items also drive the home dashboard without re-fetching.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar, type SidebarBadges } from './Sidebar';
import { TopBar } from './TopBar';
import { OfflineBanner } from './OfflineBanner';
import { ChatDrawer } from '@/components/chat/ChatDrawer';
import { FeedbackWidget } from '@/components/feedback/FeedbackWidget';

// Routes that render without the shell (login, portal, public landing).
// Public-facing pages use their own minimal chrome, not the operator UI.
//
// Stint 64.B — added '/marketing'. The marketing layout brings its own
// sticky top-nav with logo + Sign in; rendering AppShell on top of it
// shows the operator sidebar to anonymous visitors of cifracompliance.com,
// which is wrong (private app chrome leaking into public surface).
const BARE_ROUTES = ['/login', '/portal', '/marketing'];

interface Declaration { id: string; status: string; }
interface AedLetter { id: string; urgency: string | null; status: string; }
interface Deadline { is_overdue: boolean; bucket: string; }

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const [badges, setBadges] = useState<SidebarBadges>({});
  const [chatOpen, setChatOpen] = useState(false);

  // Refresh badges when the user navigates. Cheap: these endpoints are
  // already indexed and most returns are < 50 rows. No streaming needed.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [declRes, aedRes, dlRes] = await Promise.allSettled([
          fetch('/api/declarations').then(r => r.ok ? r.json() : []),
          fetch('/api/aed').then(r => r.ok ? r.json() : []),
          fetch('/api/deadlines').then(r => r.ok ? r.json() : []),
        ]);
        if (cancelled) return;
        const declarations: Declaration[] = declRes.status === 'fulfilled' ? declRes.value : [];
        const aed: AedLetter[] = aedRes.status === 'fulfilled' ? aedRes.value : [];
        const deadlines: Deadline[] = dlRes.status === 'fulfilled' ? dlRes.value : [];

        setBadges({
          declarationsInReview: declarations.filter(d => d.status === 'review').length,
          aedUrgent: aed.filter(a => a.urgency === 'high' && a.status !== 'actioned' && a.status !== 'archived').length,
          deadlinesUrgent: deadlines.filter(d => d.is_overdue || d.bucket === 'urgent').length,
        });
      } catch {
        /* silent — sidebar simply renders without counts */
      }
    }
    load();
    return () => { cancelled = true; };
  }, [pathname]);

  if (BARE_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen">
      {/* Skip-to-content link — invisible until focused, lets keyboard
          users bypass the sidebar and jump straight to the page content.
          Visible on Tab from page load. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-toast focus:px-3 focus:py-2 focus:bg-brand-500 focus:text-white focus:rounded focus:shadow-lg focus:text-sm focus:font-medium"
      >
        Skip to main content
      </a>
      <OfflineBanner />
      <Sidebar badges={badges} />
      <div className="md:pl-[232px]">
        <TopBar
          badges={badges}
          onOpenChat={() => setChatOpen(true)}
          chatOpen={chatOpen}
        />
        <main id="main-content" className="px-4 md:px-8 py-6 md:py-8 max-w-[1400px]">
          {children}
        </main>
      </div>
      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} />
      <FeedbackWidget />
    </div>
  );
}
