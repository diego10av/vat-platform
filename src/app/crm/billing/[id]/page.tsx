'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PencilIcon, Trash2Icon, PlusIcon, DownloadIcon, MailIcon, UndoIcon, CheckCircle2Icon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/Toaster';
import { CrmFormModal } from '@/components/crm/CrmFormModal';
import { RecordHistory } from '@/components/crm/RecordHistory';
import { DraftEmailButton } from '@/components/crm/DraftEmailButton';
import { INVOICE_FIELDS } from '@/components/crm/schemas';
import { LABELS_INVOICE_STATUS, formatEur, formatDate } from '@/lib/crm-types';

interface InvoiceDetail {
  invoice: Record<string, unknown> & {
    client_name?: string; client_id?: string;
    matter_reference?: string; matter_id?: string;
    primary_contact_name?: string;
  };
  payments: Array<{ id: string; amount: number; payment_date: string; payment_method: string | null; payment_reference: string | null; notes: string | null }>;
}

export default function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [creditingOpen, setCreditingOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/crm/billing/${id}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData(null));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function handleUpdate(values: Record<string, unknown>) {
    const res = await fetch(`/api/crm/billing/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message ?? `Update failed (${res.status})`);
    }
    const body = await res.json();
    if (Array.isArray(body.changed) && body.changed.length > 0) {
      toast.success(`Updated ${body.changed.length} field${body.changed.length === 1 ? '' : 's'}`);
    } else toast.info('No changes to save');
    await load();
  }

  async function handleDelete() {
    const number = String((data?.invoice as { invoice_number?: string })?.invoice_number ?? '?');
    if (!confirm(`Delete invoice ${number}?\n\nOnly draft / cancelled invoices can be deleted. Others must be cancelled first to preserve audit trail.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/crm/billing/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err?.error?.message ?? `Delete failed (${res.status})`);
        return;
      }
      toast.success('Invoice deleted');
      router.push('/crm/billing');
    } finally {
      setDeleting(false);
    }
  }

  async function handleRecordPayment(amount: string, date: string, method: string, ref: string) {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      toast.error('Amount must be a positive number');
      return;
    }
    if (!date) {
      toast.error('Payment date is required');
      return;
    }
    const res = await fetch(`/api/crm/billing/${id}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: n, payment_date: date,
        payment_method: method || null,
        payment_reference: ref || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error?.message ?? `Payment record failed`);
      return;
    }
    const body = await res.json();
    toast.success(`Payment recorded · status: ${body.new_status}`);
    setPayOpen(false);
    await load();
  }

  async function handleApprove() {
    const res = await fetch(`/api/crm/billing/${id}/approve`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error?.message ?? 'Approval failed');
      return;
    }
    toast.success('Invoice approved');
    await load();
  }

  async function handleRescindApproval() {
    if (!confirm('Rescind approval? Invoice will need re-approval before being sent.')) return;
    const res = await fetch(`/api/crm/billing/${id}/approve`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error?.message ?? 'Rescind failed');
      return;
    }
    toast.success('Approval rescinded');
    await load();
  }

  async function handleCreateCreditNote(amount: string, reason: string) {
    const n = amount ? Number(amount) : null;
    if (amount && (!Number.isFinite(n) || (n as number) <= 0)) {
      toast.error('Amount must be a positive number (or blank for full credit)');
      return;
    }
    const res = await fetch(`/api/crm/billing/${id}/credit-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: n, reason }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error?.message ?? 'Credit-note creation failed');
      return;
    }
    const body = await res.json();
    toast.success(`Credit note ${body.invoice_number} created`);
    setCreditingOpen(false);
    router.push(`/crm/billing/${body.id}`);
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm('Remove this payment? Invoice status will be recalculated.')) return;
    const res = await fetch(`/api/crm/billing/${id}/payments?payment_id=${paymentId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err?.error?.message ?? `Delete failed`);
      return;
    }
    const body = await res.json();
    toast.success(`Payment removed · status: ${body.new_status}`);
    await load();
  }

  if (!data) return <PageSkeleton />;
  const i = data.invoice as Record<string, string | number | null> & {
    client_name?: string; client_id?: string;
    matter_reference?: string; matter_id?: string;
    primary_contact_name?: string;
  };

  return (
    <div>
      <div className="text-[11.5px] text-ink-muted mb-2">
        <Link href="/crm/billing" className="hover:underline">← All invoices</Link>
      </div>
      <PageHeader
        title={<span className="font-mono">{String(i.invoice_number)}</span>}
        subtitle={`${i.status ? LABELS_INVOICE_STATUS[i.status as keyof typeof LABELS_INVOICE_STATUS] : ''} · Issued ${formatDate(i.issue_date as string)} · Due ${formatDate(i.due_date as string)}`}
        actions={
          <>
            <a
              href={`/api/crm/billing/${id}/pdf?download=1`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-white text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt"
              title="Download a branded PDF of this invoice"
            >
              <DownloadIcon size={13} />
              PDF
            </a>
            <button
              onClick={() => {
                const subject = `Invoice ${String(i.invoice_number)}`;
                const body = `Dear ${String((i as Record<string, string | null>).primary_contact_name ?? i.client_name ?? 'colleague')},\n\nPlease find attached our invoice ${String(i.invoice_number)}, due ${formatDate(i.due_date as string)}.\n\nPayment instructions appear on the PDF.\n\nKind regards,`;
                // The user downloads the PDF separately and attaches
                // it to the email. We don't inline attachments via
                // mailto: because most mail clients ignore the spec.
                window.open(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
              }}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-white text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt"
              title="Open a draft email in your mail client (remember to attach the PDF)"
            >
              <MailIcon size={13} />
              Email
            </button>
            {String(i.status ?? '') === 'draft' && !(i as Record<string, string | null>).approved_by && (
              <Button variant="primary" size="sm" icon={<CheckCircle2Icon size={13} />} onClick={handleApprove}>
                Approve
              </Button>
            )}
            {String(i.status ?? '') === 'draft' && !!(i as Record<string, string | null>).approved_by && (
              <Button variant="ghost" size="sm" icon={<UndoIcon size={13} />} onClick={handleRescindApproval}>
                Rescind approval
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<PlusIcon size={13} />} onClick={() => setPayOpen(true)}>
              Record payment
            </Button>
            {['sent', 'partial_paid', 'overdue'].includes(String(i.status ?? '')) && Number(i.outstanding ?? 0) > 0 && (
              <DraftEmailButton
                targetType="crm_invoice"
                targetId={id}
                intent="overdue_chase"
                label="Draft chase"
              />
            )}
            {['sent', 'partial_paid', 'paid', 'overdue'].includes(String(i.status ?? '')) && (
              <Button variant="secondary" size="sm" icon={<UndoIcon size={13} />} onClick={() => setCreditingOpen(true)}>
                Credit note
              </Button>
            )}
            <Button variant="secondary" size="sm" icon={<PencilIcon size={13} />} onClick={() => setEditOpen(true)}>Edit</Button>
            <Button variant="ghost" size="sm" icon={<Trash2Icon size={13} />} onClick={handleDelete} loading={deleting}>Delete</Button>
          </>
        }
      />
      <CrmFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        mode="edit"
        title="Edit invoice"
        subtitle={String(i.invoice_number ?? '')}
        fields={INVOICE_FIELDS}
        initial={{
          invoice_number: i.invoice_number,
          status: i.status,
          issue_date: i.issue_date,
          due_date: i.due_date,
          currency: i.currency ?? 'EUR',
          amount_excl_vat: i.amount_excl_vat,
          vat_rate: i.vat_rate,
          amount_incl_vat: i.amount_incl_vat,
          payment_method: i.payment_method,
          payment_reference: i.payment_reference,
          notes: i.notes,
        }}
        onSave={handleUpdate}
      />
      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} onSave={handleRecordPayment} />
      <CreditNoteModal
        open={creditingOpen}
        onClose={() => setCreditingOpen(false)}
        onSave={handleCreateCreditNote}
        maxAmount={Number(i.amount_incl_vat ?? 0)}
        invoiceNumber={String(i.invoice_number ?? '')}
      />

      {i.status === 'credit_note' && (i as Record<string, string | null>).original_invoice_id && (
        <div className="mb-4 p-2.5 bg-amber-50 border border-amber-300 rounded text-[12px] text-amber-900">
          ↩️ This is a <strong>credit note</strong> against invoice{' '}
          <Link href={`/crm/billing/${(i as Record<string, string>).original_invoice_id}`} className="font-mono text-brand-700 hover:underline">
            {String((i as Record<string, string>).original_invoice_number ?? (i as Record<string, string>).original_invoice_id)}
          </Link>
          . Amounts are negative and offset the original on dashboards.
        </div>
      )}

      {!!(i as Record<string, string | null>).approved_by && (
        <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-300 rounded text-[12px] text-emerald-900 flex items-center gap-2">
          <CheckCircle2Icon size={14} className="text-emerald-700" />
          Approved by <strong>{String((i as Record<string, string>).approved_by)}</strong>{' '}
          on {formatDate(String((i as Record<string, string>).approved_at ?? ''))}. Safe to issue.
        </div>
      )}

      {i.currency && i.currency !== 'EUR' && (
        <div className="mb-4 p-2.5 bg-brand-50 border border-brand-200 rounded text-[12px] text-brand-900">
          💱 Foreign-currency invoice in <strong>{String(i.currency)}</strong>.
          {(i as Record<string, number | null>).fx_rate_at_issue
            ? <> ECB rate on issue date: <span className="font-mono">1 EUR = {Number((i as Record<string, number>).fx_rate_at_issue).toFixed(4)} {String(i.currency)}</span>. Dashboards convert to EUR using this snapshot.</>
            : <> FX rate not snapshot — dashboards will show at-rate-lookup-time values until this is populated.</>
          }
        </div>
      )}

      {!!(i as Record<string, string | null>).last_reminder_kind && (
        <div className="mb-4 p-2.5 bg-amber-50 border border-amber-200 rounded text-[11.5px] text-amber-900">
          ⏰ Last reminder: <strong>{String((i as Record<string, string>).last_reminder_kind)}</strong>
          {(i as Record<string, string | null>).last_reminder_sent_at && (
            <> on {formatDate(String((i as Record<string, string>).last_reminder_sent_at))}</>
          )}
          . An open task exists in the Tasks tab.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Kpi label="Amount (incl. VAT)" value={formatEur(i.amount_incl_vat)} />
        <Kpi label="VAT" value={formatEur(i.vat_amount)} />
        <Kpi label="Paid" value={formatEur(i.amount_paid)} tone="success" />
        <Kpi label="Outstanding" value={formatEur((i as Record<string, number | null>).outstanding)} tone={Number((i as Record<string, number | null>).outstanding ?? 0) > 0 ? 'warning' : undefined} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <Card title="Client">
          {i.client_id ? <Link href={`/crm/companies/${i.client_id}`} className="text-brand-700 hover:underline">{i.client_name ?? '—'}</Link> : '—'}
        </Card>
        <Card title="Matter">
          {i.matter_id ? <Link href={`/crm/matters/${i.matter_id}`} className="text-brand-700 hover:underline font-mono">{i.matter_reference ?? '—'}</Link> : '—'}
        </Card>
        <Card title="Payment method">{String(i.payment_method ?? '—')}</Card>
      </div>

      {i.notes && (
        <div className="mb-5 p-3 bg-surface-alt border border-border rounded text-[12.5px] whitespace-pre-wrap">{String(i.notes)}</div>
      )}

      <div className="mb-5">
        <h3 className="text-[12px] uppercase tracking-wide font-semibold text-ink-muted mb-2">Payments ({data.payments.length})</h3>
        {data.payments.length === 0 ? (
          <div className="text-[12px] text-ink-muted italic px-3 py-2">No payments recorded yet.</div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden bg-white">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-alt text-ink-muted">
                <tr>
                  <th className="text-left px-3 py-1.5 font-medium">Date</th>
                  <th className="text-right px-3 py-1.5 font-medium">Amount</th>
                  <th className="text-left px-3 py-1.5 font-medium">Method</th>
                  <th className="text-left px-3 py-1.5 font-medium">Reference</th>
                  <th className="text-right px-3 py-1.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.map(p => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="px-3 py-1.5 tabular-nums">{formatDate(p.payment_date)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatEur(p.amount)}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{p.payment_method ?? '—'}</td>
                    <td className="px-3 py-1.5 text-ink-muted font-mono">{p.payment_reference ?? '—'}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => handleDeletePayment(p.id)} className="text-danger-600 hover:text-danger-800 text-[11px]">
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <RecordHistory targetType="crm_invoice" targetId={id} />
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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md bg-white px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-ink-muted mb-1">{title}</div>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function PaymentModal({
  open, onClose, onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (amount: string, date: string, method: string, ref: string) => void | Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState('bank_transfer');
  const [ref, setRef] = useState('');

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record payment"
      size="md"
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} className="h-8 px-3 rounded-md border border-border text-[12.5px] text-ink-soft hover:bg-surface-alt">Cancel</button>
          <Button variant="primary" size="sm" onClick={() => onSave(amount, date, method, ref)}>Record</Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Amount (€) *</label>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="5000" className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md focus:outline-none focus:border-brand-500 tabular-nums" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Date *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md focus:outline-none focus:border-brand-500" />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Method</label>
          <select value={method} onChange={e => setMethod(e.target.value)} className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md bg-white">
            <option value="bank_transfer">Bank transfer</option>
            <option value="direct_debit">Direct debit</option>
            <option value="other">Other</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Reference</label>
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="Bank statement ref" className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md focus:outline-none focus:border-brand-500" />
        </div>
      </div>
    </Modal>
  );
}

function CreditNoteModal({
  open, onClose, onSave, maxAmount, invoiceNumber,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (amount: string, reason: string) => void | Promise<void>;
  maxAmount: number;
  invoiceNumber: string;
}) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    setSaving(true);
    try { await onSave(amount, reason); } finally { setSaving(false); }
  }

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      title={`Credit note against ${invoiceNumber}`}
      size="md"
      footer={
        <div className="flex items-center gap-2 justify-end">
          <button onClick={onClose} disabled={saving} className="h-8 px-3 rounded-md border border-border text-[12.5px] text-ink-soft hover:bg-surface-alt disabled:opacity-40">Cancel</button>
          <Button variant="primary" size="sm" onClick={submit} loading={saving}>Create credit note</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[12px] text-ink-muted">
          Generates a new invoice row with <strong>negative</strong> amounts, linked to {invoiceNumber}. The original stays
          as-is (its status doesn&apos;t change) — the credit note appears on dashboards and cancels the figure on aggregate.
        </p>
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            Amount to credit (€) — blank = full ({formatEur(maxAmount)})
          </label>
          <input
            type="number"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder={formatEur(maxAmount)}
            max={maxAmount}
            className="w-full h-9 px-2.5 text-[13px] border border-border rounded-md tabular-nums"
          />
        </div>
        <div>
          <label className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">Reason</label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            placeholder="E.g. Billing error on line 3 · client goodwill gesture · scope descoping"
            className="w-full px-2.5 py-2 text-[13px] border border-border rounded-md resize-y"
          />
        </div>
      </div>
    </Modal>
  );
}
