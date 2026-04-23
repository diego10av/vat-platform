'use client';

// ════════════════════════════════════════════════════════════════════════
// MatterTimeTracker — log + review time entries on a matter. Shows:
//   - "Log time" modal (date, hours, billable, description, rate-override)
//   - Entries table (date / hours / rate / billable / invoice / description)
//   - Rolling totals: total hours, unbilled hours, unbilled €
//   - Budget burn bar if matter has estimated_budget_eur
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/Toaster';
import { formatEur, formatDate } from '@/lib/crm-types';

interface TimeEntry {
  id: string;
  matter_id: string;
  user_id: string | null;
  entry_date: string;
  hours: string;
  rate_eur: string | null;
  billable: boolean;
  billed_on_invoice_id: string | null;
  description: string | null;
}

export function MatterTimeTracker({
  matterId, defaultRateEur, estimatedBudgetEur, capEur, billedSoFar,
}: {
  matterId: string;
  defaultRateEur: number | null;
  estimatedBudgetEur: number | null;
  capEur: number | null;
  billedSoFar: number;
}) {
  const toast = useToast();
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/crm/matters/${matterId}/time`, { cache: 'no-store' })
      .then(r => r.json()).then(setEntries).catch(() => setEntries([]));
  }, [matterId]);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this time entry? The audit log retains the record.')) return;
    const res = await fetch(`/api/crm/time/${id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Delete failed'); return; }
    toast.success('Time entry removed');
    load();
  }

  if (entries === null) {
    return <div className="text-[12px] text-ink-muted italic px-3 py-4">Loading time entries…</div>;
  }

  const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);
  const unbilledHours = entries.reduce((s, e) => s + (e.billable && !e.billed_on_invoice_id ? Number(e.hours) : 0), 0);
  const unbilledAmount = entries.reduce((s, e) => {
    if (!e.billable || e.billed_on_invoice_id) return s;
    const rate = e.rate_eur !== null ? Number(e.rate_eur) : (defaultRateEur ?? 0);
    return s + Number(e.hours) * rate;
  }, 0);

  // Budget burn.
  const totalScope = (billedSoFar + unbilledAmount);
  const budget = estimatedBudgetEur ?? null;
  const pctOfBudget = budget && budget > 0 ? (totalScope / budget) * 100 : null;
  const capApproaching = capEur && totalScope >= capEur * 0.9;

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-[12px] uppercase tracking-wide font-semibold text-ink-muted">
          Time + WIP ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
        </h3>
        <Button variant="primary" size="sm" icon={<PlusIcon size={12} />} onClick={() => setLogOpen(true)}>
          Log time
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <Kpi label="Total hours" value={`${totalHours.toFixed(1)}h`} />
        <Kpi label="Unbilled hours" value={`${unbilledHours.toFixed(1)}h`} tone={unbilledHours > 20 ? 'warning' : undefined} />
        <Kpi label="Unbilled €" value={formatEur(unbilledAmount)} tone={unbilledAmount > 0 ? 'warning' : undefined} />
        <Kpi label="Total scope" value={formatEur(totalScope)} />
      </div>

      {budget && pctOfBudget !== null && (
        <div className="mb-3 border border-border rounded-md bg-white p-3">
          <div className="flex items-baseline justify-between mb-1.5 text-[11.5px]">
            <span className="font-semibold text-ink">Budget burn</span>
            <span className={pctOfBudget >= 100 ? 'text-danger-700 font-semibold' : pctOfBudget >= 75 ? 'text-amber-700 font-semibold' : 'text-ink-muted'}>
              {formatEur(totalScope)} / {formatEur(budget)} ({pctOfBudget.toFixed(0)}%)
            </span>
          </div>
          <div className="h-2 bg-surface-alt rounded overflow-hidden">
            <div
              className={`h-full rounded ${pctOfBudget >= 100 ? 'bg-danger-500' : pctOfBudget >= 75 ? 'bg-amber-500' : 'bg-brand-500'}`}
              style={{ width: `${Math.min(100, pctOfBudget)}%` }}
            />
          </div>
          {pctOfBudget >= 75 && pctOfBudget < 100 && (
            <p className="mt-1.5 text-[10.5px] text-amber-700">⚠ Approaching budget. Consider a client check-in.</p>
          )}
          {pctOfBudget >= 100 && (
            <p className="mt-1.5 text-[10.5px] text-danger-700">⛔ Budget exceeded. Discuss scope change with client.</p>
          )}
          {capApproaching && (
            <p className="mt-1 text-[10.5px] text-danger-700">⛔ Cap (€{capEur!.toLocaleString()}) is within 10%. Client re-approval required before proceeding.</p>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-[12px] text-ink-muted italic px-3 py-4 border border-border rounded-md bg-white">
          No time logged yet. Click &ldquo;Log time&rdquo; to start tracking.
        </div>
      ) : (
        <div className="border border-border rounded-md bg-white overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-alt text-ink-muted">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium">Date</th>
                <th className="text-right px-3 py-1.5 font-medium">Hours</th>
                <th className="text-right px-3 py-1.5 font-medium">Rate</th>
                <th className="text-right px-3 py-1.5 font-medium">Amount</th>
                <th className="text-left px-3 py-1.5 font-medium">Billable</th>
                <th className="text-left px-3 py-1.5 font-medium">Billed?</th>
                <th className="text-left px-3 py-1.5 font-medium">Description</th>
                <th className="px-3 py-1.5"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => {
                const rate = e.rate_eur !== null ? Number(e.rate_eur) : (defaultRateEur ?? 0);
                const amount = Number(e.hours) * rate;
                return (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(e.entry_date)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Number(e.hours).toFixed(1)}h</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{rate > 0 ? `€${rate}/h` : '—'}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-medium">{amount > 0 ? formatEur(amount) : '—'}</td>
                    <td className="px-3 py-1.5">{e.billable ? '✓' : ''}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{e.billed_on_invoice_id ? '✓' : ''}</td>
                    <td className="px-3 py-1.5 text-ink-muted truncate max-w-[300px]" title={e.description ?? ''}>
                      {e.description ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => handleDelete(e.id)} className="text-danger-600 hover:text-danger-800" title="Delete entry">
                        <Trash2Icon size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {logOpen && (
        <LogTimeModal
          matterId={matterId}
          defaultRateEur={defaultRateEur}
          onClose={() => setLogOpen(false)}
          onSaved={() => { setLogOpen(false); load(); }}
        />
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'warning' }) {
  const toneClass = tone === 'warning' ? 'text-amber-700' : 'text-ink';
  return (
    <div className="border border-border rounded-md bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">{label}</div>
      <div className={`text-[15px] font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}

function LogTimeModal({
  matterId, defaultRateEur, onClose, onSaved,
}: {
  matterId: string;
  defaultRateEur: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState('');
  const [rate, setRate] = useState(defaultRateEur !== null ? String(defaultRateEur) : '');
  const [billable, setBillable] = useState(true);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) { toast.error('Hours must be > 0'); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/matters/${matterId}/time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_date: date, hours: h,
          rate_eur: rate ? Number(rate) : null,
          billable, description,
        }),
      });
      if (!res.ok) {
        toast.error('Log time failed');
        return;
      }
      toast.success(`${h}h logged`);
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <Modal
      open={true}
      onClose={saving ? () => {} : onClose}
      title="Log time"
      size="md"
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} disabled={saving} className="h-8 px-3 rounded-md border border-border text-[12.5px] text-ink-soft hover:bg-surface-alt disabled:opacity-40">Cancel</button>
          <Button variant="primary" size="sm" onClick={submit} loading={saving}>Log entry</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md" />
        </Field>
        <Field label="Hours">
          <input type="number" step="0.25" value={hours} onChange={e => setHours(e.target.value)} placeholder="1.5" className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md tabular-nums" />
        </Field>
        <Field label={`Rate (€/h, default ${defaultRateEur ?? '—'})`}>
          <input type="number" step="0.01" value={rate} onChange={e => setRate(e.target.value)} placeholder={defaultRateEur ? String(defaultRateEur) : '400'} className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md tabular-nums" />
        </Field>
        <Field label="Billable">
          <label className="inline-flex items-center gap-2 h-9 text-[13px]">
            <input type="checkbox" checked={billable} onChange={e => setBillable(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            <span className="text-ink-soft">Yes, count against the client&apos;s bill</span>
          </label>
        </Field>
        <div className="md:col-span-2">
          <Field label="Description">
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What did you work on?" className="w-full px-2.5 py-2 text-[13px] border border-border rounded-md resize-y" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
