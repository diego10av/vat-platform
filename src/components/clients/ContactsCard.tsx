'use client';

// ════════════════════════════════════════════════════════════════════════
// Client contacts card — shipped stint 11 (2026-04-19).
//
// Lives under /clients/[id]. Lists every client_contact row, lets the
// reviewer add / edit / delete, and marks exactly one "main" contact.
// Entity approvers can later link to these contacts (see
// entity_approvers.client_contact_id) so the same fund manager is
// re-usable across every entity under the client.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import {
  PlusIcon, PencilIcon, Trash2Icon, StarIcon, CheckIcon, XIcon,
  MailIcon, PhoneIcon,
} from 'lucide-react';
import { describeApiError, formatUiError } from '@/lib/ui-errors';

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  organization: string | null;
  country: string | null;
  is_main: boolean;
  notes: string | null;
}

export function ContactsCard({ clientId }: { clientId: string }) {
  const [contacts, setContacts] = useState<ClientContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/clients/${clientId}/contacts`);
      if (!res.ok) {
        const e = await describeApiError(res, 'Could not load the contacts for this client.');
        setError(formatUiError(e));
        return;
      }
      const body = await res.json();
      setContacts(body.contacts ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const mainCount = contacts.filter(c => c.is_main).length;

  return (
    <div className="bg-surface border border-border rounded-lg">
      <div className="px-4 py-3 border-b border-divider flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[13px] font-semibold text-ink">Contacts</h3>
          <span className="text-[11px] text-ink-muted tabular-nums">
            {contacts.length}
            {mainCount === 0 && contacts.length > 0 && (
              <span className="text-amber-600"> · no main set</span>
            )}
          </span>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="h-7 px-2.5 rounded-md bg-surface-alt border border-border-strong text-[11.5px] font-medium text-ink-soft hover:text-ink hover:bg-surface inline-flex items-center gap-1"
          >
            <PlusIcon size={12} /> Add contact
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 bg-danger-50 text-danger-800 text-[11.5px] border-b border-danger-200">
          {error}
        </div>
      )}

      {adding && (
        <ContactForm
          clientId={clientId}
          onSaved={() => { setAdding(false); load(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {loading && contacts.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-ink-muted text-center">Loading…</div>
      ) : contacts.length === 0 && !adding ? (
        <div className="px-4 py-8 text-center">
          <div className="text-[13px] text-ink-muted">No contacts yet</div>
          <button
            onClick={() => setAdding(true)}
            className="inline-block mt-3 text-[12px] font-medium text-brand-600 hover:underline"
          >
            Add the first one →
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-divider">
          {contacts.map(c => (
            <li key={c.id}>
              {editingId === c.id ? (
                <ContactForm
                  clientId={clientId}
                  contact={c}
                  onSaved={() => { setEditingId(null); load(); }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <ContactRow
                  contact={c}
                  onEdit={() => setEditingId(c.id)}
                  onDeleted={load}
                  onMainToggled={load}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="px-4 py-2 border-t border-divider text-[10.5px] text-ink-faint">
        Contacts are re-usable: when you add an entity approver, pick from this list instead of typing the same details again.
      </div>
    </div>
  );
}

// ───────────────────────── Subcomponents ─────────────────────────

function ContactRow({
  contact, onEdit, onDeleted, onMainToggled,
}: {
  contact: ClientContact;
  onEdit: () => void;
  onDeleted: () => void;
  onMainToggled: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function promoteToMain() {
    if (contact.is_main) return;
    setBusy(true);
    try {
      await fetch(`/api/clients/${contact.client_id}/contacts/${contact.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_main: true }),
      });
      onMainToggled();
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!confirm(`Remove ${contact.name}? Any entity approvers linked to this contact will be unlinked (kept as-is with the stored copy of their details).`)) return;
    setBusy(true);
    try {
      await fetch(`/api/clients/${contact.client_id}/contacts/${contact.id}`, { method: 'DELETE' });
      onDeleted();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 py-3 flex items-start gap-3 hover:bg-surface-alt/40 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="text-[13px] font-medium text-ink truncate">{contact.name}</div>
          {contact.is_main && (
            <span className="text-[9.5px] uppercase tracking-wide font-semibold bg-brand-50 text-brand-700 px-1.5 py-0.5 rounded border border-brand-100 inline-flex items-center gap-0.5">
              <StarIcon size={9} className="fill-brand-500 stroke-brand-500" /> Main
            </span>
          )}
          {contact.role && (
            <span className="text-[11px] text-ink-muted">· {contact.role}</span>
          )}
          {contact.country && (
            <span className="text-[10.5px] font-mono text-ink-muted">· {contact.country}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-3 text-[11.5px] text-ink-muted">
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="inline-flex items-center gap-1 hover:text-brand-600 truncate"
            >
              <MailIcon size={11} /> {contact.email}
            </a>
          )}
          {contact.phone && (
            <a
              href={`tel:${contact.phone}`}
              className="inline-flex items-center gap-1 hover:text-brand-600"
            >
              <PhoneIcon size={11} /> {contact.phone}
            </a>
          )}
        </div>
        {contact.notes && (
          <div className="mt-1 text-[11px] text-ink-muted italic whitespace-pre-wrap">
            {contact.notes}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {!contact.is_main && (
          <button
            onClick={promoteToMain}
            disabled={busy}
            title="Make main contact"
            className="p-1.5 rounded hover:bg-surface-alt text-ink-muted hover:text-brand-600 disabled:opacity-50"
          >
            <StarIcon size={12} />
          </button>
        )}
        <button
          onClick={onEdit}
          disabled={busy}
          title="Edit"
          className="p-1.5 rounded hover:bg-surface-alt text-ink-muted hover:text-ink disabled:opacity-50"
        >
          <PencilIcon size={12} />
        </button>
        <button
          onClick={del}
          disabled={busy}
          title="Remove"
          className="p-1.5 rounded hover:bg-danger-50 text-ink-muted hover:text-danger-700 disabled:opacity-50"
        >
          <Trash2Icon size={12} />
        </button>
      </div>
    </div>
  );
}

function ContactForm({
  clientId, contact, onSaved, onCancel,
}: {
  clientId: string;
  contact?: ClientContact;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const editing = !!contact;
  const [draft, setDraft] = useState<Partial<ClientContact>>(
    contact ?? {
      name: '', email: null, phone: null, role: null,
      organization: null, country: null, is_main: false, notes: null,
    },
  );
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!draft.name || draft.name.trim().length === 0) {
      setErr('Name is required.');
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      const url = editing
        ? `/api/clients/${clientId}/contacts/${contact!.id}`
        : `/api/clients/${clientId}/contacts`;
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const e = await describeApiError(res, editing ? 'Could not update this contact.' : 'Could not add this contact.');
        setErr(formatUiError(e));
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
    <div className="px-4 py-3 bg-surface-alt/40 border-b border-divider">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-semibold text-ink">
          {editing ? 'Edit contact' : 'New contact'}
        </div>
        <button
          onClick={onCancel}
          className="p-1 text-ink-muted hover:text-ink"
          aria-label="Cancel"
        >
          <XIcon size={13} />
        </button>
      </div>

      {err && (
        <div className="mb-2 px-2 py-1 bg-danger-50 border border-danger-200 text-[11px] text-danger-800 rounded">
          {err}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <FormField label="Name *">
          <input
            value={draft.name ?? ''}
            onChange={e => setDraft({ ...draft, name: e.target.value })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
        <FormField label="Role">
          <input
            value={draft.role ?? ''}
            onChange={e => setDraft({ ...draft, role: e.target.value || null })}
            placeholder="CFO, Head of Finance…"
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
        <FormField label="Email">
          <input
            type="email"
            value={draft.email ?? ''}
            onChange={e => setDraft({ ...draft, email: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
        <FormField label="Phone">
          <input
            value={draft.phone ?? ''}
            onChange={e => setDraft({ ...draft, phone: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
        <FormField label="Organisation">
          <input
            value={draft.organization ?? ''}
            onChange={e => setDraft({ ...draft, organization: e.target.value || null })}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
        <FormField label="Country (ISO-2)">
          <input
            value={draft.country ?? ''}
            onChange={e => setDraft({ ...draft, country: e.target.value.toUpperCase().slice(0, 2) || null })}
            maxLength={2}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
      </div>

      <div className="mt-2">
        <FormField label="Notes">
          <textarea
            value={draft.notes ?? ''}
            onChange={e => setDraft({ ...draft, notes: e.target.value || null })}
            rows={2}
            className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </FormField>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <label className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-soft cursor-pointer">
          <input
            type="checkbox"
            checked={!!draft.is_main}
            onChange={e => setDraft({ ...draft, is_main: e.target.checked })}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          Main contact
        </label>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="h-7 px-3 rounded border border-border-strong text-[11.5px] text-ink-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="h-7 px-3 rounded bg-brand-500 text-white text-[11.5px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <CheckIcon size={12} /> {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted mb-0.5">
        {label}
      </div>
      {children}
    </label>
  );
}
