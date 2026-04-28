'use client';

// CrmSavedViews — generic saved-filter dropdown for any CRM list page.
//
// Stint 63.D (2026-04-28). Ports the TaskSavedViews pattern from
// Tax-Ops with two extra knobs: storageKey (each list has its own
// localStorage namespace) and defaultLabel ("All companies" vs "All
// contacts" etc).
//
// Requires the host page to URL-persist its filters — saved views
// only work if the filters live in the URL query string. The page
// reads `window.location.search` on mount + responds to navigations.

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { ChevronDownIcon, BookmarkIcon, Trash2Icon } from 'lucide-react';

interface SavedView {
  name: string;
  query: string;       // raw query string, no leading "?"
  created_at: string;
}

function loadAll(storageKey: string): SavedView[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedView[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAll(storageKey: string, views: SavedView[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey, JSON.stringify(views));
}

interface Props {
  /** Current query string (live, no leading "?"). Used to "Save current as…". */
  currentQuery: string;
  /** localStorage key — keep the namespaces distinct per list. */
  storageKey: string;
  /** Label for the "no filters" option. e.g. "All companies". */
  defaultLabel?: string;
}

export function CrmSavedViews({ currentQuery, storageKey, defaultLabel = 'All' }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => { setViews(loadAll(storageKey)); }, [storageKey]);

  function applyView(v: SavedView) {
    setOpen(false);
    router.push(v.query ? `${pathname}?${v.query}` : pathname, { scroll: false });
  }

  function saveCurrent() {
    const name = window.prompt('Name this view:')?.trim();
    if (!name) return;
    if (views.some(v => v.name === name)) {
      if (!window.confirm(`"${name}" already exists. Overwrite?`)) return;
    }
    const next = [
      { name, query: currentQuery, created_at: new Date().toISOString() },
      ...views.filter(v => v.name !== name),
    ];
    setViews(next);
    saveAll(storageKey, next);
    setOpen(false);
  }

  function remove(name: string) {
    if (!window.confirm(`Delete view "${name}"?`)) return;
    const next = views.filter(v => v.name !== name);
    setViews(next);
    saveAll(storageKey, next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 px-2 py-1.5 text-sm rounded-md border border-border hover:bg-surface-alt"
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Saved views — apply your filters once, save under a name, recall later in one click. Stored locally per browser."
      >
        <BookmarkIcon size={11} /> Views{views.length > 0 ? ` (${views.length})` : ''} <ChevronDownIcon size={11} />
      </button>
      {open && (
        <div
          className="absolute z-popover top-full left-0 mt-1 w-[300px] bg-surface border border-border rounded-md shadow-lg p-1.5"
          onMouseLeave={() => setOpen(false)}
        >
          {views.length === 0 && (
            <div className="px-2 py-1.5 mb-1 text-2xs text-ink-muted bg-surface-alt/50 rounded leading-snug">
              <strong className="text-ink">Saved views</strong> let you
              capture a filter combination and recall it in one click.
              Set some filters first, then hit “Save current as…” below.
            </div>
          )}
          <button
            type="button"
            onClick={() => { setOpen(false); router.push(pathname, { scroll: false }); }}
            className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-alt"
          >
            {defaultLabel}
          </button>
          {views.map(v => (
            <div
              key={v.name}
              className="flex items-center gap-1 group hover:bg-surface-alt rounded"
            >
              <button
                type="button"
                onClick={() => applyView(v)}
                className="flex-1 text-left px-2 py-1 text-sm truncate"
                title={v.query || '(no filters)'}
              >
                {v.name}
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(v.name); }}
                aria-label={`Delete view ${v.name}`}
                className="px-1 text-ink-muted hover:text-danger-600 opacity-0 group-hover:opacity-100"
              >
                <Trash2Icon size={11} />
              </button>
            </div>
          ))}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            onClick={saveCurrent}
            disabled={!currentQuery}
            className="w-full text-left px-2 py-1 text-sm rounded hover:bg-surface-alt disabled:opacity-50 disabled:cursor-not-allowed text-brand-700"
            title={!currentQuery ? 'Set some filters first' : 'Save the current filter combo'}
          >
            + Save current as…
          </button>
        </div>
      )}
    </div>
  );
}
