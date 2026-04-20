'use client';

// ════════════════════════════════════════════════════════════════════════
// /clients/[id] — client profile page.
//
// Three blocks, all actionable (PROTOCOLS §11):
//   1. Profile header: name + type + primary VAT contact. Edit inline.
//   2. Entities that hang off this client, with lifecycle at a glance.
//      "Add entity under this client" CTA.
//   3. Declaration status rollup: only shown when there's something
//      to do (in review > 0, filed pending payment > 0). If everything
//      is paid, we say "all up to date" once.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  Building2Icon, PlusIcon, MailIcon, PhoneIcon, MapPinIcon, GlobeIcon,
  ChevronRightIcon, PencilIcon, CheckIcon, Trash2Icon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { ContactsCard } from '@/components/clients/ContactsCard';
import { EngagedViaCard } from '@/components/clients/EngagedViaCard';
import { describeApiError, formatUiError } from '@/lib/ui-errors';
import { CascadeDeleteModal } from '@/components/delete/CascadeDeleteModal';

interface Client {
  id: string;
  name: string;
  kind: 'end_client' | 'csp' | 'other';
  vat_contact_name: string | null;
  vat_contact_email: string | null;
  vat_contact_phone: string | null;
  vat_contact_role: string | null;
  vat_contact_country: string | null;
  address: string | null;
  website: string | null;
  notes: string | null;
  engaged_via_name: string | null;
  engaged_via_contact_name: string | null;
  engaged_via_contact_email: string | null;
  engaged_via_contact_role: string | null;
  engaged_via_notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Entity {
  id: string;
  name: string;
  vat_number: string | null;
  matricule: string | null;
  regime: string;
  frequency: string;
  entity_type: string | null;
  legal_form: string | null;
  vat_status: string;
}

interface ClientData {
  client: Client;
  entities: Entity[];
  declaration_counts: Record<string, number>;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [data, setData] = useState<ClientData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${id}`);
      if (!res.ok) {
        const e = await describeApiError(res, 'Could not load this client.');
        setError(formatUiError(e));
        return;
      }
      const body = await res.json();
      setData(body as ClientData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Archive/delete is now routed through CascadeDeleteModal — the
  // old inline confirm() call couldn't explain the blast radius
  // or offer archive-vs-cascade-delete paths.

  if (!data && !error) return <PageSkeleton />;

  if (error || !data) {
    return (
      <div className="max-w-2xl">
        <div className="bg-danger-50 border border-danger-200 rounded-lg p-6">
          <h2 className="text-[14px] font-semibold text-danger-800">Could not load client</h2>
          <p className="text-[12.5px] text-danger-700 mt-2">{error}</p>
          <Link href="/clients" className="inline-block mt-4 text-[12px] font-medium text-brand-600 hover:underline">
            ← Back to clients
          </Link>
        </div>
      </div>
    );
  }

  const { client, entities, declaration_counts } = data;
  const actionableCounts = {
    review: declaration_counts.review ?? 0,
    approved: declaration_counts.approved ?? 0,
    filed: declaration_counts.filed ?? 0,
  };

  return (
    <div className="max-w-5xl">
      {/* Breadcrumb */}
      <div className="text-[11px] text-ink-faint mb-1">
        <Link href="/clients" className="hover:underline">Clients</Link> › {client.name}
      </div>

      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h1 className="text-[22px] font-semibold tracking-tight">{client.name}</h1>
            {client.engaged_via_name && (
              <a
                href="#engaged-via"
                className="inline-flex items-center gap-1 text-[11.5px] text-ink-soft bg-amber-50 border border-amber-200 rounded px-2 py-0.5 hover:bg-amber-100 transition-colors"
                title="This client is engaged through an intermediary — click to see details"
              >
                <span className="text-ink-muted">via</span>
                <span className="font-semibold text-ink">{client.engaged_via_name}</span>
              </a>
            )}
          </div>
          <div className="text-[12px] text-ink-muted mt-1 flex items-center gap-2 flex-wrap">
            <KindBadge kind={client.kind} />
            <span className="text-ink-faint">·</span>
            <span>{entities.length} {entities.length === 1 ? 'entity' : 'entities'}</span>
            {client.vat_contact_country && (
              <>
                <span className="text-ink-faint">·</span>
                <span className="font-mono">{client.vat_contact_country}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => setDeleteOpen(true)}
            className="h-8 px-3 rounded-md border border-border-strong text-[12px] font-medium text-ink-muted hover:bg-danger-50 hover:text-danger-700 hover:border-danger-200 inline-flex items-center gap-1.5"
            title="Archive or permanently delete this client"
          >
            <Trash2Icon size={13} /> Delete
          </button>
          <Link
            href={`/clients/${client.id}/bulk-import`}
            className="h-8 px-3 rounded-md border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt hover:text-ink inline-flex items-center gap-1.5"
            title="Paste a CSV/TSV and bulk-create entities under this client"
          >
            Bulk import
          </Link>
          <Link
            href={{ pathname: '/entities/new', query: { client_id: client.id } }}
            className="h-8 px-3 rounded-md bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5"
          >
            <PlusIcon size={13} /> Add entity
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Left: profile */}
        <div className="col-span-2 space-y-4">
          <ProfileCard client={client} onUpdated={load} />

          {/* Engaged-via intermediary — visible only when the kind is
              'end_client'. Empty-state is a slim "Add intermediary"
              affordance; populated-state is a full card with edit. */}
          <EngagedViaCard
            clientId={client.id}
            clientKind={client.kind}
            initial={{
              engaged_via_name: client.engaged_via_name,
              engaged_via_contact_name: client.engaged_via_contact_name,
              engaged_via_contact_email: client.engaged_via_contact_email,
              engaged_via_contact_role: client.engaged_via_contact_role,
              engaged_via_notes: client.engaged_via_notes,
            }}
            onSaved={() => { void load(); }}
          />

          {/* Multi-contact roster — stint 11 (2026-04-19). */}
          <ContactsCard clientId={client.id} />

          {/* Entities list */}
          <div className="bg-surface border border-border rounded-lg">
            <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
              <h3 className="text-[13px] font-semibold text-ink">Entities under this client</h3>
              <span className="text-[11px] text-ink-muted">{entities.length}</span>
            </div>
            {entities.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Building2Icon size={20} className="text-ink-muted mx-auto mb-2" />
                <div className="text-[13px] text-ink-muted">No entities yet</div>
                <Link
                  href={{ pathname: '/entities/new', query: { client_id: client.id } }}
                  className="inline-block mt-3 text-[12px] font-medium text-brand-600 hover:underline"
                >
                  Add the first one →
                </Link>
              </div>
            ) : (
              <ul className="divide-y divide-divider">
                {entities.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/entities/${e.id}`}
                      className="flex items-center gap-3 px-4 py-3 hover:bg-surface-alt/40 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-ink truncate">{e.name}</div>
                        <div className="text-[11px] text-ink-muted mt-0.5">
                          {e.vat_number || '(no VAT)'} · {e.regime} / {e.frequency}
                          {e.legal_form && <> · {e.legal_form}</>}
                        </div>
                      </div>
                      <VatStatusChip status={e.vat_status} />
                      <ChevronRightIcon size={13} className="text-ink-faint shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right: actionable summaries */}
        <div className="space-y-4">
          {/* Declaration rollup — only shown when there's something to act on */}
          {(actionableCounts.review > 0 || actionableCounts.filed > 0) ? (
            <div className="bg-surface border border-border rounded-lg p-4">
              <h3 className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-3">
                Across this client&apos;s declarations
              </h3>
              {actionableCounts.review > 0 && (
                <DeclAction
                  count={actionableCounts.review}
                  verb="in review"
                  cta="Go to review queue"
                  href={`/declarations?status=review&client_id=${client.id}`}
                  tone="warning"
                />
              )}
              {actionableCounts.filed > 0 && (
                <DeclAction
                  count={actionableCounts.filed}
                  verb="filed, pending payment"
                  cta="See filed"
                  href={`/declarations?status=filed&client_id=${client.id}`}
                  tone="info"
                />
              )}
            </div>
          ) : entities.length > 0 ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex items-start gap-2">
                <CheckIcon size={14} className="text-emerald-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-[12.5px] font-semibold text-emerald-800">All up to date</div>
                  <div className="text-[11.5px] text-emerald-700 mt-0.5">
                    No declarations pending action for this client.
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Notes (if present) */}
          {client.notes && (
            <div className="bg-amber-50/60 border border-amber-200 rounded-lg p-3">
              <div className="text-[10.5px] uppercase tracking-wide font-semibold text-amber-800 mb-1">
                Internal note
              </div>
              <div className="text-[12px] text-amber-900 whitespace-pre-wrap">{client.notes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Cascade-delete modal — Archive or delete permanently */}
      <CascadeDeleteModal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDone={() => { setDeleteOpen(false); router.push('/clients'); }}
        scope="client"
        targetId={client.id}
        targetName={client.name}
      />
    </div>
  );
}

// ───────────────────────────── subcomponents ─────────────────────────────

function ProfileCard({ client, onUpdated }: { client: Client; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(client);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/clients/${client.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const body = await res.json();
      if (!res.ok) {
        setErr(body?.error?.message ?? 'Could not save.');
        return;
      }
      setEditing(false);
      onUpdated();
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-semibold text-ink">Edit profile</h3>
          <button
            onClick={() => { setDraft(client); setEditing(false); }}
            className="text-[11px] text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
        <div className="space-y-3">
          <Field label="Client name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary contact">
              <input
                value={draft.vat_contact_name || ''}
                onChange={(e) => setDraft({ ...draft, vat_contact_name: e.target.value || null })}
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
            <Field label="Role">
              <input
                value={draft.vat_contact_role || ''}
                onChange={(e) => setDraft({ ...draft, vat_contact_role: e.target.value || null })}
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
            <Field label="Email">
              <input
                type="email"
                value={draft.vat_contact_email || ''}
                onChange={(e) => setDraft({ ...draft, vat_contact_email: e.target.value || null })}
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
            <Field label="Phone">
              <input
                value={draft.vat_contact_phone || ''}
                onChange={(e) => setDraft({ ...draft, vat_contact_phone: e.target.value || null })}
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
            <Field label="Country (ISO-2)">
              <input
                value={draft.vat_contact_country || ''}
                onChange={(e) => setDraft({ ...draft, vat_contact_country: e.target.value.toUpperCase().slice(0, 2) || null })}
                maxLength={2}
                className="w-full border border-border-strong rounded px-3 py-2 text-[13px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </Field>
          </div>
          <Field label="Address">
            <input
              value={draft.address || ''}
              onChange={(e) => setDraft({ ...draft, address: e.target.value || null })}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Website">
            <input
              value={draft.website || ''}
              onChange={(e) => setDraft({ ...draft, website: e.target.value || null })}
              placeholder="https://"
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Internal notes">
            <textarea
              value={draft.notes || ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
              rows={3}
              className="w-full border border-border-strong rounded px-3 py-2 text-[13px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          {err && <div className="text-[11.5px] text-danger-700">{err}</div>}
          <div className="flex justify-end">
            <button
              onClick={save}
              disabled={saving || !draft.name.trim()}
              className="h-9 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <CheckIcon size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-ink">Profile</h3>
        <button
          onClick={() => setEditing(true)}
          className="text-[11px] text-ink-muted hover:text-brand-700 inline-flex items-center gap-1"
        >
          <PencilIcon size={11} /> Edit
        </button>
      </div>

      {/* Primary contact block */}
      {(client.vat_contact_name || client.vat_contact_email || client.vat_contact_phone) ? (
        <div className="space-y-1.5">
          {client.vat_contact_name && (
            <div className="text-[13px] text-ink">
              <span className="font-medium">{client.vat_contact_name}</span>
              {client.vat_contact_role && <span className="text-ink-muted"> · {client.vat_contact_role}</span>}
            </div>
          )}
          <div className="flex flex-col gap-1">
            {client.vat_contact_email && (
              <a
                href={`mailto:${client.vat_contact_email}`}
                className="text-[12px] text-brand-600 hover:underline inline-flex items-center gap-1.5 w-fit"
              >
                <MailIcon size={12} /> {client.vat_contact_email}
              </a>
            )}
            {client.vat_contact_phone && (
              <a
                href={`tel:${client.vat_contact_phone}`}
                className="text-[12px] text-ink-soft hover:text-ink inline-flex items-center gap-1.5 w-fit"
              >
                <PhoneIcon size={12} /> {client.vat_contact_phone}
              </a>
            )}
            {client.address && (
              <div className="text-[12px] text-ink-soft inline-flex items-start gap-1.5">
                <MapPinIcon size={12} className="mt-0.5 shrink-0" /> {client.address}
              </div>
            )}
            {client.website && (
              <a
                href={client.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-brand-600 hover:underline inline-flex items-center gap-1.5 w-fit"
              >
                <GlobeIcon size={12} /> {client.website}
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-ink-muted italic">
          No primary contact set.{' '}
          <button
            onClick={() => setEditing(true)}
            className="text-brand-600 not-italic hover:underline font-medium"
          >
            Add one →
          </button>
        </div>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: Client['kind'] }) {
  const config = {
    end_client: { label: 'End client', colour: 'bg-brand-50 text-brand-700 border-brand-200' },
    csp:        { label: 'CSP',        colour: 'bg-purple-50 text-purple-700 border-purple-200' },
    other:      { label: 'Other',      colour: 'bg-surface-alt text-ink-soft border-border' },
  }[kind];
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${config.colour}`}>
      {config.label}
    </span>
  );
}

function VatStatusChip({ status }: { status: string }) {
  const config: Record<string, { label: string; colour: string }> = {
    registered:           { label: 'Registered',  colour: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
    pending_registration: { label: 'Pending',     colour: 'bg-warning-100 text-warning-800 border-warning-200' },
    not_applicable:       { label: 'No VAT',      colour: 'bg-surface-alt text-ink-soft border-border' },
  };
  const c = config[status] ?? { label: status, colour: 'bg-surface-alt text-ink-soft border-border' };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border shrink-0 ${c.colour}`}>
      {c.label}
    </span>
  );
}

function DeclAction({
  count, verb, cta, href, tone,
}: { count: number; verb: string; cta: string; href: string; tone: 'warning' | 'info' }) {
  const colours = {
    warning: 'text-warning-800',
    info: 'text-ink',
  }[tone];
  return (
    <Link
      href={href}
      className="block py-2 -mx-1 px-1 rounded hover:bg-surface-alt/40 transition-colors"
    >
      <div className="flex items-baseline gap-2">
        <span className={`text-[18px] font-bold tabular-nums ${colours}`}>{count}</span>
        <span className="text-[12px] text-ink-soft">{verb}</span>
      </div>
      <div className="text-[11px] text-brand-600 font-medium mt-0.5">{cta} →</div>
    </Link>
  );
}

function Field({
  label, children,
}: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
