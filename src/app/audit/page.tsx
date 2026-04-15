'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

interface AuditRow {
  id: string;
  user_id: string | null;
  entity_id: string | null;
  declaration_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  entity_name: string | null;
  year: number | null;
  period: string | null;
}

interface ActionCount { action: string; n: number }
interface AuditResponse {
  rows: AuditRow[];
  actions: string[];
  counts: ActionCount[];
}

export default function AuditPage() {
  return (
    <Suspense fallback={<div className="text-center py-12 text-gray-500">Loading…</div>}>
      <AuditContent />
    </Suspense>
  );
}

function AuditContent() {
  const sp = useSearchParams();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [actionFilter, setActionFilter] = useState<string>(sp.get('action') || '');
  const [entityFilter, setEntityFilter] = useState<string>(sp.get('entity_id') || '');
  const [declFilter, setDeclFilter] = useState<string>(sp.get('declaration_id') || '');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (actionFilter) params.set('action', actionFilter);
    if (entityFilter) params.set('entity_id', entityFilter);
    if (declFilter) params.set('declaration_id', declFilter);
    const res = await fetch(`/api/audit?${params.toString()}`);
    setData(await res.json());
  }, [actionFilter, entityFilter, declFilter]);

  useEffect(() => { load(); }, [load]);

  if (!data) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  // Client-side text search
  const visible = data.rows.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [r.entity_name, r.target_type, r.field, r.old_value, r.new_value, r.target_id]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(q));
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-semibold tracking-tight">Audit log</h1>
        <p className="text-[12px] text-gray-500 mt-1">
          Every create, update, delete, classification, approval, filing, and payment is recorded here for compliance.
        </p>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPI label="Total events" value={data.counts.reduce((s, c) => s + c.n, 0)} />
        {data.counts.slice(0, 3).map(c => (
          <KPI key={c.action} label={c.action} value={c.n} />
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Search</label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search target_type, field, value…"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">Action</label>
          <select
            value={actionFilter}
            onChange={e => setActionFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
          >
            <option value="">All actions</option>
            {data.actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        {(actionFilter || entityFilter || declFilter || search) && (
          <button
            onClick={() => { setActionFilter(''); setEntityFilter(''); setDeclFilter(''); setSearch(''); }}
            className="h-8 px-2.5 rounded border border-gray-300 text-[11px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-gray-400">No events match your filter.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Time</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Action</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Target</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Entity</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Period</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Field</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Change</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(r => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors duration-150">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                  <td className="px-3 py-2"><ActionPill action={r.action} /></td>
                  <td className="px-3 py-2 text-gray-700 font-mono text-[11px]">{r.target_type}</td>
                  <td className="px-3 py-2 text-gray-700">
                    {r.entity_name ? (
                      <Link href={`/entities`} className="hover:underline text-[#1a1a2e]">{r.entity_name}</Link>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">
                    {r.year && r.period ? (
                      <Link href={`/declarations/${r.declaration_id}`} className="hover:underline">
                        {r.year} {r.period}
                      </Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-[11px]">{r.field || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 max-w-md">
                    <ChangeView old={r.old_value} new_={r.new_value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ChangeView({ old: oldV, new_: newV }: { old: string | null; new_: string | null }) {
  if (!oldV && !newV) return <span className="text-gray-400">—</span>;
  if (!oldV) return <span className="text-emerald-700">+ {truncate(newV || '', 80)}</span>;
  if (!newV) return <span className="text-red-700 line-through">- {truncate(oldV, 80)}</span>;
  return (
    <span className="text-[11px]">
      <span className="text-red-700 line-through">{truncate(oldV, 40)}</span>
      <span className="text-gray-400 mx-1">→</span>
      <span className="text-emerald-700">{truncate(newV, 40)}</span>
    </span>
  );
}

function ActionPill({ action }: { action: string }) {
  const map: Record<string, string> = {
    create: 'bg-emerald-100 text-emerald-700',
    update: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700',
    approve: 'bg-green-100 text-green-700',
    file: 'bg-emerald-100 text-emerald-800',
    pay: 'bg-teal-100 text-teal-800',
    reopen: 'bg-orange-100 text-orange-700',
    classify: 'bg-purple-100 text-purple-700',
    extract: 'bg-yellow-100 text-yellow-700',
    triage: 'bg-pink-100 text-pink-700',
    restore: 'bg-blue-100 text-blue-700',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${map[action] || 'bg-gray-100'}`}>{action}</span>;
}

function KPI({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums text-gray-900">{value}</div>
    </div>
  );
}

function formatDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
