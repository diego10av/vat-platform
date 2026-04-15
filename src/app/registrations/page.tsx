'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Registration {
  id: string; entity_id: string; entity_name: string;
  status: string; regime_requested: string | null;
  frequency_requested: string | null; tax_office: string | null;
  filed_at: string | null; vat_received_at: string | null;
  issued_vat_number: string | null; created_at: string;
}

interface Entity { id: string; name: string }

export default function RegistrationsPage() {
  const [regs, setRegs] = useState<Registration[]>([]);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    entity_id: '', regime_requested: 'simplified', frequency_requested: 'annual',
    tax_office: '', triggered_by: 'incorporation', expected_turnover: '',
    comments_field: '', notes: '',
  });
  const router = useRouter();

  function load() {
    fetch('/api/registrations').then(r => r.json()).then(setRegs);
  }
  useEffect(() => {
    load();
    fetch('/api/entities').then(r => r.json()).then(setEntities);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch('/api/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        expected_turnover: form.expected_turnover ? Number(form.expected_turnover) : null,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      router.push(`/registrations/${d.id}`);
    }
  }

  const open = regs.filter(r => r.status !== 'vat_received').length;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">VAT registrations</h1>
          <p className="text-[12px] text-gray-500 mt-1">
            Service Line B — register new entities with the AED. Tracks document collection, form filing, and VAT-number issuance.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          className="h-8 px-3 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer"
        >
          {showForm ? 'Cancel' : '+ New registration'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <KPI label="Total" value={regs.length} />
        <KPI label="In progress" value={open} color={open > 0 ? 'text-orange-600' : 'text-gray-400'} />
        <KPI label="Completed" value={regs.length - open} color="text-emerald-600" />
      </div>

      {showForm && (
        <form onSubmit={create} className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
          <h3 className="text-[13px] font-semibold mb-3">New registration</h3>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Entity *">
              <select required value={form.entity_id}
                onChange={e => setForm({ ...form, entity_id: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]">
                <option value="">Select entity…</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
            <Field label="Regime requested *">
              <select value={form.regime_requested}
                onChange={e => setForm({ ...form, regime_requested: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]">
                <option value="simplified">Simplified (assujetti simplifié)</option>
                <option value="ordinary">Ordinary (assujetti normal)</option>
              </select>
            </Field>
            <Field label="Frequency">
              <select value={form.frequency_requested}
                onChange={e => setForm({ ...form, frequency_requested: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]">
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </select>
            </Field>
            <Field label="Triggered by">
              <select value={form.triggered_by}
                onChange={e => setForm({ ...form, triggered_by: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]">
                <option value="incorporation">Incorporation</option>
                <option value="activity_start">Activity start</option>
                <option value="client_request">Client request</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Tax office">
              <input value={form.tax_office}
                onChange={e => setForm({ ...form, tax_office: e.target.value })}
                placeholder="e.g. Luxembourg 3"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
            <Field label="Expected turnover (EUR)">
              <input type="number" value={form.expected_turnover}
                onChange={e => setForm({ ...form, expected_turnover: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
          </div>
          <Field label="Comments (Section 31 of AED form)">
            <textarea value={form.comments_field}
              onChange={e => setForm({ ...form, comments_field: e.target.value })}
              rows={2}
              placeholder="For simplified: invoke Circular 723 (29 December 2006), state no output VAT, request simplified regime."
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
          </Field>
          <button type="submit" className="mt-3 h-9 px-4 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer">
            Create registration
          </button>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {regs.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-gray-400">No registrations yet.</div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Entity</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Regime</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Frequency</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Status</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">VAT issued</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {regs.map(r => (
                <tr key={r.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors duration-150">
                  <td className="px-3 py-2 font-medium text-gray-900">{r.entity_name}</td>
                  <td className="px-3 py-2 text-gray-700 capitalize">{r.regime_requested || '—'}</td>
                  <td className="px-3 py-2 text-gray-700 capitalize">{r.frequency_requested || '—'}</td>
                  <td className="px-3 py-2"><RegStatusPill status={r.status} /></td>
                  <td className="px-3 py-2 font-mono text-gray-700">{r.issued_vat_number || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/registrations/${r.id}`} className="text-blue-600 hover:underline text-[11px] font-medium">Open</Link>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
function KPI({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color || 'text-gray-900'}`}>{value}</div>
    </div>
  );
}
function RegStatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    docs_requested: 'bg-gray-100 text-gray-700',
    docs_received: 'bg-blue-100 text-blue-700',
    form_prepared: 'bg-purple-100 text-purple-700',
    filed: 'bg-emerald-100 text-emerald-800',
    vat_received: 'bg-teal-100 text-teal-800',
  };
  return <span className={`text-[10px] px-2 py-0.5 rounded font-semibold uppercase tracking-wide ${colors[status] || 'bg-gray-100'}`}>{status.replace('_', ' ')}</span>;
}
