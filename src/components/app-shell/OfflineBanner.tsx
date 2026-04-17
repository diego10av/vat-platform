'use client';

// ════════════════════════════════════════════════════════════════════════
// OfflineBanner — thin strip that appears at the top of the app when
// navigator.onLine flips to false. Keeps users from staring at "nothing
// happens" when their WiFi blips.
//
// Uses the Navigator offline event, which is well-supported everywhere.
// False positives exist (some captive-WiFi states report offline even
// when the browser can reach some servers) but the banner is low-cost
// and dismissible.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react';
import { WifiOffIcon } from 'lucide-react';

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Initial read (after hydration).
    if (typeof navigator !== 'undefined') {
      setOffline(navigator.onLine === false);
    }
    const onOnline = () => {
      setOffline(false);
      setDismissed(false); // new online → fresh banner on next disconnect
    };
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (!offline || dismissed) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-50 bg-warning-500 text-white text-[12px] font-medium px-4 py-1.5 flex items-center justify-center gap-2 shadow"
    >
      <WifiOffIcon size={14} />
      <span>You&apos;re offline. Actions that require the server will fail until you reconnect.</span>
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 underline opacity-80 hover:opacity-100"
        aria-label="Dismiss offline banner"
      >
        dismiss
      </button>
    </div>
  );
}
