// ════════════════════════════════════════════════════════════════════════
// Declaration detail page — shared helpers.
//
// Pure functions only. If the helper needs React state, it belongs in
// the relevant component file, not here.
// ════════════════════════════════════════════════════════════════════════

import type { TreatmentCode } from '@/config/treatment-codes';

/**
 * "2026-04-17" → "17/04/2026". Returns "—" for empty input.
 */
export function formatDate(d: string | null): string {
  if (!d) return '—';
  const parts = d.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

/**
 * Euro formatter with LU locale (space thousands separator, 2 decimals).
 * Returns "—" for null/undefined/NaN input.
 */
export function fmtEUR(v: number | null | string): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (isNaN(n)) return '—';
  return n.toLocaleString('en-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Colour class for a treatment-code badge. Inference gets amber (needs
 * confirmation); precedent gets blue (system-learned); specific
 * treatments get their own palette.
 */
export function treatmentColorClass(code: TreatmentCode | null, source: string | null): string {
  if (source === 'inference') return 'bg-amber-100 text-amber-800 border border-amber-200';
  if (source === 'precedent') return 'bg-blue-100 text-blue-800 border border-blue-300';
  if (!code) return 'bg-surface-alt text-ink-soft border border-border';
  if (code.startsWith('LUX_')) return 'bg-sky-100 text-sky-800 border border-sky-200';
  if (code.startsWith('RC_EU')) return 'bg-purple-100 text-purple-800 border border-purple-200';
  if (code.startsWith('RC_NONEU')) return 'bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200';
  if (code === 'IC_ACQ') return 'bg-indigo-100 text-indigo-800 border border-indigo-200';
  if (code === 'EXEMPT_44') return 'bg-emerald-100 text-emerald-800 border border-emerald-200';
  if (code === 'OUT_SCOPE') return 'bg-slate-100 text-slate-700 border border-slate-200';
  if (code.startsWith('OUT_')) return 'bg-teal-100 text-teal-800 border border-teal-200';
  return 'bg-surface-alt text-ink-soft border border-border';
}
