// ════════════════════════════════════════════════════════════════════════
// Declaration detail page — presentational atoms shared across subfiles.
//
// These are dumb components: no state, no side effects, no data
// fetching. Kept in one tiny module so every subfile can import without
// creating a dependency web.
// ════════════════════════════════════════════════════════════════════════

import React from 'react';

export function Stat({
  label, value, color, small,
}: { label: string; value: string | number; color?: string; small?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-ink-muted uppercase tracking-wide font-semibold">{label}</div>
      <div className={`font-semibold mt-1 tabular-nums ${color || 'text-ink'} ${small ? 'text-sm' : 'text-lg'}`}>
        {value}
      </div>
    </div>
  );
}

export function SummaryStat({
  label, value, color, bold,
}: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[11px] text-ink-muted">{label}</div>
      <div className={`tabular-nums mt-0.5 ${bold ? 'font-bold text-[15px]' : 'font-semibold text-[13px]'} ${color || 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

export function KeyBox({
  label, value, color, bold,
}: { label: string; value: string | number; color?: string; bold?: boolean }) {
  return (
    <div>
      <div className="text-[10px] text-ink-muted uppercase tracking-wide font-semibold">{label}</div>
      <div className={`tabular-nums mt-1 ${bold ? 'font-bold text-[16px]' : 'font-semibold text-[14px]'} ${color || 'text-ink'}`}>
        {value}
      </div>
    </div>
  );
}

export function SectionHeader({
  title, count, inline,
}: { title: string; count: number; inline?: boolean }) {
  return (
    <h3 className={`text-[13px] font-semibold text-ink ${inline ? '' : 'mb-2'}`}>
      {title} <span className="text-ink-faint font-normal ml-1">({count})</span>
    </h3>
  );
}

export function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-6 text-center text-[12px] text-ink-faint">
      {children}
    </div>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  const size = small ? 12 : 18;
  return (
    <svg className="animate-spin text-current" width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IconBtn({
  children, onClick, title,
}: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex w-7 h-7 items-center justify-center rounded text-ink-soft hover:bg-surface-alt hover:text-ink transition-colors duration-150 cursor-pointer"
    >
      {children}
    </button>
  );
}

export function ManualIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-faint">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}
