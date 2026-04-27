'use client';

// Stint 56.A — multi-stakeholder sign-off card on the task detail page.
//
// Diego: Big4 cascade. Preparer signs first, reviewer second (gated on
// preparer), partner third (gated on reviewer). Each step takes a
// signer name + auto-stamps the timestamp. Re-signing the same role
// with a different name overwrites; clicking a signed checkbox unsigns
// the role (and cascades downstream to the right of it).

import { useState } from 'react';
import { CheckIcon } from 'lucide-react';
import { useToast } from '@/components/Toaster';

export interface SignoffSnapshot {
  preparer: string | null;
  preparer_at: string | null;
  reviewer: string | null;
  reviewer_at: string | null;
  partner_sign_off: string | null;
  partner_sign_off_at: string | null;
}

const ROLE_DEFS: Array<{ key: 'preparer' | 'reviewer' | 'partner'; label: string }> = [
  { key: 'preparer', label: 'Preparer' },
  { key: 'reviewer', label: 'Reviewer' },
  { key: 'partner',  label: 'Partner sign-off' },
];

function getName(snap: SignoffSnapshot, role: 'preparer' | 'reviewer' | 'partner'): string | null {
  if (role === 'partner') return snap.partner_sign_off;
  return snap[role];
}

function getAt(snap: SignoffSnapshot, role: 'preparer' | 'reviewer' | 'partner'): string | null {
  if (role === 'partner') return snap.partner_sign_off_at;
  return snap[`${role}_at` as 'preparer_at' | 'reviewer_at'];
}

function formatTs(ts: string | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

interface Props {
  taskId: string;
  snapshot: SignoffSnapshot;
  defaultSigner?: string;       // suggested name (e.g. assignee or "Diego")
  onChanged: () => void;
}

export function TaskSignoffCard({ taskId, snapshot, defaultSigner, onChanged }: Props) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function sign(role: 'preparer' | 'reviewer' | 'partner', signer: string) {
    setBusy(role);
    try {
      const res = await fetch(`/api/tax-ops/tasks/${taskId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, signer }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.hint ?? b?.error ?? `HTTP ${res.status}`);
      }
      toast.success(signer === '' ? `${role} unsigned` : `${role} signed by ${signer}`);
      onChanged();
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(null);
    }
  }

  const preparerSigned = !!snapshot.preparer;
  const reviewerSigned = !!snapshot.reviewer;

  function isLocked(role: 'preparer' | 'reviewer' | 'partner'): boolean {
    if (role === 'reviewer') return !preparerSigned;
    if (role === 'partner')  return !reviewerSigned;
    return false;
  }

  // Stint 58.T3.1 — compacted to a single horizontal row (3 columns).
  // Old 3-row vertical layout dominated the detail page above the title;
  // a single row reads as "this is metadata, not the focus".
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h3 className="text-xs font-semibold text-ink">Sign-off</h3>
        <span className="text-2xs text-ink-muted">
          Preparer → Reviewer → Partner cascade
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {ROLE_DEFS.map(({ key, label }) => {
          const signedName = getName(snapshot, key);
          const signedAt = getAt(snapshot, key);
          const signed = !!signedName;
          const locked = isLocked(key);
          const draftName = drafts[key] ?? defaultSigner ?? '';
          return (
            <div
              key={key}
              className={[
                'flex items-center gap-1.5 px-2 py-1.5 rounded border min-w-0',
                signed ? 'bg-success-50 border-success-200'
                  : locked ? 'bg-surface-alt border-border opacity-60'
                  : 'bg-surface border-border',
              ].join(' ')}
            >
              <button
                type="button"
                onClick={() => signed ? void sign(key, '') : void sign(key, draftName.trim())}
                disabled={locked || busy === key || (!signed && !draftName.trim())}
                aria-label={signed ? `Unsign ${label}` : `Sign as ${label}`}
                className={[
                  'shrink-0 inline-flex items-center justify-center w-4 h-4 rounded border',
                  signed ? 'bg-success-500 border-success-500 text-white' : 'border-border bg-surface',
                  locked ? 'cursor-not-allowed' : 'cursor-pointer hover:border-brand-500',
                ].join(' ')}
                title={
                  locked ? `Locked — ${key === 'reviewer' ? 'preparer' : 'reviewer'} must sign first`
                  : signed ? 'Click to unsign'
                  : 'Click to sign'
                }
              >
                {signed && <CheckIcon size={10} />}
              </button>
              <div className="shrink-0 text-2xs uppercase tracking-wide font-semibold text-ink-muted">
                {label}
              </div>
              <div className="flex-1 min-w-0">
                {signed ? (
                  <div className="text-xs text-ink truncate" title={`${signedName} · ${formatTs(signedAt)}`}>
                    <span className="font-medium">{signedName}</span>
                    <span className="text-ink-faint ml-1">{formatTs(signedAt).slice(0, 10)}</span>
                  </div>
                ) : (
                  <input
                    value={draftName}
                    onChange={e => setDrafts(prev => ({ ...prev, [key]: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && draftName.trim()) {
                        e.preventDefault();
                        void sign(key, draftName.trim());
                      }
                    }}
                    placeholder={locked ? '—' : 'name'}
                    disabled={locked}
                    className="w-full px-1 py-0.5 text-xs border border-border rounded bg-surface disabled:opacity-50"
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact "1/3" style chip for the list page. */
export function signoffProgress(snap: SignoffSnapshot): { done: number; total: 3 } {
  let done = 0;
  if (snap.preparer) done += 1;
  if (snap.reviewer) done += 1;
  if (snap.partner_sign_off) done += 1;
  return { done, total: 3 };
}
