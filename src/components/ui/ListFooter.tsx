'use client';

// Shared pagination footer used by the list pages. Keeps visual
// consistency and the "X – Y of Z (filtered from N)" prose.

import { ChevronsLeftIcon, ChevronLeftIcon, ChevronRightIcon, ChevronsRightIcon } from 'lucide-react';

export function ListFooter({
  start, end, total, allTotal, page, totalPages, pageSize, pageSizes,
  onPage, onPageSize,
}: {
  start: number;
  end: number;
  total: number;
  allTotal: number;
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizes: readonly number[];
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="border-t border-divider px-4 py-2.5 flex items-center justify-between text-[11.5px] text-ink-muted bg-surface-alt/40">
      <span>
        <span className="font-semibold tabular-nums text-ink">{total === 0 ? 0 : start + 1}</span>
        {' – '}
        <span className="font-semibold tabular-nums text-ink">{end}</span>
        {' of '}
        <span className="font-semibold tabular-nums text-ink">{total}</span>
        {' '}
        {total !== allTotal && (
          <span className="text-ink-faint">(filtered from {allTotal})</span>
        )}
      </span>
      <div className="flex items-center gap-3">
        <label className="inline-flex items-center gap-1">
          Page size
          <select
            value={pageSize}
            onChange={e => onPageSize(Number(e.target.value))}
            className="ml-1 border border-border rounded px-1.5 py-0.5 bg-surface text-ink tabular-nums"
          >
            {pageSizes.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-0.5">
          <PageBtn disabled={page === 1} onClick={() => onPage(1)} title="First"><ChevronsLeftIcon size={12} /></PageBtn>
          <PageBtn disabled={page === 1} onClick={() => onPage(page - 1)} title="Previous"><ChevronLeftIcon size={12} /></PageBtn>
          <span className="px-2 tabular-nums">{page} / {totalPages}</span>
          <PageBtn disabled={page >= totalPages} onClick={() => onPage(page + 1)} title="Next"><ChevronRightIcon size={12} /></PageBtn>
          <PageBtn disabled={page >= totalPages} onClick={() => onPage(totalPages)} title="Last"><ChevronsRightIcon size={12} /></PageBtn>
        </div>
      </div>
    </div>
  );
}

function PageBtn({
  children, disabled, onClick, title,
}: { children: React.ReactNode; disabled?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="w-6 h-6 inline-flex items-center justify-center rounded text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {children}
    </button>
  );
}
