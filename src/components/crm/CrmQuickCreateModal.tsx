'use client';

// CrmQuickCreateModal — press `N` anywhere under /crm to open.
//
// Stint 63.B (2026-04-28). Closes Diego's "no se pueden introducir
// cosas nuevas" — quick-capture from any CRM page without navigating
// to the specific entity tab first.
//
// Type-and-name pattern: single text field + radio of entity types
// (Company / Contact / Opportunity / Task — the 4 with simple required
// fields). POSTs the minimal payload, then redirects to the detail
// page where Diego polishes everything else inline.
//
// Matters and Activities deliberately NOT in this modal — they have
// stricter required fields (matters need a client + reference;
// activities need a type + linked entity). Diego goes to /crm/matters
// or /crm/activities and uses the full CrmFormModal for those.

import { useEffect, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/Toaster';

type EntityType = 'contact' | 'company' | 'opportunity' | 'task';

interface TypeConfig {
  value: EntityType;
  label: string;
  endpoint: string;
  payloadField: string;       // body key used to send the title/name
  detailPathPrefix: string;   // where to redirect after create
  placeholder: string;
}

// Stint 64.S — Contacts before Companies, matching the sidebar +
// top-tab nav order (legal-CRM canon).
const TYPES: TypeConfig[] = [
  {
    value: 'contact',
    label: 'Contact',
    endpoint: '/api/crm/contacts',
    payloadField: 'full_name',
    detailPathPrefix: '/crm/contacts',
    placeholder: 'e.g. Maria Schmidt',
  },
  {
    value: 'company',
    label: 'Company',
    endpoint: '/api/crm/companies',
    payloadField: 'company_name',
    detailPathPrefix: '/crm/companies',
    placeholder: 'e.g. Acme SARL',
  },
  {
    value: 'opportunity',
    label: 'Opportunity',
    endpoint: '/api/crm/opportunities',
    payloadField: 'name',
    detailPathPrefix: '/crm/opportunities',
    placeholder: 'e.g. Acme — VAT advisory Q3',
  },
  {
    value: 'task',
    label: 'Task',
    endpoint: '/api/crm/tasks',
    payloadField: 'title',
    detailPathPrefix: '/crm/tasks',
    placeholder: 'e.g. Send proposal to Acme',
  },
];

export function CrmQuickCreateModal() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<EntityType>('company');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();

  // Listen for `N` only within /crm/*. Mirrors the Tax-Ops pattern but
  // with a different scope, so pressing N inside Tax-Ops never opens
  // the CRM modal and vice versa.
  useEffect(() => {
    if (!pathname.startsWith('/crm')) return;
    function handler(e: KeyboardEvent) {
      const tgt = e.target as HTMLElement | null;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) return;
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pathname]);

  // Auto-focus the name input when the modal opens, and pre-select the
  // entity type based on which CRM tab Diego is on (e.g. on
  // /crm/contacts, default to Contact).
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      // Pre-select by current path if it matches one of the types.
      for (const t of TYPES) {
        if (pathname.startsWith(t.detailPathPrefix)) {
          setType(t.value);
          break;
        }
      }
    } else {
      setName('');
      setBusy(false);
      setError(null);
    }
  }, [open, pathname]);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const cfg = TYPES.find(t => t.value === type)!;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [cfg.payloadField]: trimmed }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error?.message ?? b?.error ?? `HTTP ${res.status}`);
      }
      const body = await res.json() as { id?: string };
      toast.success(`${cfg.label} created`);
      setOpen(false);
      if (body?.id) {
        router.push(`${cfg.detailPathPrefix}/${body.id}`);
      } else {
        router.push(cfg.detailPathPrefix);
      }
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Quick create"
      subtitle="Press N from any /crm page. Enter to create, Esc to cancel."
      size="md"
    >
      <div className="space-y-4 text-sm">
        {/* Type selector — radio chips. */}
        <div>
          <span className="block text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
            What do you want to create?
          </span>
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={[
                  'inline-flex items-center px-3 py-1.5 rounded-md border text-sm font-medium transition-colors',
                  type === t.value
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-surface text-ink-soft border-border hover:bg-surface-alt hover:text-ink',
                ].join(' ')}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Name input — focus target. */}
        <div>
          <span className="block text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-1.5">
            Name
          </span>
          <input
            ref={inputRef}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !busy) void submit(); }}
            placeholder={TYPES.find(t => t.value === type)?.placeholder}
            className="w-full px-2.5 py-2 border border-border rounded-md bg-surface text-sm"
          />
          <p className="mt-1.5 text-2xs text-ink-faint">
            Just the name. You&apos;ll land on the detail page where you can
            edit every field inline.
          </p>
        </div>

        {error && (
          <div className="rounded-md border border-danger-400 bg-danger-50/50 p-2 text-sm text-danger-800">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 text-sm rounded-md border border-border hover:bg-surface-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !name.trim()}
            className="px-3 py-1.5 text-sm rounded-md bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create →'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
