'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface TimelineData {
  entity: {
    id: string; name: string; client_name: string | null; vat_number: string | null;
    matricule: string | null; regime: string; frequency: string; address: string | null;
    has_fx: boolean; has_outgoing: boolean; has_recharges: boolean;
    notes: string | null;
  };
  declarations: Array<{
    id: string; year: number; period: string; status: string;
    filing_ref: string | null; filed_at: string | null; payment_confirmed_at: string | null;
    line_count: number; total_ex_vat: number; vat_payable: number;
  }>;
  top_providers: Array<{ provider: string; total: number; invoice_count: number }>;
  precedents: Array<{ id: string; provider: string; country: string | null; treatment: string; last_amount: number | null; last_used: string | null; times_used: number }>;
  aed_letters: Array<{ id: string; filename: string; type: string | null; urgency: string | null; status: string; summary: string | null; deadline_date: string | null; uploaded_at: string }>;
  recent_audit: Array<{ id: string; action: string; target_type: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string; year: number | null; period: string | null }>;
}

export default function EntityDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<TimelineData | null>(null);

  useEffect(() => {
    fetch(`/api/entities/${id}/timeline`).then(r => r.json()).then(setData);
  }, [id]);

  if (!data) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  const e = data.entity;
  const totalLifetime = data.declarations.reduce((s, d) => s + Number(d.vat_payable || 0), 0);

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] text-gray-400 mb-1">
          <Link href="/entities" className="hover:underline">Entities</Link> ›
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{e.name}</h1>
            <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
              {e.client_name && <span>{e.client_name}</span>}
              {e.client_name && <span className="text-gray-300">·</span>}
              <span className="capitalize">{e.regime}</span>
              <span className="text-gray-300">·</span>
              <span className="capitalize">{e.frequency}</span>
              {e.vat_number && <><span className="text-gray-300">·</span><span>{e.vat_number}</span></>}
            </div>
          </div>
          <Link
            href={`/declarations?entity_id=${id}`}
            className="h-8 px-3 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 inline-flex items-center cursor-pointer"
          >
            All declarations
          </Link>
        </div>
      </div>

      <NotesCard
        kind="entity"
        id={id}
        initial={e.notes}
        title="Internal notes"
        helper="These notes are internal — never sent to the client. Use them for engagement context, recurring quirks of this entity, or reminders."
      />

      <div className="grid grid-cols-4 gap-3 mb-5">
        <KPI label="Declarations" value={data.declarations.length} />
        <KPI label="Lifetime VAT paid" value={`€${fmtEUR(totalLifetime)}`} small />
        <KPI label="Recurring providers" value={data.top_providers.length} />
        <KPI label="AED letters" value={data.aed_letters.length} />
      </div>

      <div className="grid grid-cols-3 gap-4 mb-5">
        {/* Declarations history */}
        <div className="col-span-2 bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <h3 className="text-[13px] font-semibold text-gray-900">Declarations history</h3>
          </div>
          {data.declarations.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-gray-400">No declarations for this entity yet.</div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Period</th>
                  <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Status</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-[10px]">Lines</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-[10px]">Total ex.VAT</th>
                  <th className="px-3 py-2 text-right font-medium uppercase tracking-wide text-[10px]">VAT due</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.declarations.map(d => (
                  <tr key={d.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors duration-150">
                    <td className="px-3 py-2 font-medium text-gray-900">{d.year} {d.period}</td>
                    <td className="px-3 py-2"><StatusPill status={d.status} /></td>
                    <td className="px-3 py-2 text-right text-gray-700 tabular-nums">{d.line_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">€{fmtEUR(d.total_ex_vat)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">€{fmtEUR(d.vat_payable)}</td>
                    <td className="px-3 py-2 text-right">
                      <Link href={`/declarations/${d.id}`} className="text-blue-600 hover:underline text-[11px] font-medium">Open</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top providers */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <h3 className="text-[13px] font-semibold text-gray-900">Top providers (lifetime)</h3>
          </div>
          {data.top_providers.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-gray-400">No invoices yet.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {data.top_providers.map(p => (
                <div key={p.provider} className="px-3 py-2 flex items-center justify-between text-[12px]">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900">{p.provider}</div>
                    <div className="text-[10px] text-gray-400">{p.invoice_count} invoice{p.invoice_count === 1 ? '' : 's'}</div>
                  </div>
                  <div className="font-mono tabular-nums text-gray-700 ml-2">€{fmtEUR(p.total)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Precedents + AED letters */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50">
            <h3 className="text-[13px] font-semibold text-gray-900">Precedents ({data.precedents.length})</h3>
          </div>
          {data.precedents.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-gray-400">No precedents yet. They appear after the first approved declaration.</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
              {data.precedents.map(p => (
                <div key={p.id} className="px-3 py-2 flex items-center justify-between text-[11.5px]">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-gray-900">{p.provider}</div>
                    <div className="text-[10px] text-gray-500">{p.country || '—'} · used {p.times_used}× · last {p.last_used}</div>
                  </div>
                  <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-blue-100 text-blue-800 border border-blue-200">{p.treatment}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-gray-900">AED letters</h3>
            <Link href={`/aed-letters`} className="text-[11px] text-blue-600 hover:underline">All letters</Link>
          </div>
          {data.aed_letters.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-gray-400">No letters for this entity.</div>
          ) : (
            <div className="max-h-[300px] overflow-y-auto divide-y divide-gray-100">
              {data.aed_letters.map(l => (
                <div key={l.id} className="px-3 py-2 text-[11.5px]">
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-gray-900 truncate">{l.type || l.filename}</div>
                    <span className="text-[10px] text-gray-400 ml-2 shrink-0">{formatDate(l.uploaded_at)}</span>
                  </div>
                  {l.summary && <div className="text-[11px] text-gray-600 mt-0.5 line-clamp-2">{l.summary}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent audit */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-gray-900">Recent activity</h3>
          <Link href={`/audit?entity_id=${id}`} className="text-[11px] text-blue-600 hover:underline">Full audit log →</Link>
        </div>
        {data.recent_audit.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-gray-400">No activity yet.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {data.recent_audit.slice(0, 10).map(r => (
              <div key={r.id} className="px-3 py-2 text-[11.5px] flex items-center gap-3">
                <span className="text-[10px] text-gray-400 w-32 shrink-0">{formatDateTime(r.created_at)}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{r.action}</span>
                <span className="text-gray-700 font-mono text-[10px]">{r.target_type}</span>
                <span className="text-gray-500 truncate flex-1">
                  {r.field ? `${r.field}: ` : ''}{r.new_value || ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Reusable notes card. POSTs to the relevant entity/declaration endpoint.
function NotesCard({
  kind, id, initial, title, helper,
}: {
  kind: 'entity' | 'declaration';
  id: string;
  initial: string | null;
  title: string;
  helper?: string;
}) {
  const [notes, setNotes] = useState(initial || '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Debounced auto-save 800ms after typing stops
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(async () => {
      setSaving(true);
      try {
        const url = kind === 'entity' ? `/api/entities/${id}` : `/api/declarations/${id}`;
        const method = kind === 'entity' ? 'PUT' : 'PATCH';
        await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        setSavedAt(new Date());
        setDirty(false);
      } finally {
        setSaving(false);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [notes, dirty, kind, id]);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
        <span className="text-[10px] text-gray-400">
          {saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
      </div>
      {helper && <p className="text-[11px] text-gray-500 mb-2">{helper}</p>}
      <textarea
        value={notes}
        onChange={e => { setNotes(e.target.value); setDirty(true); }}
        rows={3}
        placeholder="Add a note…"
        className="w-full border border-gray-300 rounded px-3 py-2 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
      />
    </div>
  );
}

function KPI({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`font-bold mt-1 tabular-nums text-gray-900 ${small ? 'text-base' : 'text-2xl'}`}>{value}</div>
    </div>
  );
}
function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    created: 'bg-gray-100 text-gray-700',
    uploading: 'bg-blue-100 text-blue-700',
    extracting: 'bg-purple-100 text-purple-700',
    classifying: 'bg-yellow-100 text-yellow-700',
    review: 'bg-orange-100 text-orange-700',
    approved: 'bg-green-100 text-green-700',
    filed: 'bg-emerald-100 text-emerald-800',
    paid: 'bg-teal-100 text-teal-800',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${colors[status] || 'bg-gray-100'}`}>{status}</span>;
}
function fmtEUR(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  const v = Number(n);
  if (isNaN(v)) return '—';
  return v.toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB');
}
function formatDateTime(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
