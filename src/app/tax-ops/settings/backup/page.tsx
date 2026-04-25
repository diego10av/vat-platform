'use client';

// /tax-ops/settings/backup — point-in-time JSON snapshot of every
// Tax-Ops table. Diego clicks Download, gets a JSON file. Useful as
// a "I'm not sure what I'm about to do, let me snapshot first" safety
// net before any operation he's not 100% confident about.

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon, DownloadIcon, DatabaseIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

export default function BackupPage() {
  const [includeAudit, setIncludeAudit] = useState(false);
  const [busy, setBusy] = useState(false);

  async function downloadSnapshot() {
    setBusy(true);
    try {
      const url = `/api/tax-ops/backup${includeAudit ? '?include_audit=1' : ''}`;
      // Trigger a real navigation to the endpoint so the browser
      // honours Content-Disposition: attachment and writes a file.
      const a = document.createElement('a');
      a.href = url;
      a.download = '';  // browser uses Content-Disposition's filename
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      // Allow another click after a short delay (download is async)
      setTimeout(() => setBusy(false), 1500);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link href="/tax-ops/settings" className="inline-flex items-center gap-1 text-[12px] text-ink-muted hover:text-ink">
        <ArrowLeftIcon size={12} /> Back to settings
      </Link>

      <PageHeader
        title="Backup snapshot"
        subtitle="Download a JSON dump of every Tax-Ops table for local safekeeping. Periodic snapshots are cheap insurance against catastrophic data loss."
      />

      <div className="rounded-md border border-border bg-surface px-4 py-4 space-y-3">
        <div className="flex items-start gap-2">
          <DatabaseIcon size={18} className="text-brand-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-[13px] font-semibold text-ink">What&apos;s included</div>
            <ul className="mt-1 text-[12px] text-ink-muted list-disc list-inside space-y-0.5">
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_client_groups</code> — every family + its metadata</li>
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_entities</code> — every entity (active + archived) with VAT numbers, contacts, notes</li>
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_obligations</code> — what tax types each entity owes</li>
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_filings</code> — every filing row including status, deadlines, prices, contacts</li>
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_ops_tasks</code> — every task and follow-up</li>
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_deadline_rules</code> — your editable deadline rules</li>
              <li><code className="text-[11.5px] bg-surface-alt px-1 rounded">tax_team_members</code> — your team roster</li>
            </ul>
          </div>
        </div>

        <label className="flex items-start gap-2 text-[12.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={includeAudit}
            onChange={(e) => setIncludeAudit(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            <strong className="text-ink">Include audit log</strong>
            <span className="block text-[11.5px] text-ink-muted">
              Every status change, family move, merge, contact edit. Optional because it can be
              several MB once you&apos;ve been running for a while.
            </span>
          </span>
        </label>

        <button
          type="button"
          onClick={downloadSnapshot}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3 py-1.5 text-[12.5px] rounded-md bg-brand-500 hover:bg-brand-600 text-white disabled:opacity-50"
        >
          <DownloadIcon size={13} />
          {busy ? 'Preparing…' : 'Download JSON snapshot now'}
        </button>
      </div>

      <div className="rounded-md border border-border bg-surface-alt/40 px-4 py-3 text-[11.5px] text-ink-muted">
        <strong>What this is and isn&apos;t.</strong> This snapshot is a point-in-time JSON file
        meant for your eyes — easy to inspect, search, archive in Dropbox or iCloud. It is{' '}
        <em>not</em> directly importable as SQL; for a real DB-level backup, Supabase&apos;s
        Point-In-Time Recovery has you covered. Use this snapshot when you want a personal
        local copy before doing something risky (a merge campaign, a bulk archive…) so you
        can eyeball the before-state if something looks off.
      </div>
    </div>
  );
}
