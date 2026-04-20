'use client';

// ════════════════════════════════════════════════════════════════════════
// /clients/new — the 2-step wizard Diego asked for.
//
// Step 1: Who is the client?
//   - Name (required)
//   - Type: End client / CSP / Other
//   - Primary VAT contact: name, role, email, phone, country
//   - Optional: address, website, notes
//
// Step 2: (Optional) First entity under this client.
//   - Short form with the essentials: name, VAT number, matricule,
//     regime, frequency. Rest can be filled later on the entity page.
//   - "Skip — just save the client" exits to /clients/[id].
//
// Zero counters, zero decoration. Just the flow. See PROTOCOLS §11.
// ════════════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  CheckIcon, ChevronLeftIcon, ChevronRightIcon, Loader2Icon,
  AlertTriangleIcon, Building2Icon, UserIcon,
} from 'lucide-react';
import { VatLetterUpload } from '@/components/entity/VatLetterUpload';

type Kind = 'end_client' | 'csp' | 'other';

interface ClientForm {
  name: string;
  kind: Kind;
  vat_contact_name: string;
  vat_contact_role: string;
  vat_contact_email: string;
  vat_contact_phone: string;
  vat_contact_country: string;
  address: string;
  website: string;
  notes: string;
  // Intermediary / engaged-via fields (optional; usually null).
  // Captured when the firm was engaged by a CSP or another party on
  // behalf of the end client. The end client is still the record of
  // truth; these are metadata.
  engaged_via_name: string;
  engaged_via_contact_name: string;
  engaged_via_contact_email: string;
  engaged_via_contact_role: string;
}

interface EntityForm {
  name: string;
  vat_number: string;
  matricule: string;
  regime: 'simplified' | 'ordinary';
  frequency: 'annual' | 'quarterly' | 'monthly';
  entity_type: string;
  legal_form: string;
  vat_status: 'registered' | 'pending_registration' | 'not_applicable';
}

