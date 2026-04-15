'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

interface ChecklistItem {
  key: string; label: string; description: string;
  required_for: 'all' | 'ordinary' | 'simplified';
  done?: boolean; received_at?: string | null; notes?: string | null;
}

interface Registration {
  id: string; entity_id: string; entity_name: string; client_name: string | null;
  legal_form: string | null; address: string | null;
  status: string; regime_requested: string | null; frequency_requested: string | null;
  tax_office: string | null; triggered_by: string | null;
  expected_turnover: number | null; comments_field: string | null;
  filing_ref: string | null; filed_at: string | null;
  vat_received_at: string | null;
  issued_vat_number: string | null; issued_matricule: string | null;
  docs_checklist: string | ChecklistItem[]; notes: string | null;
  audit: { action: string; field: string | null; old_value: string | null; new_value: string | null; created_at: string }[];
}

const STATUS_FLOW = ['docs_requested', 'docs_received', 'form_prepared', 'filed', 'vat_received'] as const;

export default function RegistrationDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const [data, setData] = useState<Registration | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/registrations/${id}`);
    setData(await res.json());
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function patch(payload: Record<string, unknown>) {
    setSaving(true);
    try {
      await fetch(`/api/registrations/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSavedAt(new Date());
      await load();
    } finally { setSaving(false); }
  }

  if (!data) return <div className="text-center py-12 text-gray-500">Loading…</div>;

  const checklist: ChecklistItem[] = typeof data.docs_checklist === 'string'
    ? JSON.parse(data.docs_checklist || '[]')
    : (data.docs_checklist || []);
  const doneCount = checklist.filter(c => c.done).length;
  const totalCount = checklist.length;
  const allDocsDone = doneCount === totalCount && totalCount > 0;
  const currentStep = STATUS_FLOW.indexOf(data.status as typeof STATUS_FLOW[number]);

  function updateChecklistItem(key: string, patch: Partial<ChecklistItem>) {
    const next = checklist.map(c => c.key === key ? { ...c, ...patch } : c);
    void patchSilent({ docs_checklist: next });
  }
  async function patchSilent(payload: Record<string, unknown>) {
    await fetch(`/api/registrations/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await load();
  }

  return (
    <div>
      <div className="mb-5">
        <div className="text-[11px] text-gray-400 mb-1">
          <Link href="/registrations" className="hover:underline">Registrations</Link> ›
        </div>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">{data.entity_name}</h1>
            <div className="text-[12px] text-gray-500 mt-1">
              Registration · <span className="capitalize">{data.regime_requested}</span>
              {data.frequency_requested && <> · <span className="capitalize">{data.frequency_requested}</span></>}
              {data.tax_office && <> · {data.tax_office}</>}
            </div>
          </div>
          <span className="text-[10px] text-gray-400">{saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        </div>
      </div>

      {/* Status pipeline */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <div className="grid grid-cols-5 gap-3">
          {STATUS_FLOW.map((s, i) => (
            <PipelineStep
              key={s}
              label={s.replace('_', ' ')}
              done={i < currentStep || (i === currentStep && data.status === 'vat_received')}
              active={i === currentStep && data.status !== 'vat_received'}
              available={i <= currentStep + 1}
              onClick={() => i !== currentStep && patch({ status: s })}
            />
          ))}
        </div>
      </div>

      {/* Checklist */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-gray-900">
            Document checklist <span className="text-gray-400 font-normal ml-1">({doneCount}/{totalCount})</span>
          </h3>
          {allDocsDone && data.status === 'docs_requested' && (
            <button
              onClick={() => patch({ status: 'docs_received' })}
              className="h-7 px-2.5 rounded bg-emerald-600 text-white text-[11px] font-semibold hover:bg-emerald-700 cursor-pointer transition-all duration-150"
            >
              Mark all docs received
            </button>
          )}
        </div>
        <div className="space-y-2">
          {checklist.length === 0 && <div className="text-[12px] text-gray-400">No checklist defined.</div>}
          {checklist.map(item => (
            <div key={item.key} className={`flex items-start gap-3 p-2.5 rounded border ${item.done ? 'bg-emerald-50/40 border-emerald-200' : 'border-gray-200'}`}>
              <input
                type="checkbox"
                checked={!!item.done}
                onChange={e => updateChecklistItem(item.key, {
                  done: e.target.checked,
                  received_at: e.target.checked ? new Date().toISOString().slice(0, 10) : null,
                })}
                className="mt-0.5 w-4 h-4 cursor-pointer"
              />
              <div className="flex-1">
                <div className="text-[12.5px] font-medium text-gray-900">
                  {item.label}
                  {item.required_for !== 'all' && (
                    <span className="ml-2 text-[10px] text-gray-400 font-normal">({item.required_for} only)</span>
                  )}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">{item.description}</div>
                {item.done && item.received_at && (
                  <div className="text-[10px] text-emerald-700 mt-0.5">Received {item.received_at}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Form preparation + filing details */}
      <div className="grid grid-cols-2 gap-4 mb-5">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Filing details</h3>
          <div className="space-y-3">
            <FieldRow label="Filing reference">
              <input
                defaultValue={data.filing_ref || ''}
                onBlur={e => patch({ filing_ref: e.target.value || null })}
                placeholder="MyGuichet reference number"
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              />
            </FieldRow>
            <FieldRow label="Filed on">
              <input
                type="date"
                defaultValue={(data.filed_at || '').slice(0, 10)}
                onBlur={e => patch({ filed_at: e.target.value || null })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              />
            </FieldRow>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">AED issuance</h3>
          <p className="text-[11px] text-gray-500 mb-3">
            Once the AED letter arrives, record the issued matricule and VAT number here. Marking the registration as &quot;vat received&quot; will sync these onto the entity automatically.
          </p>
          <div className="space-y-3">
            <FieldRow label="Matricule">
              <input
                defaultValue={data.issued_matricule || ''}
                onBlur={e => patch({ issued_matricule: e.target.value || null })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] font-mono focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              />
            </FieldRow>
            <FieldRow label="VAT number (LUxxxxxxxx)">
              <input
                defaultValue={data.issued_vat_number || ''}
                onBlur={e => patch({ issued_vat_number: e.target.value || null })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] font-mono focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              />
            </FieldRow>
            <FieldRow label="Received on">
              <input
                type="date"
                defaultValue={(data.vat_received_at || '').slice(0, 10)}
                onBlur={e => patch({ vat_received_at: e.target.value || null })}
                className="w-full border border-gray-300 rounded px-2 py-1.5 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
              />
            </FieldRow>
          </div>
        </div>
      </div>

      {/* Comments field */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-2">Section 31 — Comments to AED form</h3>
        <p className="text-[11px] text-gray-500 mb-2">
          For simplified regime: invoke <strong>Circular 723 (29 December 2006)</strong>, state no output VAT, request simplified regime.
        </p>
        <textarea
          defaultValue={data.comments_field || ''}
          onBlur={e => patch({ comments_field: e.target.value || null })}
          rows={4}
          className="w-full border border-gray-300 rounded px-3 py-2 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
        />
      </div>

      {/* Internal notes */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-5">
        <h3 className="text-[13px] font-semibold text-gray-900 mb-2">Internal notes</h3>
        <textarea
          defaultValue={data.notes || ''}
          onBlur={e => patch({ notes: e.target.value || null })}
          rows={3}
          placeholder="Engagement context, special arrangements, reminders…"
          className="w-full border border-gray-300 rounded px-3 py-2 text-[12px] focus:border-[#1a1a2e] focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
        />
      </div>

      {/* Audit */}
      {data.audit.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <h3 className="text-[13px] font-semibold text-gray-900 mb-3">Activity</h3>
          <div className="space-y-1">
            {data.audit.map((a, i) => (
              <div key={i} className="text-[11px] flex items-center gap-2">
                <span className="text-gray-400 w-32">{new Date(a.created_at).toLocaleString('en-GB')}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{a.action}</span>
                <span className="text-gray-500">{a.field}: {a.old_value || '—'} → {a.new_value || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PipelineStep({ label, done, active, available, onClick }: {
  label: string; done: boolean; active: boolean; available: boolean; onClick: () => void;
}) {
  const base = 'rounded-md border p-2 text-center transition-all duration-150';
  const cls = done
    ? `${base} bg-emerald-50 border-emerald-200`
    : active
      ? `${base} bg-[#1a1a2e] border-[#1a1a2e] text-white`
      : `${base} bg-white border-gray-200 ${available ? 'hover:border-gray-300 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`;
  return (
    <button
      onClick={available ? onClick : undefined}
      disabled={!available}
      className={cls}
    >
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${done ? 'text-emerald-700' : active ? 'text-white' : 'text-gray-700'}`}>
        {label}
      </div>
      {done && <div className="text-[16px] mt-0.5 text-emerald-600">✓</div>}
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
