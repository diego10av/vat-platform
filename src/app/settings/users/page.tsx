'use client';

// ════════════════════════════════════════════════════════════════════════
// /settings/users — firm-admin view for user + cap management.
//
// For each user: display name, email, role, current-month AI spend vs
// cap, an inline cap editor (ladder: 1 / 2 / 5 / 10 / 20 / 30), role
// toggle, deactivate button. "Add user" dialog creates new users.
//
// When the users table isn't yet created (migration 001 pending) we
// show a clean upgrade prompt pointing at the migration file rather
// than erroring out.
// ════════════════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  UsersIcon, PlusIcon, ShieldIcon, TrashIcon, AlertTriangleIcon, Loader2Icon, CheckIcon, XIcon,
} from 'lucide-react';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface User {
  id: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'member';
  monthly_ai_cap_eur: number;
  month_spend_eur: number;
  pct_used: number;
  created_at: string;
  updated_at: string;
  active: boolean;
}

// The per-user cap ladder from docs/MODELS.md §4.
const CAP_LADDER = [1, 2, 5, 10, 20, 30];

export default function UsersPage() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (res.status === 501 && data?.error?.code === 'schema_missing') {
        setSchemaMissing(true);
        setUsers([]);
        return;
      }
      if (!res.ok) {
        setError(data?.error?.message ?? 'Failed to load users.');
        setUsers([]);
        return;
      }
      setUsers(data.users as User[]);
      setSchemaMissing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      setUsers([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patchUser(id: string, patch: Partial<User>): Promise<boolean> {
    setSavingUserId(id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Update failed.');
        return false;
      }
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error.');
      return false;
    } finally {
      setSavingUserId(null);
    }
  }

  async function deactivateUser(id: string, name: string) {
    if (!confirm(`Deactivate ${name}? They will lose access immediately.`)) return;
    setSavingUserId(id);
    setError(null);
    try {
      const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? 'Deactivation failed.');
        return;
      }
      await load();
    } finally {
      setSavingUserId(null);
    }
  }

  if (users === null) return <PageSkeleton />;

  return (
    <div>
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] text-ink-faint mb-1">
            <Link href="/settings" className="hover:underline">Settings</Link> ›
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight flex items-center gap-2">
            <UsersIcon size={18} className="text-brand-500" /> Users &amp; AI caps
          </h1>
          <p className="text-[12.5px] text-ink-muted mt-1 max-w-xl">
            Each user has a monthly AI-spend cap denominated in euros.
            Raise or lower per user on the ladder (€1 / €2 / €5 / €10 /
            €20 / €30). See <a href="/docs" className="underline">docs/MODELS.md §4</a> for the
            pricing rationale.
          </p>
        </div>
        {!schemaMissing && (
          <button
            onClick={() => setShowAdd(true)}
            className="h-8 px-3 rounded-md bg-brand-500 text-white text-[12.5px] font-semibold hover:bg-brand-600 transition-colors inline-flex items-center gap-1.5 shrink-0"
          >
            <PlusIcon size={13} /> Add user
          </button>
        )}
      </div>

      {/* Schema-missing banner */}
      {schemaMissing && <SchemaMissingCard />}

      {/* Error banner */}
      {error && (
        <div className="mb-4 text-[12px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2 flex items-start gap-2">
          <AlertTriangleIcon size={13} className="mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {/* User list */}
      {!schemaMissing && users.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-[12.5px]">
            <thead className="bg-surface-alt border-b border-border text-[10.5px] uppercase tracking-wide font-semibold text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 text-left">User</th>
                <th className="px-4 py-2.5 text-left">Role</th>
                <th className="px-4 py-2.5 text-left">Monthly spend</th>
                <th className="px-4 py-2.5 text-left">Cap</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  saving={savingUserId === u.id}
                  onPatch={(patch) => patchUser(u.id, patch)}
                  onDeactivate={() => deactivateUser(u.id, u.display_name)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!schemaMissing && users.length === 0 && (
        <div className="bg-surface border border-border rounded-lg p-8 text-center">
          <div className="w-10 h-10 mx-auto rounded-lg bg-surface-alt text-ink-muted inline-flex items-center justify-center mb-3">
            <UsersIcon size={16} />
          </div>
          <div className="text-[13px] font-medium text-ink">No users yet</div>
          <div className="text-[11.5px] text-ink-muted mt-1.5 max-w-sm mx-auto">
            The founder row is seeded by migration 001. If you see this,
            the migration ran but the seed row is missing — re-run the
            <code className="mx-1">INSERT INTO users</code> block.
          </div>
        </div>
      )}

      {showAdd && (
        <AddUserDialog
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── subcomponents ───────────────────────────

function UserRow({
  user, saving, onPatch, onDeactivate,
}: {
  user: User;
  saving: boolean;
  onPatch: (patch: Partial<User>) => Promise<boolean>;
  onDeactivate: () => void;
}) {
  const capPct = Math.min(100, Math.round(user.pct_used * 100));
  const isOverSoft = capPct >= 80;
  const isOver = capPct >= 100;

  return (
    <tr className="border-b border-divider last:border-0 hover:bg-surface-alt/40 transition-colors">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{user.display_name}</div>
        <div className="text-[11px] text-ink-muted mt-0.5">
          {user.email || <span className="italic">no email</span>}
          <span className="mx-1.5 text-ink-faint">·</span>
          <span className="font-mono">{user.id}</span>
        </div>
      </td>
      <td className="px-4 py-3">
        <button
          onClick={() => onPatch({ role: user.role === 'admin' ? 'member' : 'admin' })}
          disabled={saving}
          className={[
            'inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-semibold border transition-colors cursor-pointer disabled:opacity-50',
            user.role === 'admin'
              ? 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100'
              : 'bg-surface text-ink-soft border-border hover:bg-surface-alt',
          ].join(' ')}
          title="Click to toggle admin / member"
        >
          <ShieldIcon size={10} /> {user.role}
        </button>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 rounded-full bg-surface-alt overflow-hidden">
            <div
              className={[
                'h-full transition-all',
                isOver ? 'bg-danger-500' : isOverSoft ? 'bg-warning-500' : 'bg-brand-500',
              ].join(' ')}
              style={{ width: `${capPct}%` }}
            />
          </div>
          <span className="tabular-nums text-[11.5px] text-ink-soft">
            €{user.month_spend_eur.toFixed(2)} <span className="text-ink-faint">/ €{user.monthly_ai_cap_eur.toFixed(2)}</span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3">
        <select
          value={user.monthly_ai_cap_eur}
          onChange={(e) => onPatch({ monthly_ai_cap_eur: Number(e.target.value) })}
          disabled={saving}
          className="h-7 px-2 rounded border border-border-strong text-[11.5px] bg-surface cursor-pointer focus:border-brand-500 focus:outline-none"
        >
          {/* If the current cap is off the ladder (e.g. €50 seeded for founder), keep it as an option. */}
          {!CAP_LADDER.includes(user.monthly_ai_cap_eur) && (
            <option value={user.monthly_ai_cap_eur}>€{user.monthly_ai_cap_eur.toFixed(2)}</option>
          )}
          {CAP_LADDER.map((v) => (
            <option key={v} value={v}>€{v}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-3 text-right">
        {saving ? (
          <Loader2Icon size={13} className="animate-spin text-ink-muted inline" />
        ) : (
          <button
            onClick={onDeactivate}
            className="inline-flex items-center gap-1 h-7 px-2 rounded text-[11px] font-medium text-ink-muted hover:text-danger-600 hover:bg-danger-50 transition-colors cursor-pointer"
            title="Deactivate user"
          >
            <TrashIcon size={12} />
          </button>
        )}
      </td>
    </tr>
  );
}

function SchemaMissingCard() {
  return (
    <div className="mb-6 rounded-xl border border-warning-200 bg-gradient-to-br from-warning-50 to-surface p-5 flex items-start gap-4">
      <div className="w-9 h-9 rounded-lg bg-warning-500 text-white inline-flex items-center justify-center shrink-0">
        <AlertTriangleIcon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-[14px] font-semibold text-ink">Migration not applied</h3>
        <p className="text-[12.5px] text-ink-soft mt-1 leading-relaxed">
          The <code className="text-[11.5px] bg-surface-alt px-1 py-0.5 rounded">users</code> table
          doesn't exist yet. This screen is read-only until you apply migration 001 in
          Supabase SQL Editor.
        </p>
        <ol className="text-[12px] text-ink-soft mt-3 space-y-1 list-decimal pl-5 leading-relaxed">
          <li>Open <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-brand-600 underline">Supabase dashboard</a> → SQL Editor</li>
          <li>Paste the contents of <code className="text-[11.5px] bg-surface-alt px-1 py-0.5 rounded">migrations/001_per_user_ai_budget_and_chat.sql</code></li>
          <li>Click Run — idempotent, safe to re-run</li>
          <li>Refresh this page</li>
        </ol>
        <p className="text-[11.5px] text-ink-muted mt-3">
          Until then, the chat and the rest of the app keep working with the founder account
          and no per-user cap enforcement (firm-wide €75/mo budget still applies).
        </p>
      </div>
    </div>
  );
}

function AddUserDialog({
  onClose, onCreated,
}: { onClose: () => void; onCreated: () => void }) {
  const [id, setId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [cap, setCap] = useState(2);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: id.trim(), display_name: displayName.trim(),
          email: email.trim() || null, role, monthly_ai_cap_eur: cap,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data?.error?.message ?? 'Failed to create user.');
        return;
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fadeIn"
      role="presentation"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="bg-surface rounded-lg w-full max-w-md shadow-2xl"
        role="dialog"
        aria-modal="true"
      >
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-ink">Add user</h3>
          <button type="button" onClick={onClose} className="w-8 h-8 inline-flex items-center justify-center rounded-md hover:bg-surface-alt text-ink-soft">
            <XIcon size={15} />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="User id *" hint="Short, URL-safe. 2–40 chars, letters/digits/_/-.">
            <input
              value={id} onChange={e => setId(e.target.value)}
              placeholder="e.g. maria-l"
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Display name *">
            <input
              value={displayName} onChange={e => setDisplayName(e.target.value)}
              placeholder="Maria L."
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Email">
            <input
              type="email"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="maria@example.com"
              className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select
                value={role} onChange={e => setRole(e.target.value as 'admin' | 'member')}
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Field label="Monthly AI cap">
              <select
                value={cap} onChange={e => setCap(Number(e.target.value))}
                className="w-full border border-border-strong rounded px-2 py-1.5 text-[12.5px] focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                {CAP_LADDER.map(v => <option key={v} value={v}>€{v}</option>)}
              </select>
            </Field>
          </div>

          {err && (
            <div className="text-[11.5px] text-danger-700 bg-danger-50 border border-danger-200 rounded px-3 py-2">
              {err}
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-9 px-4 rounded border border-border-strong text-[12px] font-medium text-ink-soft hover:bg-surface-alt">
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !id.trim() || !displayName.trim()}
            className="h-9 px-4 rounded bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 disabled:opacity-50 inline-flex items-center gap-1.5"
          >
            {saving ? <><Loader2Icon size={13} className="animate-spin" /> Creating…</> : <><CheckIcon size={13} /> Create</>}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[10.5px] text-ink-faint mt-1">{hint}</span>}
    </label>
  );
}
