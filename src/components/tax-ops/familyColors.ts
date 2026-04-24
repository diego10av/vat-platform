// ════════════════════════════════════════════════════════════════════════
// familyColors — stable, deterministic color per client_group name.
//
// Diego: "Como es todo del mismo color, a veces es un poco lioso. No sé
// si habría que poner una familia, por ejemplo 'Alto', de color gris, y
// cuando es la familia 'Avalon' cambiara a otro color para que se vea
// más claramente la diferencia." Stint 39.B.
//
// Requirements:
//   1. Same family → always same color (stable across sessions, across
//      years, regardless of order).
//   2. Adjacent families should feel visually distinct (hashing helps).
//   3. All colors must work on light backgrounds + pass AA contrast for
//      small text chips.
//   4. Zero dependencies — pure function on string input.
// ════════════════════════════════════════════════════════════════════════

// 10-color palette. Each entry: bg (left border tint + chip bg), text
// (chip label). Tones chosen to be distinguishable without being noisy.
const PALETTE: Array<{ bg: string; text: string; border: string }> = [
  { bg: 'bg-sky-100',      text: 'text-sky-800',      border: 'border-sky-400' },
  { bg: 'bg-emerald-100',  text: 'text-emerald-800',  border: 'border-emerald-400' },
  { bg: 'bg-amber-100',    text: 'text-amber-900',    border: 'border-amber-500' },
  { bg: 'bg-violet-100',   text: 'text-violet-800',   border: 'border-violet-400' },
  { bg: 'bg-rose-100',     text: 'text-rose-800',     border: 'border-rose-400' },
  { bg: 'bg-teal-100',     text: 'text-teal-800',     border: 'border-teal-400' },
  { bg: 'bg-indigo-100',   text: 'text-indigo-800',   border: 'border-indigo-400' },
  { bg: 'bg-fuchsia-100',  text: 'text-fuchsia-800',  border: 'border-fuchsia-400' },
  { bg: 'bg-lime-100',     text: 'text-lime-800',     border: 'border-lime-500' },
  { bg: 'bg-orange-100',   text: 'text-orange-900',   border: 'border-orange-400' },
];

// Neutral fallback for "no family" / empty group names.
const NEUTRAL = { bg: 'bg-surface-alt', text: 'text-ink-muted', border: 'border-border' };

/** djb2-style string hash — simple + well-distributed. */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;  // force 32-bit
  }
  return Math.abs(h);
}

export function familyPalette(name: string | null | undefined) {
  if (!name?.trim()) return NEUTRAL;
  const normalized = name.trim().toUpperCase();
  const idx = hashString(normalized) % PALETTE.length;
  return PALETTE[idx]!;
}

/** Convenience for a compact "chip" className string. */
export function familyChipClasses(name: string | null | undefined): string {
  const p = familyPalette(name);
  return `${p.bg} ${p.text}`;
}

/** Class for a left-border stripe on the whole row (when grouped). */
export function familyBorderClasses(name: string | null | undefined): string {
  return familyPalette(name).border;
}
