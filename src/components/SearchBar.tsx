'use client';

// ════════════════════════════════════════════════════════════════════════
// Command palette (⌘K) — was a pure search; stint 12 (2026-04-19)
// upgraded it with actionable verbs per the Gassner audit item #8
// and ROADMAP P1.6.
//
// Four result groups, in priority order:
//   1. Commands (go to, create, open) — keyboard-only power moves
//   2. Entities (names)
//   3. Declarations (recent + matching)
//   4. Providers (from prior invoices)
//
// When the user types, commands are matched by keyword substring
// AND by verb match. When the input is empty, a curated starter set
// appears ("Create new client", "Go to settings", etc.).
// ════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  PlusIcon, FileTextIcon, Building2Icon, BookOpenIcon,
  BarChart3Icon, InboxIcon, SettingsIcon, HelpCircleIcon,
  UsersIcon, CalendarIcon, MailIcon, type LucideIcon,
} from 'lucide-react';

interface EntityHit { kind: 'entity'; id: string; name: string; client_name: string | null; regime: string }
interface DeclarationHit { kind: 'declaration'; id: string; year: number; period: string; status: string; entity_name: string }
interface ProviderHit { kind: 'provider'; provider: string; entity_name: string; entity_id: string; declaration_id: string; year: number; period: string }
interface Command {
  kind: 'command';
  id: string;
  label: string;
  hint?: string;
  href?: string;
  keywords: string[];
  icon: LucideIcon;
  shortcut?: string;
}
type Hit = EntityHit | DeclarationHit | ProviderHit | Command;

interface SearchResults {
  entities: EntityHit[];
  declarations: DeclarationHit[];
  providers: ProviderHit[];
}

