'use client';

// ════════════════════════════════════════════════════════════════════════
// ApproversCard — manages the list of approvers for a given entity.
//
// Sits on the entity detail page. Each approver card shows the info a
// reviewer actually needs: name, role, organisation, country, and
// tap-to-call / tap-to-email links. You can:
//   - Add a new approver (modal form)
//   - Edit inline (role, organisation, etc.)
//   - Promote to primary (only one primary per entity; the server
//     atomically swaps when you promote someone else)
//   - Delete (if you delete the primary, the server auto-promotes the
//     next by sort_order, so the entity is never left without a primary
//     unless it's the last one)
//
// Applied PROTOCOLS §11: every number / badge has a meaning.
//   - Approver count → tells you if you have coverage.
//   - "Primary" badge → tells you who the share-link defaults to.
//   - Country pill → tells you the timezone cost of calling them.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  UsersIcon, PlusIcon, MailIcon, PhoneIcon, TrashIcon, StarIcon,
  PencilIcon, XIcon, CheckIcon, Loader2Icon, AlertTriangleIcon,
} from 'lucide-react';

type ApproverType = 'client' | 'csp' | 'other';

interface Approver {
  id: string;
  entity_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  organization: string | null;
  country: string | null;
  approver_type: ApproverType;
  is_primary: boolean;
  sort_order: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function ApproversCard({ entityId }: { entityId: string }) {
  const [approvers, setApprovers] = useState<Approver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/entities/${entityId}/approvers`);
      const data = await res.json();
      if (data?.schema_missing) {
        setSchemaMissing(true);
        setApprovers([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load approvers.');
        setApprovers([]);
        return;
      }
      setApprovers(data.approvers as Approver[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setApprovers([]);
    }
  }, [entityId]);

  useEffect(() => { load(); }, [load]);

  async function promoteToPrimary(id: string) {
    try {
      const res = await fetch(`/api/entities/${entityId}/approvers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_primary: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? 'Could not promote.');
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove ${name} as an approver?`)) return;
    try {
      const res = await fetch(`/api/entities/${entityId}/approvers/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error?.message ?? 'Could not remove.');
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    }
  }

  if (approvers === null) {
    return (
      <div className="bg-surface border border-border rounded-lg p-4 mb-4">
        <div className="text-[12px] text-ink-muted flex items-center gap-2">
          <Loader2Icon size={13} className="animate-spin" /> Loading approvers…
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-border rounded-lg mb-4 overflow-hidden">
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <div className="flex items-center gap-2">
          <UsersIcon size={15} className="text-brand-500" />
          <h3 className="text-[13px] font-semibold text-ink">VAT approvers</h3>
          <span className="text-[11px] text-ink-muted">
            {approvers.length} {approvers.length === 1 ? 'person' : 'people'}
          </span>
        </div>
        {!schemaMissing && (
          <button
            onClick={() => setAdding(true)}
            className="text-[11.5px] font-medium text-brand-600 hover:text-brand-800 inline-flex items-center gap-1"
          >
            <PlusIcon size={11} /> Add approver
          </button>
        )}
      </div>

      {schemaMissing && (
        <div className="p-4 text-[12px] text-warning-800 bg-warning-50 border-b border-warning-200">
          <AlertTriangleIcon size={12} className="inline mr-1 -mt-0.5" />
          Approvers require migration 005. Apply it in Supabase to enable
          this section.
        </div>
      )}

      {error && (
        <div className="px-4 py-2 text-[11.5px] text-danger-700 bg-danger-50 border-b border-danger-200">
          {error}
        </div>
      )}

      {!schemaMissing && approvers.length === 0 && !adding && (
        <div className="p-6 text-center">
          <div className="text-[12.5px] text-ink-muted max-w-sm mx-auto leading-relaxed">
            No approvers set. Add at least one person who signs off on
            this entity&apos;s VAT declarations. Their email is used for
            the approval portal link and for the draft email.
          </div>
          <button
            onClick={() => setAdding(true)}
            className="mt-4 h-9 px-4 rounded-md bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 inline-flex items-center gap-1.5"
          >
            <PlusIcon size={13} /> Add first approver
          </button>
        </div>
      )}

      {!schemaMissing && approvers.length > 0 && (
        <ul className="divide-y divide-divider">
          {approvers.map((a) => (
            <li key={a.id}>
              {editingId === a.id ? (
                <ApproverEditor
                  entityId={entityId}
                  approver={a}
                  onClose={() => setEditingId(null)}
                  onSaved={async () => { setEditingId(null); await load(); }}
                />
              ) : (
                <ApproverRow
                  approver={a}
                  onPromote={() => promoteToPrimary(a.id)}
                  onEdit={() => setEditingId(a.id)}
                  onDelete={() => remove(a.id, a.name)}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="border-t border-divider p-4 bg-surface-alt/40">
          <ApproverEditor
            entityId={entityId}
            onClose={() => setAdding(false)}
            onSaved={async () => { setAdding(false); await load(); }}
            fresh
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── subcomponents ───────────────────────────

function ApproverRow({
  approver, onPromote, onEdit, onDelete,
}: {
  approver: Approver;
  onPromote: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="px-4 py-3 flex items-start gap-3 hover:bg-surface-alt/40 transition-colors">
      <TypeBadge type={approver.approver_type} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-ink">{approver.name}</span>
          {approver.is_primary && (
            <span className="inline-flex items-center gap-0.5 text-[9.5px] font-bold uppercase tracking-wider bg-brand-500 text-white rounded px-1.5 py-0.5">
              <StarIcon size={9} /> Primary
            </span>
          )}
          {approver.country && (
            <span className="text-[10px] font-mono text-ink-muted bg-surface-alt px-1.5 py-0.5 rounded">
              {approver.country}
            </span>
          )}
        </div>
        <div className="text-[11.5px] text-ink-muted mt-0.5">
          {approver.role && <span>{approver.role}</span>}
          {approver.role && approver.organization && <span className="text-ink-faint mx-1">·</span>}
          {approver.organization && <span>{approver.organization}</span>}
        </div>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          {approver.email && (
            <a
              href={`mailto:${approver.email}`}
              className="text-[11.5px] text-brand-600 hover:underline inline-flex items-center gap-1"
            >
              <MailIcon size={11} /> {approver.email}
            </a>
          )}
          {approver.phone && (
            <a
              href={`tel:${approver.phone}`}
              className="text-[11.5px] text-ink-soft hover:text-ink inline-flex items-center gap-1"
            >
              <PhoneIcon size={11} /> {approver.phone}
            </a>
          )}
        </div>
        {approver.notes && (
          <div className="mt-1.5 text-[11px] text-ink-muted italic bg-surface-alt rounded px-2 py-1">
            {approver.notes}
          </div>
        )}
      </div>

      <div className="flex items-center gap-0.5 shrink-0">
        {!approver.is_primary && (
          <button
            onClick={onPromote}
            title="Make this the primary approver"
            aria-label="Promote to primary"
            className="w-7 h-7 inline-flex items-center justify-center rounded text-ink-muted hover:bg-brand-50 hover:text-brand-700 transition-colors"
          >
            <StarIcon size={13} />
          </button>
        )}
        <button
          onClick={onEdit}
          title="Edit"
          aria-label="Edit"
          className="w-7 h-7 inline-flex items-center justify-center rounded text-ink-muted hover:bg-surface-alt hover:text-ink transition-colors"
        >
          <PencilIcon size={12} />
        </button>
        <button
          onClick={onDelete}
          title="Remove"
          aria-label="Remove approver"
          className="w-7 h-7 inline-flex items-center justify-center rounded text-ink-muted hover:bg-danger-50 hover:text-danger-700 transition-colors"
        >
          <TrashIcon size={12} />
        </button>
      </div>
    </div>
  );
}

function ApproverEditor({
  entityId, approver, onClose, onSaved, fresh,
}: {
  entityId: string;
  approver?: Approver;
  onClose: () => void;
  onSaved: () => void;
  fresh?: boolean;
}) {
  const [form, setForm] = useState({
    name: approver?.name ?? '',
    email: approver?.email ?? '',
    phone: approver?.phone ?? '',
    role: approver?.role ?? '',
    organization: approver?.organization ?? '',
    country: approver?.country ?? '',
    approver_type: (approver?.approver_type ?? 'client') as ApproverType,
    is_primary: approver?.is_primary ?? false,
    notes: approver?.notes ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!form.name.trim()) {
      setErr('Name is required.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        role: form.role.trim() || null,
        organization: form.organization.trim() || null,
        country: form.country.trim().toUpperCase().slice(0, 2) || null,
        approver_type: form.approver_type,
        is_primary: form.is_primary,
        notes: form.notes.trim() || null,
      };
      const url = approver
        ? `/api/entities/${entityId}/approvers/${approver.id}`
        : `/api/entities/${entityId}/approvers`;
      const method = approver ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error?.message ?? 'Could not save.');
        return;
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={fresh ? '' : 'px-4 py-3 bg-surface-alt/40'}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-ink">
          {approver ? 'Edit approver' : 'Add approver'}
        </h4>
        <button
          onClick={onClose}
          className="w-7 h-7 inline-flex items-center justify-center rounded hover:bg-surface-alt text-ink-muted"
          aria-label="Cancel"
        >
          <XIcon size={13} />
        </button>
      </div>

      <div className="space-y-3">
        <Field label="Name" required>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Maria Kowalski"
            className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Role / title" hint="e.g. Head of Finance, Director">
            <input
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Organisation" hint="CSP name or client HQ">
            <input
              value={form.organization}
              onChange={(e) => setForm({ ...form, organization: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Phone">
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+352 …"
              className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Country (ISO-2)">
            <input
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase().slice(0, 2) })}
              maxLength={2}
              placeholder="LU"
              className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Side" hint="CSP, client-side, or other">
            <select
              value={form.approver_type}
              onChange={(e) => setForm({ ...form, approver_type: e.target.value as ApproverType })}
              className="w-full border border-border-strong rounded px-3 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="client">Client side</option>
              <option value="csp">CSP side</option>
              <option value="other">Other</option>
            </select>
          </Field>
        </div>

        <Field label="Notes (optional)">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            placeholder="Availability, escalation path, holiday schedule…"
            className="w-full border border-border-strong rounded px-3 py-1.5 text-[12px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none"
          />
        </Field>

        {/* Primary toggle — only shown on create, or when editing an
            existing non-primary. Promoting a non-primary to primary is
            allowed via this checkbox; demoting is blocked by the server
            (use another approver's promote button instead). */}
        {(!approver || !approver.is_primary) && (
          <label className="flex items-start gap-2 text-[12px] text-ink-soft cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_primary}
              onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
              className="mt-0.5"
            />
            <span>
              <strong className="text-ink">Make primary approver.</strong>{' '}
              The portal share link defaults to this person&apos;s email; others are cc&apos;d.
            </span>
          </label>
        )}

        {err && (
          <div className="text-[11.5px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
            {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="h-8 px-3 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !form.name.trim()}
            className="h-8 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <Loader2Icon size={12} className="animate-spin" /> : <CheckIcon size={12} />}
            {approver ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: ApproverType }) {
  const config = {
    client: { label: 'Client', colour: 'bg-brand-50 text-brand-700 border-brand-200' },
    csp:    { label: 'CSP',    colour: 'bg-purple-50 text-purple-700 border-purple-200' },
    other:  { label: 'Other',  colour: 'bg-surface-alt text-ink-soft border-border' },
  }[type];
  return (
    <span className={`text-[9.5px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border shrink-0 mt-1 ${config.colour}`}>
      {config.label}
    </span>
  );
}

function Field({
  label, hint, required, children,
}: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
        {label} {required && <span className="text-danger-600">*</span>}
        {hint && <span className="normal-case text-ink-faint font-normal ml-1">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}
