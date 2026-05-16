'use client';

// VAT registrations — Service Line B
//
// Stint 92 polish (post-audit): page migrated to design primitives
// (PageContainer + PageHeader + Field + Input/Select/Textarea + Button +
// Badge) and the vanity KPI row was deleted per Rule §11. The detail
// page lives at /registrations/[id].

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/Toaster';
import { PageContainer } from '@/components/ui/PageContainer';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';

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
  const toast = useToast();

  function load() {
    fetch('/api/registrations').then(r => r.json()).then(setRegs);
  }
  useEffect(() => {
    load();
    fetch('/api/entities').then(r => r.json()).then(setEntities);
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    try {
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
        toast.success('Registration created');
        router.push(`/registrations/${d.id}`);
        return;
      }
      const body = await res.json().catch(() => ({}));
      toast.error(body?.error?.message ?? `Could not create registration (${res.status})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Network error');
    }
  }

  return (
    <PageContainer width="medium">
      <PageHeader
        title="VAT registrations"
        subtitle="Service Line B — register new entities with the AED. Tracks document collection, form filing, and VAT-number issuance."
        actions={
          <Button
            variant={showForm ? 'secondary' : 'primary'}
            onClick={() => setShowForm(s => !s)}
          >
            {showForm ? 'Cancel' : '+ New registration'}
          </Button>
        }
      />

      {showForm && (
        <form onSubmit={create} className="bg-surface border border-border rounded-lg p-4 mb-5">
          <h3 className="text-sm font-semibold text-ink mb-3">New registration</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Entity *">
              <Select
                required
                value={form.entity_id}
                onChange={e => setForm({ ...form, entity_id: e.target.value })}
              >
                <option value="">Select entity…</option>
                {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Regime requested *">
              <Select
                value={form.regime_requested}
                onChange={e => setForm({ ...form, regime_requested: e.target.value })}
              >
                <option value="simplified">Simplified (assujetti simplifié)</option>
                <option value="ordinary">Ordinary (assujetti normal)</option>
              </Select>
            </Field>
            <Field label="Frequency">
              <Select
                value={form.frequency_requested}
                onChange={e => setForm({ ...form, frequency_requested: e.target.value })}
              >
                <option value="annual">Annual</option>
                <option value="quarterly">Quarterly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>
            <Field label="Triggered by">
              <Select
                value={form.triggered_by}
                onChange={e => setForm({ ...form, triggered_by: e.target.value })}
              >
                <option value="incorporation">Incorporation</option>
                <option value="activity_start">Activity start</option>
                <option value="client_request">Client request</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Tax office">
              <Input
                value={form.tax_office}
                onChange={e => setForm({ ...form, tax_office: e.target.value })}
                placeholder="e.g. Luxembourg 3"
              />
            </Field>
            <Field label="Expected turnover (EUR)">
              <Input
                type="number"
                value={form.expected_turnover}
                onChange={e => setForm({ ...form, expected_turnover: e.target.value })}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="Comments (Section 31 of AED form)">
              <Textarea
                value={form.comments_field}
                onChange={e => setForm({ ...form, comments_field: e.target.value })}
                rows={2}
                placeholder="For simplified: invoke Circular 723 (29 December 2006), state no output VAT, request simplified regime."
              />
            </Field>
          </div>
          <Button type="submit" className="mt-3">
            Create registration
          </Button>
        </form>
      )}

      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {regs.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-sm font-medium text-ink mb-1">No registrations yet</div>
            <div className="text-xs text-ink-muted max-w-sm mx-auto leading-relaxed">
              A VAT registration tracks an entity&rsquo;s journey from
              &ldquo;applied&rdquo; to &ldquo;VAT number issued&rdquo;.
              Start one when a client entity first needs a Luxembourg VAT number.
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-alt text-ink-soft border-b border-border">
              <tr>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">Entity</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">Regime</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">Frequency</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">Status</th>
                <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-2xs">VAT issued</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {regs.map(r => (
                <tr key={r.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/50 transition-colors duration-150">
                  <td className="px-3 py-2 font-medium text-ink">{r.entity_name}</td>
                  <td className="px-3 py-2 text-ink-soft capitalize">{r.regime_requested || '—'}</td>
                  <td className="px-3 py-2 text-ink-soft capitalize">{r.frequency_requested || '—'}</td>
                  <td className="px-3 py-2"><RegStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 font-mono text-ink-soft">{r.issued_vat_number || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/registrations/${r.id}`} className="text-brand-700 hover:underline text-xs font-medium">Open</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </PageContainer>
  );
}

// Tones taken from the Badge token palette so the registration lifecycle
// reads consistently with the rest of the design system. Stint 92.
function RegStatusBadge({ status }: { status: string }) {
  const TONE: Record<string, React.ComponentProps<typeof Badge>['tone']> = {
    docs_requested: 'neutral',
    docs_received:  'info',
    form_prepared:  'violet',
    filed:          'success',
    vat_received:   'teal',
  };
  return (
    <Badge tone={TONE[status] ?? 'neutral'} size="xs">
      {status.replace('_', ' ')}
    </Badge>
  );
}
