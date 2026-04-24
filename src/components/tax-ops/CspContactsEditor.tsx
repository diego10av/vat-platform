'use client';

// CSP contacts editor — list of {name, email, role} objects with
// +/- row controls. Used on filing detail (override) and entity
// detail (defaults).

import { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';

export interface CspContact {
  name: string;
  email?: string;
  role?: string;
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
        <span className="text-[12px] text-ink-muted italic">
          {fallbackLabel ?? 'No contacts set'}
        </span>
        <button
          onClick={add}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] border border-border rounded-md hover:bg-surface-alt"
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
            className="flex-1 min-w-0 px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
          />
          <input
            value={c.email ?? ''}
            onChange={e => update(i, { email: e.target.value })}
            placeholder="email@example.com"
            className="flex-[1.5] min-w-0 px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
          />
          <input
            value={c.role ?? ''}
            onChange={e => update(i, { role: e.target.value })}
            placeholder="Role"
            className="w-[110px] px-2 py-1 text-[12px] border border-border rounded-md bg-surface"
          />
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
        className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] text-ink-muted hover:text-ink"
      >
        <PlusIcon size={11} /> Add contact
      </button>
    </div>
  );
}
