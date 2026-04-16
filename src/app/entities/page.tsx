'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PlusIcon, PencilIcon, Trash2Icon, ArrowRightIcon, BuildingIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Field, Input, Select, Label, Textarea } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { Card, CardHeader, CardBody } from '@/components/ui/Card';
import { Stat } from '@/components/ui/Stat';

interface Entity {
  id: string; name: string; vat_number: string | null; matricule: string | null;
  rcs_number: string | null; legal_form: string | null; entity_type: string | null;
  regime: string; frequency: string; address: string | null;
  bank_iban: string | null; bank_bic: string | null; tax_office: string | null;
  client_name: string | null; client_email: string | null;
  csp_name: string | null; csp_email: string | null;
  has_fx: number; has_outgoing: number; has_recharges: number;
  notes: string | null; created_at: string;
}

const EMPTY = {
  name: '', vat_number: '', matricule: '', rcs_number: '',
  legal_form: '', entity_type: '', regime: 'simplified', frequency: 'annual',
  address: '', bank_iban: '', bank_bic: '', tax_office: '',
  client_name: '', client_email: '', csp_name: '', csp_email: '',
  has_fx: false, has_outgoing: false, has_recharges: false, notes: '',
};

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);

  useEffect(() => { load(); }, []);
  async function load() {
    const res = await fetch('/api/entities');
    setEntities(await res.json());
  }
  function reset() { setForm(EMPTY); setEditId(null); }

  async function handleDelete(entity: Entity) {
    if (!confirm(`Delete "${entity.name}"? This hides it from the list but keeps the data for audit.`)) return;
    await fetch(`/api/entities/${entity.id}`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'user_deleted' }),
    });
    load();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const url = editId ? `/api/entities/${editId}` : '/api/entities';
    await fetch(url, {
      method: editId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    reset();
    setShowForm(false);
    load();
  }

  function handleEdit(e: Entity) {
    setForm({
      name: e.name || '', vat_number: e.vat_number || '', matricule: e.matricule || '',
      rcs_number: e.rcs_number || '', legal_form: e.legal_form || '', entity_type: e.entity_type || '',
      regime: e.regime || 'simplified', frequency: e.frequency || 'annual',
      address: e.address || '', bank_iban: e.bank_iban || '', bank_bic: e.bank_bic || '',
      tax_office: e.tax_office || '', client_name: e.client_name || '', client_email: e.client_email || '',
      csp_name: e.csp_name || '', csp_email: e.csp_email || '',
      has_fx: !!e.has_fx, has_outgoing: !!e.has_outgoing, has_recharges: !!e.has_recharges,
      notes: e.notes || '',
    });
    setEditId(e.id);
    setShowForm(true);
  }

  if (!entities) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="The Luxembourg legal entities you file VAT for. Grouped by client when a client_name is recorded. Set the regime and frequency once — the rest flows automatically."
        actions={
          <Button
            variant="primary"
            icon={<PlusIcon size={14} />}
            onClick={() => { reset(); setShowForm(!showForm); }}
          >
            {showForm ? 'Cancel' : 'New entity'}
          </Button>
        }
      />

      {/* KPI row */}
      {entities.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat
            label="Entities"
            value={entities.length}
          />
          <Stat
            label="Unique clients"
            value={new Set(entities.map(e => e.client_name || e.name)).size}
            tone="neutral"
          />
          <Stat
            label="Simplified regime"
            value={entities.filter(e => e.regime === 'simplified').length}
            tone="info"
          />
          <Stat
            label="Ordinary regime"
            value={entities.filter(e => e.regime === 'ordinary').length}
            tone="brand"
          />
        </div>
      )}

      {showForm && (
        <Card className="mb-6 animate-fadeIn">
          <CardHeader title={editId ? 'Edit entity' : 'New entity'} />
          <CardBody>
            <form onSubmit={handleSubmit}>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Entity name *">
                  <Input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </Field>
                <Field label="VAT number">
                  <Input value={form.vat_number} onChange={e => setForm({ ...form, vat_number: e.target.value })} placeholder="LU12345678" />
                </Field>
                <Field label="Matricule">
                  <Input value={form.matricule} onChange={e => setForm({ ...form, matricule: e.target.value })} />
                </Field>
                <Field label="RCS number">
                  <Input value={form.rcs_number} onChange={e => setForm({ ...form, rcs_number: e.target.value })} />
                </Field>
                <Field label="Legal form">
                  <Select value={form.legal_form} onChange={e => setForm({ ...form, legal_form: e.target.value })}>
                    <option value="">Select…</option>
                    <option value="SARL">SARL</option>
                    <option value="SCA">SCA</option>
                    <option value="SCS">SCS</option>
                    <option value="SA">SA</option>
                    <option value="SCSp">SCSp</option>
                  </Select>
                </Field>
                <Field label="Entity type">
                  <Select value={form.entity_type} onChange={e => setForm({ ...form, entity_type: e.target.value })}>
                    <option value="">Select…</option>
                    <option value="fund">Fund (UCITS / SIF / RAIF / SICAR / Part II)</option>
                    <option value="manco">Management company (AIFM / UCITS ManCo)</option>
                    <option value="gp">General partner</option>
                    <option value="active_holding">Active holding (Marle / Larentia+Minerva)</option>
                    <option value="passive_holding">Passive holding (Polysar / Cibo)</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
                <Field label="Regime *">
                  <Select value={form.regime} onChange={e => setForm({ ...form, regime: e.target.value })}>
                    <option value="simplified">Simplified</option>
                    <option value="ordinary">Ordinary</option>
                  </Select>
                </Field>
                <Field label="Frequency *">
                  <Select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })}>
                    <option value="annual">Annual</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="monthly">Monthly</option>
                  </Select>
                </Field>
                <Field label="Address" className="col-span-2">
                  <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                </Field>
                <Field label="Bank IBAN">
                  <Input value={form.bank_iban} onChange={e => setForm({ ...form, bank_iban: e.target.value })} />
                </Field>
                <Field label="Bank BIC">
                  <Input value={form.bank_bic} onChange={e => setForm({ ...form, bank_bic: e.target.value })} />
                </Field>
                <Field label="Tax office">
                  <Input value={form.tax_office} onChange={e => setForm({ ...form, tax_office: e.target.value })} />
                </Field>
                <Field label="Client name">
                  <Input value={form.client_name} onChange={e => setForm({ ...form, client_name: e.target.value })} />
                </Field>
                <Field label="Client email">
                  <Input value={form.client_email} onChange={e => setForm({ ...form, client_email: e.target.value })} />
                </Field>
                <Field label="CSP name">
                  <Input value={form.csp_name} onChange={e => setForm({ ...form, csp_name: e.target.value })} />
                </Field>
                <Field label="CSP email" className="col-span-2">
                  <Input value={form.csp_email} onChange={e => setForm({ ...form, csp_email: e.target.value })} />
                </Field>
              </div>

              <div className="mt-5 pt-4 border-t border-divider">
                <Label>Traits</Label>
                <div className="flex flex-wrap gap-5 mt-1">
                  <Check label="Has FX invoices" checked={form.has_fx} onChange={v => setForm({ ...form, has_fx: v })} />
                  <Check label="Has outgoing invoices" checked={form.has_outgoing} onChange={v => setForm({ ...form, has_outgoing: v })} />
                  <Check label="Has recharges" checked={form.has_recharges} onChange={v => setForm({ ...form, has_recharges: v })} />
                </div>
              </div>

              <Field label="Notes" className="mt-4">
                <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} />
              </Field>

              <div className="mt-5 flex gap-2">
                <Button type="submit" variant="primary">{editId ? 'Save changes' : 'Create entity'}</Button>
                <Button type="button" variant="secondary" onClick={() => { reset(); setShowForm(false); }}>Cancel</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {entities.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BuildingIcon size={22} />}
            title="No entities yet"
            description="Entities are the Luxembourg legal entities you file VAT for. Start by creating one."
            action={<Button variant="primary" icon={<PlusIcon size={14} />} onClick={() => setShowForm(true)}>Create entity</Button>}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt border-b border-divider text-ink-muted">
              <tr>
                <Th>Client</Th>
                <Th>Entity</Th>
                <Th>Regime</Th>
                <Th>Frequency</Th>
                <Th>VAT number</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entities.map(entity => (
                <tr key={entity.id} className="border-b border-divider last:border-0 hover:bg-surface-alt/60 transition-colors duration-150">
                  <td className="px-4 py-3 text-ink-soft">{entity.client_name || <span className="text-ink-faint">—</span>}</td>
                  <td className="px-4 py-3">
                    <Link href={`/entities/${entity.id}`} className="font-medium text-ink hover:text-brand-600 transition-colors">
                      {entity.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={entity.regime === 'simplified' ? 'info' : 'violet'}>{entity.regime}</Badge>
                  </td>
                  <td className="px-4 py-3 text-ink-soft capitalize">{entity.frequency}</td>
                  <td className="px-4 py-3 text-ink-soft font-mono text-[11.5px]">{entity.vat_number || <span className="text-ink-faint">—</span>}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Link href={`/entities/${entity.id}`} className="p-1.5 rounded-md text-ink-muted hover:text-brand-600 hover:bg-surface-alt transition-colors" title="Open">
                        <ArrowRightIcon size={14} />
                      </Link>
                      <button onClick={() => handleEdit(entity)} className="p-1.5 rounded-md text-ink-muted hover:text-ink hover:bg-surface-alt transition-colors" title="Edit">
                        <PencilIcon size={14} />
                      </button>
                      <button onClick={() => handleDelete(entity)} className="p-1.5 rounded-md text-ink-muted hover:text-danger-700 hover:bg-danger-50 transition-colors" title="Delete">
                        <Trash2Icon size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-4 py-2.5 text-left font-medium text-[10.5px] uppercase tracking-[0.06em]">{children}</th>;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer text-[12.5px] text-ink-soft hover:text-ink transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-border accent-brand-500 cursor-pointer"
      />
      {label}
    </label>
  );
}
