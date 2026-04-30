'use client';

// CSP contacts editor — list of {name, email, role, kind} objects with
// +/- row controls. Used on filing detail (override) and entity
// detail (defaults).
//
// Stint 64.X.6 — added optional `kind` so each contact carries its
// classification per Big-4 best practice. Diego: "los contactos
// pueden ser clientes, peers, etc — no sólo CSP." Backwards-compat:
// missing kind treated as 'csp' (the historical default that the
// schema field name implies). The editor exposes a dropdown so Diego
// can override per row. The matrix contacts column reads the kind
// to render a small classification chip next to the name.

import { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';

export type ContactKind = 'client' | 'csp' | 'peer' | 'internal' | 'other';

export const CONTACT_KINDS: ContactKind[] = ['client', 'csp', 'peer', 'internal', 'other'];

export const CONTACT_KIND_LABEL: Record<ContactKind, string> = {
  client:   'Client',
  csp:      'CSP',
  peer:     'Peer',
  internal: 'Internal',
  other:    'Other',
};

export const CONTACT_KIND_TONE: Record<ContactKind, string> = {
  client:   'bg-brand-50 text-brand-700 border border-brand-100',
  csp:      'bg-amber-50 text-amber-800 border border-amber-100',
  peer:     'bg-emerald-50 text-emerald-700 border border-emerald-100',
  internal: 'bg-info-50 text-info-700 border border-info-100',
  other:    'bg-surface-alt text-ink-muted border border-border',
};

export interface CspContact {
  name: string;
  email?: string;
  role?: string;
  /** Stint 64.X.6 — classification per Big-4 convention. */
  kind?: ContactKind;
}

export function CspContactsEditor({
  value, onChange, fallbackLabel,
}: {
  value: CspContact[];
  onChange: (next: CspContact[]) => void;
  fallbackLabel?: string;  // shown when list is empty
}) {
  const [local, setLocal] = useState<CspContact[]>(value);

  function commit(next: CspContact[]) {
    setLocal(next);
    onChange(next);
  }

  function add() {
    commit([...local, { name: '' }]);
  }

  function remove(i: number) {
    const next = [...local];
    next.splice(i, 1);
    commit(next);
  }

  function update(i: number, patch: Partial<CspContact>) {
    const next = [...local];
    next[i] = { ...next[i], ...patch, name: patch.name ?? next[i]!.name };
    commit(next);
  }

  if (local.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-ink-muted italic">
          {fallbackLabel ?? 'No contacts set'}
        </span>
        <button
          onClick={add}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-border rounded-md hover:bg-surface-alt"
        >
          <PlusIcon size={11} /> Add
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {local.map((c, i) => (
        <div key={i} className="flex gap-1.5 items-center">
          <input
            value={c.name}
            onChange={e => update(i, { name: e.target.value })}
            placeholder="Name"
            className="flex-1 min-w-0 px-2 py-1 text-sm border border-border rounded-md bg-surface"
          />
          <input
            value={c.email ?? ''}
            onChange={e => update(i, { email: e.target.value })}
            placeholder="email@example.com"
            className="flex-[1.5] min-w-0 px-2 py-1 text-sm border border-border rounded-md bg-surface"
          />
          <input
            value={c.role ?? ''}
            onChange={e => update(i, { role: e.target.value })}
            placeholder="Role"
            className="w-[110px] px-2 py-1 text-sm border border-border rounded-md bg-surface"
          />
          {/* Stint 64.X.6 — kind dropdown. Defaults to 'csp' for
              consistency with historical data, but Diego can switch
              to client / peer / internal / other per row. */}
          <select
            value={c.kind ?? 'csp'}
            onChange={e => update(i, { kind: e.target.value as ContactKind })}
            aria-label="Contact kind"
            className="w-[100px] px-1.5 py-1 text-xs border border-border rounded-md bg-surface"
          >
            {CONTACT_KINDS.map(k => (
              <option key={k} value={k}>{CONTACT_KIND_LABEL[k]}</option>
            ))}
          </select>
          <button
            onClick={() => remove(i)}
            aria-label="Remove contact"
            className="p-1 text-ink-muted hover:text-danger-600"
          >
            <Trash2Icon size={13} />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-ink-muted hover:text-ink"
      >
        <PlusIcon size={11} /> Add contact
      </button>
    </div>
  );
}
