'use client';

import { useEffect, useState } from 'react';
import NextLink from 'next/link';
import { UsersIcon, MessageCircleIcon, ActivityIcon, ShieldCheckIcon, ArchiveIcon } from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface SystemStatus {
  storage: string;
  database: string;
  anthropic_configured: boolean;
  supabase_configured: boolean;
  auth_configured: boolean;
  db_time?: string;
  stats?: {
    entities: number; declarations: number; documents: number;
    invoices: number; lines: number; precedents: number;
    aed_letters: number; audit_events: number;
  };
}

export default function SettingsPage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    fetch('/api/system').then(r => r.json()).then(setStatus);
  }, []);

  if (!status) return <PageSkeleton />;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold tracking-tight">Settings &amp; system</h1>
        <p className="text-sm text-ink-muted mt-1">
          Configuration status and stored data overview.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* System status */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-ink mb-3">System status</h3>
          <div className="space-y-2">
            <Row label="Database" value={status.database} ok={status.database === 'ok'} />
            <Row label="Storage" value={status.storage} ok={status.storage === 'ok'} />
            <Row label="Authentication" value={status.auth_configured ? 'Configured' : 'Missing'} ok={status.auth_configured} />
            <Row label="Anthropic API key" value={status.anthropic_configured ? 'Configured' : 'Missing'} ok={status.anthropic_configured} />
            <Row label="Supabase storage key" value={status.supabase_configured ? 'Configured' : 'Missing'} ok={status.supabase_configured} />
            {status.db_time && <Row label="Server time" value={new Date(status.db_time).toLocaleString('en-GB')} ok />}
          </div>
        </div>

        {/* Stats */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-ink mb-3">Data overview</h3>
          {!status.stats ? (
            <div className="text-sm text-ink-faint">Stats unavailable.</div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <StatRow label="Entities" value={status.stats.entities} />
              <StatRow label="Declarations" value={status.stats.declarations} />
              <StatRow label="Documents" value={status.stats.documents} />
              <StatRow label="Invoices" value={status.stats.invoices} />
              <StatRow label="Invoice lines" value={status.stats.lines} />
              <StatRow label="Precedents" value={status.stats.precedents} />
              <StatRow label="AED letters" value={status.stats.aed_letters} />
              <StatRow label="Audit events" value={status.stats.audit_events} />
            </div>
          )}
        </div>
      </div>

      {/* Sub-pages */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <NextLink
          href="/settings/users"
          className="block bg-surface border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-sm transition-all group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
              <UsersIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-ink">Users &amp; AI caps →</h3>
              <p className="text-sm text-ink-soft mt-1">
                Per-user monthly AI-spend caps. Add / deactivate users, toggle admin.
              </p>
            </div>
          </div>
        </NextLink>

        <NextLink
          href="/settings/feedback"
          className="block bg-surface border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-sm transition-all group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
              <MessageCircleIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-ink">Feedback triage →</h3>
              <p className="text-sm text-ink-soft mt-1">
                In-product reports from the floating button.
              </p>
            </div>
          </div>
        </NextLink>

        <NextLink
          href="/settings/logs"
          className="block bg-surface border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-sm transition-all group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
              <ActivityIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-ink">Application logs →</h3>
              <p className="text-sm text-ink-soft mt-1">
                Recent error + warning records from the structured logger.
              </p>
            </div>
          </div>
        </NextLink>

        <NextLink
          href="/settings/classifier"
          className="block bg-surface border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-sm transition-all group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
              <ShieldCheckIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-ink">Classifier accuracy →</h3>
              <p className="text-sm text-ink-soft mt-1">
                Live pass-rate against the 60-fixture synthetic corpus. The brain&rsquo;s health check.
              </p>
            </div>
          </div>
        </NextLink>

        <NextLink
          href="/settings/trash"
          className="block bg-surface border border-border rounded-lg p-4 hover:border-border-strong hover:shadow-sm transition-all group"
        >
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-brand-50 text-brand-700 inline-flex items-center justify-center shrink-0 group-hover:bg-brand-100 transition-colors">
              <ArchiveIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-ink">Trash →</h3>
              <p className="text-sm text-ink-soft mt-1">
                Soft-archived clients + entities. Restore with one click.
              </p>
            </div>
          </div>
        </NextLink>
      </div>

      {/* Authentication */}
      <div className="bg-surface border border-border rounded-lg p-4 mb-5">
        <h3 className="text-sm font-semibold text-ink mb-3">Authentication</h3>
        <p className="text-sm text-ink-soft mb-3">
          Users are configured via the <code className="text-xs bg-surface-alt px-1 rounded">AUTH_USERS</code> environment variable
          (CSV of <code className="text-xs bg-surface-alt px-1 rounded">username:role</code> pairs) plus one
          <code className="text-xs bg-surface-alt px-1 rounded mx-1">AUTH_PASS_&lt;USERNAME&gt;</code> variable per user.
          To change a password, update the matching <code className="text-xs bg-surface-alt px-1 rounded">AUTH_PASS_*</code> variable in <strong>Vercel → Project Settings → Environment Variables</strong> and redeploy.
        </p>
        <p className="text-sm text-ink-soft">
          Sessions last 30 days from the moment you log in. To invalidate all existing sessions, regenerate
          <code className="text-xs bg-surface-alt px-1 rounded mx-1">AUTH_SECRET</code> as well.
        </p>
      </div>

      {/* Data export */}
      <div className="bg-surface border border-border rounded-lg p-4 mb-5">
        <h3 className="text-sm font-semibold text-ink mb-3">Data export &amp; backup</h3>
        <p className="text-sm text-ink-soft mb-3">
          All data is stored in your Supabase project (Frankfurt, EU). You can take a full backup at any time
          from the Supabase dashboard:
        </p>
        <ul className="text-sm text-ink-soft space-y-1 list-disc pl-5 mb-3">
          <li>Database: Supabase → Database → Backups (automatic daily, 7-day retention on free tier)</li>
          <li>Storage: Supabase → Storage → bucket &quot;documents&quot; (download via API or CLI)</li>
        </ul>
        <a
          href="https://supabase.com/dashboard"
          target="_blank" rel="noreferrer"
          className="text-sm text-brand-600 hover:underline font-medium"
        >
          Open Supabase dashboard ↗
        </a>
      </div>

      {/* Useful links */}
      <div className="bg-surface border border-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-ink mb-3">Useful links</h3>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Link href="https://console.anthropic.com/settings/keys" label="Anthropic API keys" />
          <Link href="https://console.anthropic.com/settings/usage" label="Anthropic usage / billing" />
          <Link href="https://supabase.com/dashboard" label="Supabase dashboard" />
          <Link href="https://vercel.com/dashboard" label="Vercel dashboard" />
          <Link href="https://ecdf.b2g.etat.lu" label="AED eCDF portal" />
          <Link href="https://www.guichet.public.lu" label="Guichet.lu" />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-ink-soft">{label}</span>
      <span className={`font-mono text-xs ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
        {ok ? '● ' : '○ '}{value}
      </span>
    </div>
  );
}
function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-sm py-1">
      <span className="text-ink-soft">{label}</span>
      <span className="font-semibold tabular-nums text-ink">{value.toLocaleString()}</span>
    </div>
  );
}
function Link({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="border border-border rounded px-3 py-2 hover:bg-surface-alt hover:border-border-strong transition-colors duration-150 text-ink-soft hover:text-brand-600 cursor-pointer">
      {label} ↗
    </a>
  );
}
