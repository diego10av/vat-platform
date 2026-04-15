'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface EntityHit { kind: 'entity'; id: string; name: string; client_name: string | null; regime: string }
interface DeclarationHit { kind: 'declaration'; id: string; year: number; period: string; status: string; entity_name: string }
interface ProviderHit { kind: 'provider'; provider: string; entity_name: string; entity_id: string; declaration_id: string; year: number; period: string }
type Hit = EntityHit | DeclarationHit | ProviderHit;

interface SearchResults {
  entities: EntityHit[];
  declarations: DeclarationHit[];
  providers: ProviderHit[];
}

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

  // Debounced fetch
  useEffect(() => {
    if (!q || q.length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      if (res.ok) setResults(await res.json());
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const flat: Hit[] = results
    ? [...results.entities, ...results.declarations, ...results.providers]
    : [];

  function go(h: Hit) {
    setOpen(false);
    setQ('');
    setResults(null);
    if (h.kind === 'entity') router.push(`/declarations?entity_id=${h.id}`);
    else if (h.kind === 'declaration') router.push(`/declarations/${h.id}`);
    else router.push(`/declarations/${h.declaration_id}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(flat.length - 1, h + 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setHighlight(h => Math.max(0, h - 1)); }
    if (e.key === 'Enter' && flat[highlight]) { e.preventDefault(); go(flat[highlight]); }
  }

  return (
    <div ref={ref} className="relative w-72">
      <button
        onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        className="w-full h-8 px-2 rounded border border-white/20 bg-white/5 text-[12px] text-white/70 hover:bg-white/10 transition-colors text-left flex items-center gap-2 cursor-pointer"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <span className="flex-1 truncate">Search…</span>
        <kbd className="text-[10px] px-1.5 py-0.5 rounded border border-white/20 text-white/50 font-mono">⌘K</kbd>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-[420px] bg-white text-gray-900 border border-gray-200 rounded-lg shadow-2xl overflow-hidden z-50 animate-fadeIn">
          <div className="px-3 py-2 border-b border-gray-200">
            <input
              ref={inputRef}
              value={q}
              onChange={e => { setQ(e.target.value); setHighlight(0); }}
              onKeyDown={onKey}
              placeholder="Find entity, declaration, provider…"
              className="w-full text-[13px] focus:outline-none"
              autoFocus
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto">
            {q.length < 2 ? (
              <Tip>Type at least 2 characters.</Tip>
            ) : !results ? (
              <Tip>Searching…</Tip>
            ) : flat.length === 0 ? (
              <Tip>No results.</Tip>
            ) : (
              <>
                {results.entities.length > 0 && (
                  <Group title="Entities">
                    {results.entities.map((e, i) => (
                      <Item key={e.id} active={highlight === i} onClick={() => go(e)}>
                        <span className="font-medium">{e.name}</span>
                        <span className="text-[11px] text-gray-500 ml-2">{e.client_name || ''} · {e.regime}</span>
                      </Item>
                    ))}
                  </Group>
                )}
                {results.declarations.length > 0 && (
                  <Group title="Declarations">
                    {results.declarations.map((d, i) => {
                      const idx = results.entities.length + i;
                      return (
                        <Item key={d.id} active={highlight === idx} onClick={() => go(d)}>
                          <span className="font-medium">{d.entity_name}</span>
                          <span className="text-[11px] text-gray-500 ml-2">{d.year} {d.period} · {d.status}</span>
                        </Item>
                      );
                    })}
                  </Group>
                )}
                {results.providers.length > 0 && (
                  <Group title="Providers">
                    {results.providers.map((p, i) => {
                      const idx = results.entities.length + results.declarations.length + i;
                      return (
                        <Item key={p.provider + p.declaration_id} active={highlight === idx} onClick={() => go(p)}>
                          <span className="font-medium">{p.provider}</span>
                          <span className="text-[11px] text-gray-500 ml-2">{p.entity_name} · {p.year} {p.period}</span>
                        </Item>
                      );
                    })}
                  </Group>
                )}
              </>
            )}
          </div>
          <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400 flex items-center justify-between bg-gray-50">
            <span>↑↓ to navigate · Enter to open · Esc to close</span>
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
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide font-semibold text-gray-500 bg-gray-50 border-y border-gray-100">{title}</div>
      {children}
    </div>
  );
}
function Item({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => {/* highlight not driven here */}}
      className={`block w-full text-left px-3 py-2 text-[12.5px] transition-colors duration-150 cursor-pointer ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
    >
      {children}
    </button>
  );
}
function Tip({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-3 text-[12px] text-gray-400">{children}</div>;
}
