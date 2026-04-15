'use client';

import { useEffect, useState } from 'react';
import { TREATMENT_CODES, type TreatmentCode } from '@/config/treatment-codes';

interface Override {
  id: string;
  rule_changed: string;
  new_treatment: string;
  legal_basis: string;
  effective_date: string;
  provider_match: string | null;
  description_match: string | null;
  justification: string | null;
  created_by: string | null;
  created_at: string;
}

const ALL_TREATMENTS = Object.keys(TREATMENT_CODES) as TreatmentCode[];

export default function LegalOverridesPage() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Override | null>(null);
  const [form, setForm] = useState({
    rule_changed: '', new_treatment: 'EXEMPT_44', legal_basis: '',
    effective_date: new Date().toISOString().slice(0, 10),
    provider_match: '', description_match: '', justification: '',
  });

  function load() {
    fetch('/api/legal-overrides').then(r => r.json()).then(setOverrides);
  }
  useEffect(() => { load(); }, []);

  function startCreate() {
    setEditing(null);
    setForm({
      rule_changed: '', new_treatment: 'EXEMPT_44', legal_basis: '',
      effective_date: new Date().toISOString().slice(0, 10),
      provider_match: '', description_match: '', justification: '',
    });
    setShowForm(true);
  }
  function startEdit(o: Override) {
    setEditing(o);
    setForm({
      rule_changed: o.rule_changed,
      new_treatment: o.new_treatment,
      legal_basis: o.legal_basis,
      effective_date: o.effective_date,
      provider_match: o.provider_match || '',
      description_match: o.description_match || '',
      justification: o.justification || '',
    });
    setShowForm(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const url = editing ? `/api/legal-overrides/${editing.id}` : '/api/legal-overrides';
    const method = editing ? 'PATCH' : 'POST';
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    setShowForm(false);
    setEditing(null);
    load();
  }
  async function remove(id: string) {
    if (!confirm('Delete this legal override? This affects how invoices are classified.')) return;
    await fetch(`/api/legal-overrides/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight">Legal overrides</h1>
          <p className="text-[12px] text-gray-500 mt-1">
            Jurisprudence and AED circulars that change how specific invoices are classified.
            Overrides take precedence over precedents and inference, but yield to direct evidence (RULES 1-9).
          </p>
        </div>
        <button
          onClick={startCreate}
          className="h-8 px-3 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer"
        >
          + New override
        </button>
      </div>

      {showForm && (
        <form onSubmit={save} className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
          <h3 className="text-[13px] font-semibold mb-3">{editing ? 'Edit override' : 'New legal override'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Rule / position changed *">
              <input required value={form.rule_changed}
                onChange={e => setForm({ ...form, rule_changed: e.target.value })}
                placeholder="e.g. EU intermediation services"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
            <Field label="New treatment *">
              <select value={form.new_treatment}
                onChange={e => setForm({ ...form, new_treatment: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]">
                {ALL_TREATMENTS.map(t => (
                  <option key={t} value={t}>{t} — {TREATMENT_CODES[t].label}</option>
                ))}
              </select>
            </Field>
            <Field label="Legal basis * (case ref / circular)">
              <input required value={form.legal_basis}
                onChange={e => setForm({ ...form, legal_basis: e.target.value })}
                placeholder="e.g. CJEU T-657/24, 26 November 2025"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
            <Field label="Effective date *">
              <input required type="date" value={form.effective_date}
                onChange={e => setForm({ ...form, effective_date: e.target.value })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
            <Field label="Provider match (substring)">
              <input value={form.provider_match}
                onChange={e => setForm({ ...form, provider_match: e.target.value })}
                placeholder='e.g. "Acme Intermediary GmbH" or leave blank'
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
            <Field label="Description match (substring)">
              <input value={form.description_match}
                onChange={e => setForm({ ...form, description_match: e.target.value })}
                placeholder='e.g. "intermediation" or "referral"'
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
            </Field>
          </div>
          <Field label="Justification">
            <textarea value={form.justification}
              onChange={e => setForm({ ...form, justification: e.target.value })}
              rows={3}
              placeholder="Explain the reasoning, audit-risk caveats, and any prior-year-amendment recommendations."
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]" />
          </Field>
          <p className="text-[11px] text-gray-500 mt-2">
            At least one of <strong>provider match</strong> or <strong>description match</strong> is required, otherwise the override would apply to every invoice.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="submit"
              className="h-9 px-4 rounded bg-[#1a1a2e] text-white text-[12px] font-semibold hover:bg-[#2a2a4e] transition-all duration-150 cursor-pointer">
              {editing ? 'Save changes' : 'Create override'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); }}
              className="h-9 px-4 rounded border border-gray-300 text-[12px] font-medium text-gray-700 hover:bg-gray-50 cursor-pointer">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {overrides.length === 0 ? (
          <div className="p-8 text-center text-[12px] text-gray-400">
            No legal overrides defined. Use these for jurisprudence changes (e.g. CJEU rulings) or AED circulars
            that change the treatment for a specific class of invoices.
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Rule changed</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">New treatment</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Match</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Legal basis</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-[10px]">Effective</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {overrides.map(o => (
                <tr key={o.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60 transition-colors duration-150">
                  <td className="px-3 py-2 font-medium text-gray-900">{o.rule_changed}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] px-2 py-0.5 rounded font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {o.new_treatment}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-700 text-[11px]">
                    {o.provider_match && <div>provider: <span className="font-mono">{o.provider_match}</span></div>}
                    {o.description_match && <div>desc: <span className="font-mono">{o.description_match}</span></div>}
                    {!o.provider_match && !o.description_match && <span className="text-red-600">⚠ no match</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-700">{o.legal_basis}</td>
                  <td className="px-3 py-2 text-gray-700 tabular-nums">{o.effective_date}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(o)} className="text-blue-600 hover:underline text-[11px] font-medium cursor-pointer">Edit</button>
                    <span className="text-gray-300 mx-1">·</span>
                    <button onClick={() => remove(o.id)} className="text-red-600 hover:underline text-[11px] font-medium cursor-pointer">Delete</button>
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