// The static command registry — the set of "verbs" the palette knows.
// Kept static (no prop drilling from page state) so the palette works
// from every route. Page-contextual commands (e.g. "delete current
// declaration") can be added in a future pass when we thread route
// params into the palette.
const COMMANDS: readonly Command[] = [
  {
    kind: 'command',
    id: 'cmd-new-client',
    label: 'Create new client',
    hint: 'Start a client + optional first entity',
    href: '/clients/new',
    keywords: ['create', 'new', 'client', 'add', 'firm'],
    icon: PlusIcon,
  },
  {
    kind: 'command',
    id: 'cmd-new-entity',
    label: 'Create new entity',
    hint: 'Fund, SV, SOPARFI, AIFM, SCSp…',
    href: '/entities/new',
    keywords: ['create', 'new', 'entity', 'add', 'soparfi', 'fund', 'aifm', 'securitisation', 'securitization', 'sv', 'raif', 'sif', 'sicar'],
    icon: Building2Icon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-clients',
    label: 'Go to clients',
    href: '/clients',
    keywords: ['clients', 'go', 'open'],
    icon: Building2Icon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-entities',
    label: 'Go to entities',
    href: '/entities',
    keywords: ['entities', 'go', 'open'],
    icon: Building2Icon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-declarations',
    label: 'Go to declarations',
    href: '/declarations',
    keywords: ['declarations', 'returns', 'go', 'open', 'vat'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-deadlines',
    label: 'Go to deadlines',
    href: '/deadlines',
    keywords: ['deadlines', 'calendar', 'go', 'open'],
    icon: CalendarIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-closing',
    label: 'Open closing dashboard',
    hint: 'Which entities still need this quarter?',
    href: '/closing',
    keywords: ['closing', 'quarter', 'dashboard', 'q1', 'q2', 'q3', 'q4', 'go', 'open'],
    icon: CalendarIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops',
    label: 'Open Tax-Ops',
    hint: 'Compliance tracker — filings, deadlines, tasks',
    href: '/tax-ops',
    keywords: ['tax', 'ops', 'compliance', 'cit', 'nwt', 'wht', 'filing', 'filings', 'deadline', 'deadlines', 'fatca', 'crs', 'bcl', 'subscription', 'rollover', 'go', 'open'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-cit',
    label: 'Open Corporate tax returns',
    hint: 'CIT / Form 500 — annual corporate income tax',
    href: '/tax-ops/cit',
    keywords: ['tax', 'cit', 'corporate', 'form500', 'form', '500', 'annual', 'mbt', 'municipal'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-nwt',
    label: 'Open NWT reviews',
    hint: 'Year-end net wealth tax advisory review (opted-in clients only)',
    href: '/tax-ops/nwt',
    keywords: ['nwt', 'net', 'wealth', 'review', 'advisory', 'restructuring', 'interim', 'year-end'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-vat-annual',
    label: 'Open VAT annual',
    hint: 'Annual VAT returns (standard + simplified)',
    href: '/tax-ops/vat/annual',
    keywords: ['vat', 'annual', 'simplified'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-vat-quarterly',
    label: 'Open VAT quarterly',
    hint: 'Quarterly VAT returns (Q1-Q4)',
    href: '/tax-ops/vat/quarterly',
    keywords: ['vat', 'quarterly', 'q1', 'q2', 'q3', 'q4'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-vat-monthly',
    label: 'Open VAT monthly',
    hint: 'Monthly VAT returns (Jan-Dec)',
    href: '/tax-ops/vat/monthly',
    keywords: ['vat', 'monthly'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-subscription',
    label: 'Open Subscription tax',
    hint: 'UCI / AIF quarterly subscription tax',
    href: '/tax-ops/subscription-tax',
    keywords: ['subscription', 'tax', 'uci', 'aif', 'fund', 'quarterly'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-wht',
    label: 'Open Withholding tax',
    hint: 'WHT on director fees — monthly / semester / annual',
    href: '/tax-ops/wht/monthly',
    keywords: ['wht', 'withholding', 'director', 'fees', 'monthly'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-bcl',
    label: 'Open BCL reporting',
    hint: 'BCL SBS quarterly + 2.16 monthly',
    href: '/tax-ops/bcl/sbs',
    keywords: ['bcl', 'sbs', '2.16', '216', 'reporting', 'quarterly', 'monthly'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-other',
    label: 'Open ad-hoc filings',
    hint: 'VAT registrations, deregistrations, Functional Currency Requests',
    href: '/tax-ops/other',
    keywords: ['adhoc', 'ad-hoc', 'vat', 'registration', 'deregistration', 'functional', 'currency', 'fcr', 'other'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-search',
    label: 'Search all filings',
    hint: 'Cross-tax-type advanced search grid',
    href: '/tax-ops/filings',
    keywords: ['tax', 'filings', 'search', 'advanced', 'cross', 'all', 'filter'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-entities',
    label: 'Go to Tax-Ops entities',
    href: '/tax-ops/entities',
    keywords: ['tax', 'entities', 'soparfi', 'fund', 'group', 'go', 'open'],
    icon: Building2Icon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-tasks',
    label: 'Go to Tax-Ops tasks',
    hint: 'Follow-ups with subtasks / dependencies / recurring',
    href: '/tax-ops/tasks',
    keywords: ['tax', 'tasks', 'follow-up', 'followup', 'notion', 'kanban', 'go', 'open'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-taxops-settings-deadlines',
    label: 'Edit Tax-Ops deadline rules',
    hint: 'Statutory + admin tolerance — propagates to open filings',
    href: '/tax-ops/settings/deadlines',
    keywords: ['deadline', 'rule', 'cit', 'vat', 'wht', 'statutory', 'tolerance', 'propagate', 'edit'],
    icon: CalendarIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-legal-watch',
    label: 'Open Legal watch',
    hint: 'LTVA + Directive + CJEU + circulars',
    href: '/legal-watch',
    keywords: ['legal', 'watch', 'ltva', 'cjeu', 'circular', 'directive', 'open'],
    icon: BookOpenIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-classifier',
    label: 'Open classifier health',
    hint: '60-fixture corpus · pass rate',
    href: '/settings/classifier',
    keywords: ['classifier', 'accuracy', 'corpus', 'rules', 'health', 'open'],
    icon: BarChart3Icon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-metrics',
    label: 'Open metrics / budget',
    href: '/metrics',
    keywords: ['metrics', 'budget', 'cost', 'anthropic', 'open'],
    icon: BarChart3Icon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-audit',
    label: 'Open audit trail',
    href: '/audit',
    keywords: ['audit', 'history', 'log', 'open'],
    icon: FileTextIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-users',
    label: 'Manage users',
    href: '/settings/users',
    keywords: ['users', 'team', 'role', 'manage', 'settings'],
    icon: UsersIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-aed',
    label: 'Open AED inbox',
    hint: '17-category letter classifier',
    href: '/aed-letters',
    keywords: ['aed', 'letters', 'inbox', 'open'],
    icon: InboxIcon,
  },
  {
    kind: 'command',
    id: 'cmd-goto-settings',
    label: 'Open settings',
    href: '/settings',
    keywords: ['settings', 'preferences', 'open'],
    icon: SettingsIcon,
  },
  {
    kind: 'command',
    id: 'cmd-help',
    label: 'Keyboard shortcuts',
    hint: '⌘K · ? feedback · ↑↓ Enter',
    href: '#',
    keywords: ['help', 'shortcut', 'keys', 'keyboard'],
    icon: HelpCircleIcon,
  },
];

// Starter set shown when the input is empty.
const STARTER_IDS: readonly string[] = [
  'cmd-new-client', 'cmd-new-entity',
  'cmd-goto-declarations', 'cmd-goto-legal-watch',
  'cmd-goto-classifier', 'cmd-goto-audit',
];

export default function SearchBar() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [highlight, setHighlight] = useState(0);
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click outside closes
  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onMouse);
    return () => window.removeEventListener('mousedown', onMouse);
  }, [open]);

  // Debounced fetch for backend search (entities / declarations / providers).
  useEffect(() => {
    if (!q || q.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  // Filter commands by query text.
  const matchedCommands = useMemo<Command[]>(() => {
    if (!q.trim()) {
      // Starter set when empty input.
      const starters = STARTER_IDS
        .map(id => COMMANDS.find(c => c.id === id))
        .filter((c): c is Command => !!c);
      return starters;
    }
    const query = q.toLowerCase();
    const scored: Array<{ c: Command; score: number }> = [];
    for (const c of COMMANDS) {
      let score = 0;
      if (c.label.toLowerCase().includes(query)) score += 3;
      for (const k of c.keywords) {
        if (k.includes(query) || query.includes(k)) score += 1;
      }
      if (score > 0) scored.push({ c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 6).map(s => s.c);
  }, [q]);

  const flat: Hit[] = results
    ? [...matchedCommands, ...results.entities, ...results.declarations, ...results.providers]
    : matchedCommands;

  function go(h: Hit) {
    setOpen(false);
    setQ('');
    setResults(null);
    setHighlight(0);
    if (h.kind === 'entity') router.push(`/declarations?entity_id=${h.id}`);
    else if (h.kind === 'declaration') router.push(`/declarations/${h.id}`);
    else if (h.kind === 'provider') router.push(`/declarations/${h.declaration_id}`);
    else if (h.href && h.href !== '#') router.push(h.href);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(flat.length - 1, h + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    if (e.key === 'Enter' && flat[highlight]) { e.preventDefault(); go(flat[highlight]); }
  }

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <button
        onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        className="w-full h-9 px-3 rounded-md border border-border bg-surface text-[13px] text-ink-muted hover:bg-surface-alt hover:border-border-strong transition-all duration-150 text-left flex items-center gap-2"
        aria-label="Open command palette (⌘K)"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span className="flex-1 truncate">Search · Command…</span>
        <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-border text-ink-faint font-mono">⌘K</kbd>
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 w-[520px] bg-surface text-ink border border-border rounded-xl shadow-lg overflow-hidden z-50 animate-fadeInScale"
          role="dialog"
          aria-label="Command palette"
        >
          <div className="px-3 py-2.5 border-b border-divider">
            <input
              ref={inputRef}
              value={q}
              onChange={e => { setQ(e.target.value); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder="Command (create client), or find (Acme, Q4 2026, a provider)…"
              className="w-full text-[13px] focus:outline-none"
              autoFocus
              aria-label="Command or search query"
            />
          </div>
          <div className="max-h-[440px] overflow-y-auto">
            {matchedCommands.length > 0 && (
              <Group title={q.trim() ? 'Commands' : 'Quick actions'}>
                {matchedCommands.map((c, i) => {
                  const Icon = c.icon;
                  return (
                    <Item key={c.id} active={highlight === i} onClick={() => go(c)}>
                      <span className="inline-flex items-center gap-2">
                        <Icon size={13} className="text-ink-muted shrink-0" />
                        <span className="font-medium">{c.label}</span>
                        {c.hint && (
                          <span className="text-[11px] text-ink-muted ml-1">{c.hint}</span>
                        )}
                      </span>
                    </Item>
                  );
                })}
              </Group>
            )}

            {q.length >= 2 && !results && (
              <Tip>Searching…</Tip>
            )}

            {results && results.entities.length > 0 && (
              <Group title="Entities">
                {results.entities.map((e, i) => {
                  const idx = matchedCommands.length + i;
                  return (
                    <Item key={e.id} active={highlight === idx} onClick={() => go(e)}>
                      <span className="font-medium">{e.name}</span>
                      <span className="text-[11px] text-ink-muted ml-2">{e.client_name || ''} · {e.regime}</span>
                    </Item>
                  );
                })}
              </Group>
            )}
            {results && results.declarations.length > 0 && (
              <Group title="Declarations">
                {results.declarations.map((d, i) => {
                  const idx = matchedCommands.length + results.entities.length + i;
                  return (
                    <Item key={d.id} active={highlight === idx} onClick={() => go(d)}>
                      <span className="font-medium">{d.entity_name}</span>
                      <span className="text-[11px] text-ink-muted ml-2">{d.year} {d.period} · {d.status}</span>
                    </Item>
                  );
                })}
              </Group>
            )}
            {results && results.providers.length > 0 && (
              <Group title="Providers">
                {results.providers.map((p, i) => {
                  const idx = matchedCommands.length + results.entities.length + results.declarations.length + i;
                  return (
                    <Item key={p.provider + p.declaration_id} active={highlight === idx} onClick={() => go(p)}>
                      <span className="font-medium">{p.provider}</span>
                      <span className="text-[11px] text-ink-muted ml-2">{p.entity_name} · {p.year} {p.period}</span>
                    </Item>
                  );
                })}
              </Group>
            )}

            {q.length >= 2 && results && matchedCommands.length === 0
              && results.entities.length === 0
              && results.declarations.length === 0
              && results.providers.length === 0 && (
              <Tip>No results.</Tip>
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-divider text-[10px] text-ink-muted flex items-center justify-between bg-surface-alt">
            <span>↑↓ navigate · Enter to run · Esc to close</span>
            <span>{flat.length} result{flat.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1 text-[10px] uppercase tracking-[0.06em] font-semibold text-ink-muted bg-surface-alt border-y border-divider">
        {title}
      </div>
      {children}
    </div>
  );
}
function Item({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left px-3 py-2 text-[12.5px] transition-colors duration-150 ${active ? 'bg-brand-50 text-brand-800' : 'hover:bg-surface-alt'}`}
    >
      {children}
    </button>
  );
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 py-4 text-[12px] text-ink-muted text-center">{children}</div>
  );
}

// Icons for hint list; also expose MailIcon (for completeness / future).
export { MailIcon };
