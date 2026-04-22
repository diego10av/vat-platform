'use client';

// ════════════════════════════════════════════════════════════════════════
// GlobalSearch — ⌘K (Ctrl+K) launcher that searches across every CRM
// entity. Opens a modal overlay at the top of the viewport with a
// single input. As the user types, fetches /api/crm/search and renders
// grouped results (companies / contacts / opportunities / matters /
// invoices). Arrow keys navigate, Enter opens, Esc closes.
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SearchIcon } from 'lucide-react';

interface Hit {
  id: string;
  label: string;
  // Any additional fields for subline rendering
  [k: string]: unknown;
}

interface Results {
  companies: Hit[];
  contacts: Hit[];
  opportunities: Hit[];
  matters: Hit[];
  invoices: Hit[];
}

const EMPTY: Results = { companies: [], contacts: [], opportunities: [], matters: [], invoices: [] };

const GROUPS: Array<{ key: keyof Results; title: string; icon: string; hrefFn: (id: string) => string }> = [
  { key: 'companies',     title: 'Companies',     icon: '🏢', hrefFn: id => `/crm/companies/${id}` },
  { key: 'contacts',      title: 'Contacts',      icon: '👤', hrefFn: id => `/crm/contacts/${id}` },
  { key: 'opportunities', title: 'Opportunities', icon: '🎯', hrefFn: id => `/crm/opportunities/${id}` },
  { key: 'matters',       title: 'Matters',       icon: '⚖️', hrefFn: id => `/crm/matters/${id}` },
  { key: 'invoices',      title: 'Invoices',      icon: '💶', hrefFn: id => `/crm/billing/${id}` },
];

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Register ⌘K / Ctrl+K shortcut globally.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(v => !v);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Focus input when opened.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 10);
    } else {
      setQ('');
      setResults(EMPTY);
      setActiveIdx(0);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults(EMPTY);
      return;
    }
    setLoading(true);
    const handle = setTimeout(() => {
      fetch(`/api/crm/search?q=${encodeURIComponent(q)}&limit=5`, { cache: 'no-store' })
        .then(r => r.json())
        .then(data => { setResults(data); setActiveIdx(0); })
        .catch(() => setResults(EMPTY))
        .finally(() => setLoading(false));
    }, 150);
    return () => clearTimeout(handle);
  }, [q, open]);

  // Flatten hits for arrow-key navigation.
  const flat: Array<{ group: (typeof GROUPS)[number]; hit: Hit }> = [];
  for (const g of GROUPS) {
    for (const hit of results[g.key] ?? []) {
      flat.push({ group: g, hit });
    }
  }

  function navigate(hit: Hit, group: (typeof GROUPS)[number]) {
    setOpen(false);
    router.push(group.hrefFn(hit.id));
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && flat[activeIdx]) {
      e.preventDefault();
      navigate(flat[activeIdx].hit, flat[activeIdx].group);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 bg-black/30" onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border">
          <SearchIcon size={16} className="text-ink-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search companies, contacts, opportunities, matters, invoices..."
            className="flex-1 text-[14px] focus:outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-surface-alt border border-border text-ink-muted">Esc</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading && q.length >= 2 && (
            <div className="px-3 py-4 text-[12px] text-ink-muted italic">Searching…</div>
          )}
          {!loading && q.length >= 2 && flat.length === 0 && (
            <div className="px-3 py-4 text-[12px] text-ink-muted italic">No matches for “{q}”.</div>
          )}
          {q.length < 2 && (
            <div className="px-3 py-4 text-[12px] text-ink-muted italic">Type at least 2 characters to search.</div>
          )}
          {flat.length > 0 && GROUPS.map(group => {
            const hits = results[group.key] ?? [];
            if (hits.length === 0) return null;
            return (
              <div key={group.key}>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide font-semibold text-ink-muted bg-surface-alt/50">
                  {group.icon} {group.title}
                </div>
                {hits.map(hit => {
                  const flatIdx = flat.findIndex(x => x.group.key === group.key && x.hit.id === hit.id);
                  const isActive = flatIdx === activeIdx;
                  return (
                    <button
                      key={hit.id}
                      onClick={() => navigate(hit, group)}
                      onMouseEnter={() => setActiveIdx(flatIdx)}
                      className={`w-full text-left px-3 py-2 flex items-start gap-2 ${isActive ? 'bg-brand-50' : 'hover:bg-surface-alt/50'}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium truncate">{hit.label}</div>
                        <div className="text-[10.5px] text-ink-muted truncate">
                          {renderSubline(group.key, hit)}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="px-3 py-2 border-t border-border flex items-center gap-3 text-[10.5px] text-ink-muted">
          <span><kbd className="px-1 py-0.5 rounded bg-surface-alt border border-border">↑↓</kbd> navigate</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-alt border border-border">↵</kbd> open</span>
          <span><kbd className="px-1 py-0.5 rounded bg-surface-alt border border-border">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

function renderSubline(kind: keyof Results, hit: Hit): string {
  switch (kind) {
    case 'companies': {
      const parts: string[] = [];
      if (hit.classification) parts.push(String(hit.classification));
      if (hit.country) parts.push(String(hit.country));
      return parts.join(' · ') || '—';
    }
    case 'contacts': {
      const parts: string[] = [];
      if (hit.job_title) parts.push(String(hit.job_title));
      if (hit.email) parts.push(String(hit.email));
      return parts.join(' · ') || '—';
    }
    case 'opportunities': {
      const parts: string[] = [];
      if (hit.stage) parts.push(String(hit.stage));
      if (hit.company_name) parts.push(String(hit.company_name));
      return parts.join(' · ') || '—';
    }
    case 'matters': {
      const parts: string[] = [];
      if (hit.status) parts.push(String(hit.status));
      if (hit.client_name) parts.push(String(hit.client_name));
      return parts.join(' · ') || '—';
    }
    case 'invoices': {
      const parts: string[] = [];
      if (hit.status) parts.push(String(hit.status));
      if (hit.amount_incl_vat != null) parts.push(`€${Number(hit.amount_incl_vat).toLocaleString('fr-FR')}`);
      if (hit.client_name) parts.push(String(hit.client_name));
      return parts.join(' · ') || '—';
    }
  }
}
