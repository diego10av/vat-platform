'use client';

// ════════════════════════════════════════════════════════════════════════
// /entities/new — create an entity under a Client.
//
// Called with ?client_id=X from a Client detail page, or from scratch
// (in which case the user picks a client first, or is redirected to
// /clients/new if none exist).
//
// Applies PROTOCOLS §11: minimal form, no decorative cards. The only
// value shown on the page is the selected Client's name (so the user
// knows what they're attaching to).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Building2Icon, CheckIcon, Loader2Icon, AlertTriangleIcon, SearchIcon,
  ChevronLeftIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { VatLetterUpload, type ExtractedVatLetter } from '@/components/entity/VatLetterUpload';

interface ClientSlim {
  id: string;
  name: string;
  kind: 'end_client' | 'csp' | 'other';
  entity_count: number;
}

type Regime = 'simplified' | 'ordinary';
type Frequency = 'annual' | 'quarterly' | 'monthly';
type VatStatus = 'registered' | 'pending_registration' | 'not_applicable';

function NewEntityPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const presetClientId = sp.get('client_id') || null;

  const [client, setClient] = useState<ClientSlim | null>(null);
  const [allClients, setAllClients] = useState<ClientSlim[] | null>(null);
  const [picking, setPicking] = useState(presetClientId === null);
  const [search, setSearch] = useState('');
  const [loadingClient, setLoadingClient] = useState(presetClientId !== null);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    name: '',
    vat_number: '',
    matricule: '',
    rcs_number: '',
    legal_form: '',
    entity_type: '',
    regime: 'simplified' as Regime,
    frequency: 'annual' as Frequency,
    vat_status: 'registered' as VatStatus,
  });
  const [saving, setSaving] = useState(false);

  // Stint 15: stash the VAT letter so we can persist it via
  // /api/entities/:id/official-documents once the entity row exists.
  const [vatLetterFile, setVatLetterFile] = useState<File | null>(null);
  const [vatLetterFields, setVatLetterFields] = useState<ExtractedVatLetter | null>(null);

  // Load the preset client if provided, otherwise load the client list
  // so the user can pick.
  useEffect(() => {
    if (presetClientId) {
      (async () => {
        try {
          const res = await fetch(`/api/clients/${presetClientId}`);
          const data = await res.json();
          if (!res.ok) {
            setError(data?.error?.message ?? 'Client not found.');
            setPicking(true);
          } else {
            setClient({
              id: data.client.id,
              name: data.client.name,
              kind: data.client.kind,
              entity_count: (data.entities || []).length,
            });
          }
        } finally {
          setLoadingClient(false);
        }
      })();
    }
  }, [presetClientId]);

  // Eager-load clients when user is picking.
  useEffect(() => {
    if (!picking || allClients !== null) return;
    (async () => {
      try {
        const res = await fetch('/api/clients');
        const data = await res.json();
        if (res.status === 501) {
          setError('Apply migration 005 first — the clients model is required.');
          return;
        }
        if (res.ok) setAllClients(data.clients as ClientSlim[]);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Network error.');
      }
    })();
  }, [picking, allClients]);

  async function save() {
    if (!client) return;
    if (!form.name.trim()) {
      setError('Entity name is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: client.id,
          name: form.name.trim(),
          vat_number: form.vat_number.trim() || null,
          matricule: form.matricule.trim() || null,
          rcs_number: form.rcs_number.trim() || null,
          legal_form: form.legal_form.trim() || null,
          entity_type: form.entity_type.trim() || null,
          regime: form.regime,
          frequency: form.frequency,
          vat_status: form.vat_status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? data?.error ?? 'Failed to create entity.');
        return;
      }

      // Persist the VAT letter (if uploaded) so it shows up on the
      // entity detail page. Best-effort — entity creation already
      // succeeded; we don't block navigation on the upload.
      if (vatLetterFile && data.id) {
        try {
          const fd = new FormData();
          fd.append('file', vatLetterFile);
          fd.append('kind', 'vat_registration');
          fd.append('skip_extract', 'true');
          if (vatLetterFields) {
            fd.append('extracted_fields', JSON.stringify(vatLetterFields));
          }
          await fetch(`/api/entities/${data.id}/official-documents`, {
            method: 'POST',
            body: fd,
          });
        } catch {
          // Non-blocking — user can re-upload from /entities/[id] later.
        }
      }

      router.push(`/entities/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  if (loadingClient) return <PageSkeleton />;

  // Picker mode: no client selected yet
  if (picking || !client) {
    const filtered = (allClients || []).filter((c) =>
      c.name.toLowerCase().includes(search.trim().toLowerCase()),
    );

    return (
      <div className="max-w-[540px]">
        <div className="text-[11px] text-ink-faint mb-1">
          <Link href="/clients" className="hover:underline">Clients</Link> ›{' '}
          <Link href="/entities" className="hover:underline">All entities</Link> ›
        </div>
        <h1 className="text-[20px] font-semibold tracking-tight">New entity</h1>
        <p className="text-[12.5px] text-ink-muted mt-1 mb-5">
          Every entity belongs to a client. Pick the client first.
        </p>

        {error && (
          <div className="mb-4 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
            <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        {allClients === null ? (
          <div className="text-[12px] text-ink-muted flex items-center gap-2">
            <Loader2Icon size={13} className="animate-spin" /> Loading clients…
          </div>
        ) : allClients.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-8 text-center">
            <Building2Icon size={22} className="text-ink-muted mx-auto mb-2" />
            <div className="text-[13px] font-medium text-ink">No clients yet</div>
            <div className="text-[12px] text-ink-muted mt-1.5 max-w-sm mx-auto">
              Start by creating a client. The entity will be attached to it.
            </div>
            <Link
              href="/clients/new"
              className="inline-block mt-4 h-9 px-4 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600"
            >
              Create first client
            </Link>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg">
            <div className="p-3 border-b border-divider relative">
              <SearchIcon size={13} className="absolute left-5 top-1/2 -translate-y-1/2 text-ink-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Find client by name"
                className="w-full h-8 pl-7 pr-3 text-[12.5px] border border-border rounded-md bg-surface focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
              />
            </div>
            <ul className="divide-y divide-divider max-h-[420px] overflow-y-auto">
              {filtered.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => { setClient(c); setPicking(false); }}
                    className="w-full text-left px-4 py-3 hover:bg-surface-alt/40 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink truncate">{c.name}</div>
                        <div className="text-[11px] text-ink-muted mt-0.5">
                          {c.kind === 'end_client' ? 'End client' : c.kind === 'csp' ? 'CSP' : 'Other'}
                          <span className="text-ink-faint mx-1.5">·</span>
                          {c.entity_count} {c.entity_count === 1 ? 'entity' : 'entities'}
                        </div>
                      </div>
                      <span className="text-[11px] text-brand-600 font-medium shrink-0">Use this →</span>
                    </div>
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-4 py-8 text-center text-[12px] text-ink-muted">
                  No match.{' '}
                  <Link href="/clients/new" className="text-brand-600 hover:underline font-medium">
                    Create a new client →
                  </Link>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // Form mode: client selected
  return (
    <div className="max-w-[640px]">
      <div className="text-[11px] text-ink-faint mb-1">
        <Link href="/clients" className="hover:underline">Clients</Link> ›{' '}
        <Link href={`/clients/${client.id}`} className="hover:underline">{client.name}</Link> ›
      </div>
      <h1 className="text-[20px] font-semibold tracking-tight">New entity</h1>
      <p className="text-[12.5px] text-ink-muted mt-1 mb-5">
        Under client <strong>{client.name}</strong>.{' '}
        <button
          onClick={() => setPicking(true)}
          className="text-brand-600 hover:underline font-medium"
        >
          Change client
        </button>
      </p>

      {error && (
        <div className="mb-4 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* VAT letter auto-fill — quick way to populate the whole form
          from the AED registration letter. */}
      <div className="bg-brand-50/30 border border-brand-200 rounded-lg p-4 mb-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">Got the VAT registration letter?</div>
            <div className="text-[11.5px] text-ink-soft mt-0.5 leading-relaxed">
              Upload the AED &ldquo;Attestation d&apos;immatriculation à la TVA&rdquo;
              and cifra will fill name, VAT, matricule, RCS, address, regime
              and frequency. You review + correct whatever is missing.
            </div>
          </div>
          <VatLetterUpload
            compact
            onExtracted={(f: ExtractedVatLetter, file: File) => {
              setForm((prev) => ({
                ...prev,
                name: f.name ?? prev.name,
                vat_number: f.vat_number ?? prev.vat_number,
                matricule: f.matricule ?? prev.matricule,
                rcs_number: f.rcs_number ?? prev.rcs_number,
                legal_form: f.legal_form ?? prev.legal_form,
                entity_type: f.entity_type ?? prev.entity_type,
                regime: f.regime ?? prev.regime,
                // Normalise 'yearly' → 'annual' to match the existing field's enum.
                frequency: f.frequency === 'yearly' ? 'annual'
                           : f.frequency ?? prev.frequency,
              }));
              setVatLetterFile(file);
              setVatLetterFields(f);
            }}
          />
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <Field label="Entity name" required>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Luxor LuxCo 1 SARL"
            className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="VAT number">
            <input
              value={form.vat_number}
              onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
              placeholder="LU12345678"
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Matricule" hint="AED id, 11 digits">
            <input
              value={form.matricule}
              onChange={(e) => setForm({ ...form, matricule: e.target.value })}
              placeholder="20232456346"
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Legal form" hint="SARL, SCSp, SA…">
            <input
              value={form.legal_form}
              onChange={(e) => setForm({ ...form, legal_form: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Type" hint="soparfi / aifm / holding">
            <input
              value={form.entity_type}
              onChange={(e) => setForm({ ...form, entity_type: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="RCS number">
            <input
              value={form.rcs_number}
              onChange={(e) => setForm({ ...form, rcs_number: e.target.value })}
              placeholder="B123456"
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Regime">
            <select
              value={form.regime}
              onChange={(e) => setForm({ ...form, regime: e.target.value as Regime })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="simplified">Simplified</option>
              <option value="ordinary">Ordinary</option>
            </select>
          </Field>
          <Field label="Frequency">
            <select
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value as Frequency })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="annual">Annual</option>
              <option value="quarterly">Quarterly</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
        </div>

        <Field label="VAT registration status">
          <div className="grid grid-cols-3 gap-1.5">
            <StatusOption label="Registered" active={form.vat_status === 'registered'} onClick={() => setForm({ ...form, vat_status: 'registered' })} />
            <StatusOption label="Pending" active={form.vat_status === 'pending_registration'} onClick={() => setForm({ ...form, vat_status: 'pending_registration' })} />
            <StatusOption label="Not applicable" active={form.vat_status === 'not_applicable'} onClick={() => setForm({ ...form, vat_status: 'not_applicable' })} />
          </div>
        </Field>
      </div>

      <p className="text-[11.5px] text-ink-muted mt-3">
        Bank details, tax office, approvers, and other optional fields can
        be added from the entity detail page.
      </p>

      {/* Actions */}
      <div className="mt-5 flex items-center justify-between">
        <Link
          href={`/clients/${client.id}`}
          className="h-9 px-3 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
        >
          <ChevronLeftIcon size={13} /> Back
        </Link>
        <button
          onClick={save}
          disabled={saving || !form.name.trim()}
          className="h-9 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {saving ? <Loader2Icon size={13} className="animate-spin" /> : <CheckIcon size={13} />}
          Create entity
        </button>
      </div>
    </div>
  );
}

export default function NewEntityPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NewEntityPageInner />
    </Suspense>
  );
}

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {label} {required && <span className="text-danger-600">*</span>}
        {hint && <span className="normal-case text-ink-faint font-normal ml-1">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function StatusOption({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-9 rounded border text-[12px] font-medium transition-colors',
        active
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-surface text-ink-soft border-border hover:bg-surface-alt',
      ].join(' ')}
    >
      {label}
    </button>
  );
}
