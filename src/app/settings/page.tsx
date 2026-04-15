'use client';

import { useEffect, useState } from 'react';

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

  if (!status) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-semibold tracking-tight">Settings &amp; system</h1>
        <p className="text-[12px] text-gray-500 mt-1">
          Configuration status and stored data overview.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* System status */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">System status</h3>
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
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Data overview</h3>
          {!status.stats ? (
            <div className="text-[12px] text-gray-400">Stats unavailable.</div>
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

      {/* Authentication */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Authentication</h3>
        <p className="text-[12px] text-gray-600 mb-3">
          The login password is set as the <code className="text-[11px] bg-gray-100 px-1 rounded">AUTH_PASSWORD</code> environment variable in Vercel.
          To change it, update the variable in <strong>Vercel → Project Settings → Environment Variables</strong> and redeploy.
        </p>
        <p className="text-[12px] text-gray-600">
          Sessions last 30 days from the moment you log in. To invalidate all existing sessions, regenerate
          <code className="text-[11px] bg-gray-100 px-1 rounded mx-1">AUTH_SECRET</code> as well.
        </p>
      </div>

      {/* Data export */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Data export &amp; backup</h3>
        <p className="text-[12px] text-gray-600 mb-3">
          All data is stored in your Supabase project (Frankfurt, EU). You can take a full backup at any time
          from the Supabase dashboard:
        </p>
        <ul className="text-[12px] text-gray-600 space-y-1 list-disc pl-5 mb-3">
          <li>Database: Supabase → Database → Backups (automatic daily, 7-day retention on free tier)</li>
          <li>Storage: Supabase → Storage → bucket &quot;documents&quot; (download via API or CLI)</li>
        </ul>
        <a
          href="https://supabase.com/dashboard"
          target="_blank" rel="noreferrer"
          className="text-[12px] text-blue-600 hover:underline font-medium"
        >
          Open Supabase dashboard ↗
        </a>
      </div>

      {/* Useful links */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Useful links</h3>
        <div className="grid grid-cols-2 gap-2 text-[12px]">
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
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-gray-700">{label}</span>
      <span className={`font-mono text-[11px] ${ok ? 'text-emerald-700' : 'text-red-700'}`}>
        {ok ? '● ' : '○ '}{value}
      </span>
    </div>
  );
}
function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between text-[12px] py-1">
      <span className="text-gray-600">{label}</span>
      <span className="font-semibold tabular-nums text-gray-900">{value.toLocaleString()}</span>
    </div>
  );
}
function Link({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="border border-gray-200 rounded px-3 py-2 hover:bg-gray-50 hover:border-gray-300 transition-colors duration-150 text-gray-700 hover:text-[#1a1a2e] cursor-pointer">
      {label} ↗
    </a>
  );
}