export default function NewClientWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);

  const [client, setClient] = useState<ClientForm>({
    name: '',
    kind: 'end_client',
    vat_contact_name: '',
    vat_contact_role: '',
    vat_contact_email: '',
    vat_contact_phone: '',
    vat_contact_country: '',
    address: '',
    website: '',
    notes: '',
    engaged_via_name: '',
    engaged_via_contact_name: '',
    engaged_via_contact_email: '',
    engaged_via_contact_role: '',
  });
  const [engagedViaOpen, setEngagedViaOpen] = useState(false);

  const [entity, setEntity] = useState<EntityForm>({
    name: '',
    vat_number: '',
    matricule: '',
    regime: 'simplified',
    frequency: 'annual',
    entity_type: '',
    legal_form: '',
    vat_status: 'registered',
  });

  const [createdClientId, setCreatedClientId] = useState<string | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [savingEntity, setSavingEntity] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveClient(): Promise<string | null> {
    setSavingClient(true);
    setError(null);
    try {
      const res = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: client.name.trim(),
          kind: client.kind,
          vat_contact_name: client.vat_contact_name.trim() || null,
          vat_contact_role: client.vat_contact_role.trim() || null,
          vat_contact_email: client.vat_contact_email.trim() || null,
          vat_contact_phone: client.vat_contact_phone.trim() || null,
          vat_contact_country: client.vat_contact_country.trim().toUpperCase().slice(0, 2) || null,
          address: client.address.trim() || null,
          website: client.website.trim() || null,
          notes: client.notes.trim() || null,
          // Only send intermediary fields when the section is open AND
          // there's at least a name — avoids creating "engaged via
          // NULL" metadata on every client.
          engaged_via_name: (engagedViaOpen && client.engaged_via_name.trim()) ? client.engaged_via_name.trim() : null,
          engaged_via_contact_name: (engagedViaOpen && client.engaged_via_contact_name.trim()) ? client.engaged_via_contact_name.trim() : null,
          engaged_via_contact_email: (engagedViaOpen && client.engaged_via_contact_email.trim()) ? client.engaged_via_contact_email.trim() : null,
          engaged_via_contact_role: (engagedViaOpen && client.engaged_via_contact_role.trim()) ? client.engaged_via_contact_role.trim() : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.error?.code === 'duplicate_name') {
          setError(
            `A client named "${client.name.trim()}" already exists. ` +
            `Want to add an entity under that client instead?`,
          );
        } else {
          setError(data?.error?.message ?? 'Failed to create client.');
        }
        return null;
      }
      setCreatedClientId(data.id);
      return data.id as string;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      return null;
    } finally {
      setSavingClient(false);
    }
  }

  async function goToStep2() {
    // If we already created the client (user went back to step 1 and
    // came back), skip the save.
    const id = createdClientId || (await saveClient());
    if (id) setStep(2);
  }

  async function finishClientOnly() {
    const id = createdClientId || (await saveClient());
    if (id) router.push(`/clients/${id}`);
  }

  async function saveEntityAndFinish() {
    if (!createdClientId) return;
    if (!entity.name.trim()) {
      setError('Entity name is required.');
      return;
    }
    setSavingEntity(true);
    setError(null);
    try {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: createdClientId,
          name: entity.name.trim(),
          vat_number: entity.vat_number.trim() || null,
          matricule: entity.matricule.trim() || null,
          regime: entity.regime,
          frequency: entity.frequency,
          entity_type: entity.entity_type.trim() || null,
          legal_form: entity.legal_form.trim() || null,
          vat_status: entity.vat_status,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? data?.error ?? 'Failed to create entity.');
        return;
      }
      router.push(`/entities/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSavingEntity(false);
    }
  }

  const step1Valid = client.name.trim().length > 0;

  return (
    <div className="max-w-[640px]">
      {/* Header */}
      <div className="mb-5">
        <div className="text-[11px] text-ink-faint mb-1">
          <Link href="/clients" className="hover:underline">Clients</Link> ›
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight">Create client</h1>
        <p className="text-[12.5px] text-ink-muted mt-1 max-w-[540px] leading-relaxed">
          A client is the beneficial owner you prepare filings for. Step&nbsp;1 captures the
          relationship + the primary point of contact. Step&nbsp;2 (optional) creates the
          first Luxembourg entity under this client — you can always add more later.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 mb-6">
        <StepDot n={1} label="Client" active={step === 1} done={createdClientId !== null && step === 2} />
        <div className="flex-1 h-px bg-divider" />
        <StepDot n={2} label="First entity (optional)" active={step === 2} done={false} />
      </div>

      {error && (
        <div className="mb-4 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          {/* Identity */}
          <div className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-1">
              <Building2Icon size={15} className="text-brand-500" />
              <h3 className="text-[13.5px] font-semibold text-ink">Identity</h3>
            </div>
            <p className="text-[11.5px] text-ink-muted mb-4 leading-relaxed">
              Legal name as it appears on AED correspondence + the relationship
              to your firm.
            </p>
            <Field label="Legal name" required>
              <input
                value={client.name}
                onChange={(e) => setClient({ ...client, name: e.target.value })}
                placeholder="e.g. Luxor Capital Group, Meridien Partners SARL"
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
              />
            </Field>
            {/* The Relationship chip picker (End client / CSP / Other)
                was removed here in stint 15 per Diego's feedback: with
                the "Engaged through an intermediary" checkbox below, the
                three-way picker was redundant and introduced a decision
                at the point of creation that 95%+ of the time is
                "End client". We default kind = 'end_client' silently.
                Edge cases (your CSP is actually your direct customer,
                or the client is an internal test record) can be
                retyped from /clients/[id] → Edit → Advanced. */}

            {/* ─── Engaged-via intermediary ─── */}
            <div className="mt-4 pt-4 border-t border-divider">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={engagedViaOpen}
                    onChange={(e) => setEngagedViaOpen(e.target.checked)}
                    className="mt-1 accent-brand-500"
                  />
                  <span className="text-[12.5px] text-ink-soft leading-relaxed">
                    <strong className="text-ink">Engaged through an intermediary (optional)</strong>
                    <br />
                    <span className="text-ink-muted">
                      Tick when you were asked to prepare this client&rsquo;s filings by
                      a CSP / fiduciary / another firm rather than by the client
                      directly. The end client stays the record of truth; the
                      intermediary is who you actually talk to.
                    </span>
                  </span>
                </label>

                {engagedViaOpen && (
                  <div className="mt-4 ml-6 space-y-3">
                    <Field label="Intermediary company" hint="The CSP / fiduciary that put you on the file">
                      <input
                        value={client.engaged_via_name}
                        onChange={(e) => setClient({ ...client, engaged_via_name: e.target.value })}
                        placeholder="Name of the intermediary company"
                        className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Your contact there" hint="person you email">
                        <input
                          value={client.engaged_via_contact_name}
                          onChange={(e) => setClient({ ...client, engaged_via_contact_name: e.target.value })}
                          className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </Field>
                      <Field label="Role / title" hint="e.g. Accounting Manager">
                        <input
                          value={client.engaged_via_contact_role}
                          onChange={(e) => setClient({ ...client, engaged_via_contact_role: e.target.value })}
                          className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </Field>
                    </div>
                    <Field label="Email">
                      <input
                        type="email"
                        value={client.engaged_via_contact_email}
                        onChange={(e) => setClient({ ...client, engaged_via_contact_email: e.target.value })}
                        className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </Field>
                    <div className="text-[11px] text-ink-muted italic">
                      When filled, the Primary VAT contact below defaults to this
                      person on subsequent entities under this client.
                    </div>
                  </div>
                )}
            </div>
          </div>

          {/* Primary VAT contact */}
          <div className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-center gap-2 mb-1">
              <UserIcon size={15} className="text-brand-500" />
              <h3 className="text-[13.5px] font-semibold text-ink">Main point of contact</h3>
            </div>
            <p className="text-[11.5px] text-ink-muted mb-4 leading-relaxed">
              Who you write to for anything VAT-related on this client. Defaults
              to the approver on every new entity you create under this client
              (you can add per-entity overrides later).
              {engagedViaOpen && client.engaged_via_contact_name && (
                <> When an intermediary is set, it&rsquo;s usually that contact rather than someone at the end client directly.</>
              )}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <input
                  value={client.vat_contact_name}
                  onChange={(e) => setClient({ ...client, vat_contact_name: e.target.value })}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Role / title" hint="e.g. CFO, Head of Finance">
                <input
                  value={client.vat_contact_role}
                  onChange={(e) => setClient({ ...client, vat_contact_role: e.target.value })}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={client.vat_contact_email}
                  onChange={(e) => setClient({ ...client, vat_contact_email: e.target.value })}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Phone">
                <input
                  value={client.vat_contact_phone}
                  onChange={(e) => setClient({ ...client, vat_contact_phone: e.target.value })}
                  placeholder="+352 …"
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Country" hint="Where they sit · helps with timezones when scheduling calls (optional)">
                <input
                  value={client.vat_contact_country}
                  onChange={(e) => setClient({ ...client, vat_contact_country: e.target.value.toUpperCase().slice(0, 2) })}
                  maxLength={2}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
            </div>
          </div>

          {/* Optional details — collapsed by default */}
          <OptionalClientDetails client={client} setClient={setClient} />

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <Link
              href="/clients"
              className="h-9 px-4 rounded border border-border-strong text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt inline-flex items-center"
            >
              Cancel
            </Link>
            <div className="flex gap-2">
              <button
                onClick={finishClientOnly}
                disabled={!step1Valid || savingClient}
                className="h-9 px-4 rounded border border-border-strong text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {savingClient ? <Loader2Icon size={13} className="animate-spin" /> : <CheckIcon size={13} />}
                Save, no entities yet
              </button>
              <button
                onClick={goToStep2}
                disabled={!step1Valid || savingClient}
                className="h-9 px-4 rounded bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {savingClient ? <Loader2Icon size={13} className="animate-spin" /> : null}
                Continue to add first entity <ChevronRightIcon size={13} />
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-5">
          <div className="bg-brand-50 border border-brand-200 rounded-lg p-3 text-[12px] text-brand-800">
            ✓ Client <strong>{client.name}</strong> created. Now add its first entity.
            You can add more from the client profile later.
          </div>

          <div className="bg-surface border border-border rounded-lg p-5">
            <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
              <h3 className="text-[13px] font-semibold text-ink flex items-center gap-2">
                <Building2Icon size={15} className="text-brand-500" /> First entity
              </h3>
              <VatLetterUpload
                compact
                onExtracted={(f) => {
                  setEntity((prev) => ({
                    ...prev,
                    name: f.name ?? prev.name,
                    vat_number: f.vat_number ?? prev.vat_number,
                    matricule: f.matricule ?? prev.matricule,
                    legal_form: f.legal_form ?? prev.legal_form,
                    entity_type: f.entity_type ?? prev.entity_type,
                    regime: f.regime ?? prev.regime,
                    frequency: f.frequency === 'yearly' ? 'annual'
                               : f.frequency ?? prev.frequency,
                  }));
                }}
              />
            </div>
            <Field label="Entity name" required>
              <input
                value={entity.name}
                onChange={(e) => setEntity({ ...entity, name: e.target.value })}
                placeholder="e.g. Luxor LuxCo 1 SARL"
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="VAT number">
                <input
                  value={entity.vat_number}
                  onChange={(e) => setEntity({ ...entity, vat_number: e.target.value })}
                  placeholder="LU12345678"
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Matricule" hint="AED identifier, 11 digits">
                <input
                  value={entity.matricule}
                  onChange={(e) => setEntity({ ...entity, matricule: e.target.value })}
                  placeholder="20232456346"
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Legal form" hint="SARL, SCSp, SA …">
                <input
                  value={entity.legal_form}
                  onChange={(e) => setEntity({ ...entity, legal_form: e.target.value })}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Type" hint="soparfi / aifm / holding / …">
                <input
                  value={entity.entity_type}
                  onChange={(e) => setEntity({ ...entity, entity_type: e.target.value })}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </Field>
              <Field label="Regime">
                <select
                  value={entity.regime}
                  onChange={(e) => setEntity({ ...entity, regime: e.target.value as EntityForm['regime'] })}
                  className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="simplified">Simplified</option>
                  <option value="ordinary">Ordinary</option>
                </select>
              </Field>
              <Field label="Frequency">
                <select
                  value={entity.frequency}
                  onChange={(e) => setEntity({ ...entity, frequency: e.target.value as EntityForm['frequency'] })}
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
                <VatStatusOption
                  label="Registered"
                  hint="Already has a VAT number"
                  active={entity.vat_status === 'registered'}
                  onClick={() => setEntity({ ...entity, vat_status: 'registered' })}
                />
                <VatStatusOption
                  label="Pending"
                  hint="Registration in progress"
                  active={entity.vat_status === 'pending_registration'}
                  onClick={() => setEntity({ ...entity, vat_status: 'pending_registration' })}
                />
                <VatStatusOption
                  label="Not applicable"
                  hint="Holding without activity"
                  active={entity.vat_status === 'not_applicable'}
                  onClick={() => setEntity({ ...entity, vat_status: 'not_applicable' })}
                />
              </div>
            </Field>
          </div>

          <p className="text-[11.5px] text-ink-muted">
            You can add approvers, bank details, FX + outgoing flags, and
            more optional fields from the entity detail page.
          </p>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              disabled={savingEntity}
              className="h-9 px-4 rounded border border-border-strong text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt inline-flex items-center gap-1.5"
            >
              <ChevronLeftIcon size={13} /> Back
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => createdClientId && router.push(`/clients/${createdClientId}`)}
                disabled={savingEntity}
                className="h-9 px-4 rounded border border-border-strong text-[12.5px] font-medium text-ink-soft hover:bg-surface-alt"
              >
                Skip — finish later
              </button>
              <button
                onClick={saveEntityAndFinish}
                disabled={savingEntity || !entity.name.trim()}
                className="h-9 px-4 rounded bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
              >
                {savingEntity ? <Loader2Icon size={13} className="animate-spin" /> : <CheckIcon size={13} />}
                Create entity
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function OptionalClientDetails({
  client, setClient,
}: { client: ClientForm; setClient: (c: ClientForm) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-surface border border-border rounded-lg">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center justify-between text-left hover:bg-surface-alt/40 transition-colors"
      >
        <span className="text-[13px] font-medium text-ink">Optional details (address, website, notes)</span>
        <ChevronRightIcon size={14} className={`text-ink-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <Field label="Address">
            <input
              value={client.address}
              onChange={(e) => setClient({ ...client, address: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Website">
            <input
              value={client.website}
              onChange={(e) => setClient({ ...client, website: e.target.value })}
              placeholder="https://"
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Notes">
            <textarea
              value={client.notes}
              onChange={(e) => setClient({ ...client, notes: e.target.value })}
              rows={3}
              placeholder="Internal notes — not shared with the client"
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

function StepDot({
  n, label, active, done,
}: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div
        className={[
          'w-6 h-6 rounded-full text-[11px] font-semibold inline-flex items-center justify-center border',
          done ? 'bg-emerald-500 text-white border-emerald-500' :
          active ? 'bg-brand-500 text-white border-brand-500' :
                   'bg-surface text-ink-muted border-border',
        ].join(' ')}
      >
        {done ? '✓' : n}
      </div>
      <span className={`text-[12px] font-medium ${active ? 'text-ink' : 'text-ink-muted'}`}>
        {label}
      </span>
    </div>
  );
}

// KindOption was used for the End client / CSP / Other chip picker that
// stint 15 removed. Kept the function out-of-file to keep the diff
// tiny; delete it in a future cleanup pass.

function VatStatusOption({
  label, hint, active, onClick,
}: { label: string; hint: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={[
        'h-auto py-2 px-3 rounded border text-left transition-colors',
        active
          ? 'bg-brand-50 text-brand-700 border-brand-200'
          : 'bg-surface text-ink-soft border-border hover:bg-surface-alt',
      ].join(' ')}
    >
      <div className="text-[12px] font-semibold">{label}</div>
      <div className="text-[10px] text-ink-muted mt-0.5">{hint}</div>
    </button>
  );
}

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block mb-3 last:mb-0">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {label} {required && <span className="text-danger-600">*</span>}
        {hint && <span className="normal-case text-ink-faint font-normal ml-1">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}
