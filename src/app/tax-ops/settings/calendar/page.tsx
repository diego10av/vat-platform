'use client';

// /tax-ops/settings/calendar — iCal subscription page (stint 42.C).
//
// Gives Diego a read-only calendar URL he can paste into Google
// Calendar / Apple Calendar / Outlook "Add by URL". The URL is
// guarded by the CIFRA_ICAL_TOKEN env var; this page just shows
// him the URL once the env var is set.

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, CopyIcon, CheckIcon, CalendarIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useToast } from '@/components/Toaster';

export default function CalendarSubscriptionPage() {
  const [origin, setOrigin] = useState('');
  const [token, setToken] = useState<string | null>('');
  const [loadingToken, setLoadingToken] = useState(true);
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setOrigin(window.location.origin);
    // Probe the endpoint without auth to see if it's configured.
    // A 503 means CIFRA_ICAL_TOKEN env var isn't set; a 401 means
    // it is but we didn't provide a token — that's the expected signal.
    fetch('/api/tax-ops/calendar.ics').then(r => {
      if (r.status === 503) setToken(null);
      else setToken('ready');
    }).catch(() => setToken(null)).finally(() => setLoadingToken(false));
  }, []);

  const tokenValue = useCallback(() => {
    // Placeholder pattern; Diego replaces with the real token.
    return '<CIFRA_ICAL_TOKEN>';
  }, []);

  const feedUrl = `${origin}/api/tax-ops/calendar.ics?token=${tokenValue()}`;

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success('URL copied');
    } catch {
      toast.error('Copy failed — copy manually from the box');
    }
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <Link href="/tax-ops/settings" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to settings
      </Link>

      <PageHeader
        title="Calendar subscription"
        subtitle="Subscribe your upcoming tax-ops deadlines to Google / Apple / Outlook Calendar."
      />

      <div className="rounded-md border border-border bg-surface px-4 py-4 space-y-4">
        <div className="flex items-start gap-2">
          <CalendarIcon size={18} className="text-brand-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-semibold text-ink">iCal feed URL</div>
            <p className="text-[12px] text-ink-muted mt-0.5">
              Read-only feed. Includes every filing with a deadline in the
              next 180 days that is not yet filed / waived / assessment_received.
              Refreshes whenever your calendar client polls (typically every
              few hours).
            </p>
          </div>
        </div>

        {loadingToken ? (
          <div className="text-[12px] text-ink-muted italic">Checking feed configuration…</div>
        ) : token === null ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            <strong>Feed not configured yet.</strong> Set the <code className="text-[11.5px] bg-amber-100 px-1 rounded">CIFRA_ICAL_TOKEN</code> environment
            variable in Vercel (any random 24+ char string) and redeploy. Then come back here
            and you&apos;ll see your subscription URL.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={feedUrl}
                onClick={(e) => (e.target as HTMLInputElement).select()}
                className="flex-1 px-2 py-1.5 text-[11.5px] font-mono border border-border rounded bg-surface-alt/40 tabular-nums"
              />
              <button
                type="button"
                onClick={copyUrl}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[12px] rounded-md border border-border hover:bg-surface-alt"
              >
                {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[11.5px] text-ink-muted">
              Replace <code className="text-[10.5px] bg-surface-alt px-1 rounded">&lt;CIFRA_ICAL_TOKEN&gt;</code> with
              the token value you set in Vercel before pasting the URL into your calendar client.
            </p>
          </>
        )}
      </div>

      <div className="rounded-md border border-border bg-surface px-4 py-4">
        <h3 className="text-[13px] font-semibold text-ink mb-2">How to subscribe</h3>
        <div className="text-[12.5px] text-ink-soft space-y-3">
          <div>
            <div className="font-medium text-ink">Google Calendar</div>
            <ol className="list-decimal list-inside ml-2 mt-1 space-y-0.5 text-[12px]">
              <li>Open <a className="text-brand-700 hover:underline" href="https://calendar.google.com/calendar/u/0/r/settings/addbyurl" target="_blank" rel="noreferrer">calendar.google.com → Settings → Add by URL</a>.</li>
              <li>Paste the feed URL above. Click <em>Add calendar</em>.</li>
              <li>The new calendar appears under <em>Other calendars</em>. Rename / color-code as you like.</li>
            </ol>
          </div>
          <div>
            <div className="font-medium text-ink">Apple Calendar (macOS / iOS)</div>
            <ol className="list-decimal list-inside ml-2 mt-1 space-y-0.5 text-[12px]">
              <li>Calendar app → <em>File → New Calendar Subscription</em> (macOS) or <em>Settings → Add Calendar → Add Subscribed Calendar</em> (iOS).</li>
              <li>Paste the feed URL. Click Subscribe.</li>
              <li>Set refresh to <em>Every hour</em> or <em>Every day</em> to taste.</li>
            </ol>
          </div>
          <div>
            <div className="font-medium text-ink">Outlook / Microsoft 365</div>
            <ol className="list-decimal list-inside ml-2 mt-1 space-y-0.5 text-[12px]">
              <li>Calendar → <em>Add calendar → Subscribe from web</em>.</li>
              <li>Paste the feed URL. Pick a name + color. Import.</li>
            </ol>
          </div>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface-alt/40 px-4 py-3 text-[11.5px] text-ink-muted">
        <strong>Privacy</strong> — the feed only carries entity name, tax type, period, and
        deadline. No amounts, no comments, no contact details. The token prevents
        casual discovery; if you suspect it leaked, rotate the env var.
      </div>
    </div>
  );
}
