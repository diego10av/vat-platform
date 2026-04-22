'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { SearchIcon, PlusIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { ExportButton } from '@/components/crm/ExportButton';
import { INVOICE_FIELDS } from '@/components/crm/schemas';
import { useToast } from '@/components/Toaster';
import {
  LABELS_INVOICE_STATUS, INVOICE_STATUSES, formatEur, formatDate,
  type InvoiceStatus,
} from '@/lib/crm-types';

interface Invoice {
  id: string;
  invoice_number: string;
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  amount_excl_vat: number | string;
  vat_rate: number | null;
  vat_amount: number | string | null;
  amount_incl_vat: number | string;
  amount_paid: number | string;
  outstanding: number | string;
  status: string;
  payment_method: string | null;
  paid_date: string | null;
  client_name: string | null;
  client_id: string | null;
  matter_reference: string | null;
  matter_id: string | null;
}

interface Summary {
  total_excl_vat: string;
  total_vat: string;
  total_incl_vat: string;
  total_paid: string;
  total_outstanding: string;
}

const thisYear = new Date().getFullYear();

export default function BillingPage() {
  const [data, setData] = useState<{ invoices: Invoice[]; summary: Summary | null } | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('');
  const [year, setYear] = useState<string>(String(thisYear));
  const [newOpen, setNewOpen] = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (year) qs.set('year', year);
    fetch(`/api/crm/billing?${qs}`, { cache: 'no-store' })
      .then(r => r.json()).then(setData).catch(() => setData({ invoices: [], summary: null }));
  }, [q, status, year]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(values: Record<string, unknown>) {
    // Note: company_id is required by API. For stint 26 we don't yet
    // have a Company picker inside the form (needs an async-search
    // component). Short-term: instruct user to create an invoice from
    // within a Matter or Company detail page. Show friendly error if
    // they try from here.
    const res = await fetch('/api/crm/billing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.code ?? '';
      if (code === 'company_required') {
        throw new Error('To create an invoice from here, add company_id. For now, create invoices from the Matter detail page (upcoming stint adds company picker to this form).');
      }
      throw new Error(err?.error?.message ?? `Create failed (${res.status})`);
    }
    toast.success('Invoice created');
    await load();
  }

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return Array.from({ length: 6 }, (_, i) => String(current - i));
  }, []);

  if (data === null) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle={`${year || 'All years'} · ${data.invoices.length} invoices`}
        actions={
          <Button onClick={() => setNewOpen(true)} variant="primary" size="sm" icon={<PlusIcon size={13} />}>
            New invoice
          </Button>
        }
      />
      <CrmFormModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        mode="create"
        title="New invoice"
        subtitle="Issue a new invoice. Number auto-generates (MP-YYYY-NNNN). Company + matter pickers coming in Billing Pro."
        fields={INVOICE_FIELDS}
        initial={{
          status: 'draft',
          currency: 'EUR',
          vat_rate: 17,
          issue_date: new Date().toISOString().slice(0, 10),
        }}
        onSave={handleCreate}
      />

      {data.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <Kpi label="Invoiced (excl. VAT)" value={formatEur(data.summary.total_excl_vat)} />
          <Kpi label="VAT" value={formatEur(data.summary.total_vat)} />
          <Kpi label="Total (incl. VAT)" value={formatEur(data.summary.total_incl_vat)} />
          <Kpi label="Paid" value={formatEur(data.summary.total_paid)} tone="success" />
          <Kpi label="Outstanding" value={formatEur(data.summary.total_outstanding)} tone="warning" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px] max-w-xs">
          <SearchIcon size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search invoice number..."
            className="w-full pl-7 pr-3 py-1.5 text-[12.5px] border border-border rounded-md focus:outline-none focus:border-brand-500" />
        </div>
        <select value={year} onChange={e => setYear(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">All years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="px-2 py-1.5 text-[12.5px] border border-border rounded-md bg-white">
          <option value="">All statuses</option>
          {INVOICE_STATUSES.map(s => <option key={s} value={s}>{LABELS_INVOICE_STATUS[s]}</option>)}
        </select>
        <div className="ml-auto">
          <ExportButton entity="billing" extraParams={year ? { year } : undefined} />
        </div>
      </div>

      {data.invoices.length === 0 ? (
        <EmptyState illustration="stack" title="No invoices for this filter" description="Adjust filters or run the Notion import to populate." />
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-white">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt text-ink-muted">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Number</th>
                <th className="text-left px-3 py-2 font-medium">Client</th>
                <th className="text-left px-3 py-2 font-medium">Matter</th>
                <th className="text-left px-3 py-2 font-medium">Issue</th>
                <th className="text-left px-3 py-2 font-medium">Due</th>
                <th className="text-right px-3 py-2 font-medium">Excl. VAT</th>
                <th className="text-right px-3 py-2 font-medium">Incl. VAT</th>
                <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.invoices.map(r => (
                <tr key={r.id} className="border-t border-border hover:bg-surface-alt/50">
                  <td className="px-3 py-2 font-mono">
                    <Link href={`/crm/billing/${r.id}`} className="text-brand-700 hover:underline">{r.invoice_number}</Link>
                  </td>
                  <td className="px-3 py-2">
                    {r.client_id ? <Link href={`/crm/companies/${r.client_id}`} className="text-brand-700 hover:underline">{r.client_name}</Link> : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11.5px] text-ink-muted">
                    {r.matter_id ? <Link href={`/crm/matters/${r.matter_id}`} className="hover:underline">{r.matter_reference}</Link> : '—'}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.issue_date)}</td>
                  <td className="px-3 py-2 tabular-nums">{formatDate(r.due_date)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatEur(r.amount_excl_vat)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatEur(r.amount_incl_vat)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {Number(r.outstanding) > 0 ? <span className="text-amber-700">{formatEur(r.outstanding)}</span> : <span className="text-ink-muted">—</span>}
                  </td>
                  <td className="px-3 py-2">{LABELS_INVOICE_STATUS[r.status as InvoiceStatus] ?? r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warning' }) {
  const toneClass = tone === 'success' ? 'text-emerald-700' : tone === 'warning' ? 'text-amber-700' : 'text-ink';
  return (
    <div className="border border-border rounded-md bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
