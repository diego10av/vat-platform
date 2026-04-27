// ════════════════════════════════════════════════════════════════════════
// familyColors — stable, deterministic color per client_group name.
//
// Diego: "Como es todo del mismo color, a veces es un poco lioso. No sé
// si habría que poner una familia, por ejemplo 'Alto', de color gris, y
// cuando es la familia 'Avalon' cambiara a otro color para que se vea
// más claramente la diferencia." Stint 39.B.
//
// Requirements:
//   1. Same family → always same color WHEN POSSIBLE (stable across
//      sessions and views).
//   2. **Adjacent families in a render context must never share the same
//      color** (stint 51.C — Diego: "hay a veces que los dos colores se
//      repiten de manera seguida"). When a hash collision puts two
//      adjacent families in the same palette slot, we rotate the second
//      one forward (per render context) to break the tie.
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

// ────────────────────────────────────────────────────────────────────────
// Stint 51.C — render-context palette assignment with collision avoidance.
//
// Given an ordered list of family names (in the order they will be
// rendered), build a Map<name, palette-index> that:
//   - Starts from each family's natural hash slot.
//   - If the slot equals the previous family's slot in the list, rotates
//     forward (+1, +2, …) until a non-colliding slot is found.
//   - Stays stable across re-renders for the same input list.
//
// We only consider direct neighbour collisions (not pairs further apart),
// because Diego's complaint is specifically "dos colores de manera
// seguida" — chips that aren't adjacent on screen don't matter.
// ────────────────────────────────────────────────────────────────────────

export type FamilyColorMap = ReadonlyMap<string, number>;

export function buildFamilyColorMap(orderedNames: ReadonlyArray<string | null | undefined>): FamilyColorMap {
  const map = new Map<string, number>();
  let lastIdx = -1;
  for (const raw of orderedNames) {
    const name = raw?.trim();
    if (!name) continue;
    const normalized = name.toUpperCase();
    if (map.has(normalized)) {
      // Already assigned — keep the natural slot. Update lastIdx so the
      // *next* fresh family is checked against this one's slot, not an
      // older one further up the list.
      lastIdx = map.get(normalized)!;
      continue;
    }
    let idx = hashString(normalized) % PALETTE.length;
    let attempts = 0;
    while (idx === lastIdx && attempts < PALETTE.length) {
      idx = (idx + 1) % PALETTE.length;
      attempts += 1;
    }
    map.set(normalized, idx);
    lastIdx = idx;
  }
  return map;
}

/** Look up a family's chip class string in a context map; falls back to
 *  the natural hash if the family isn't in the map. */
export function familyChipClassesFromMap(
  map: FamilyColorMap | null | undefined,
  name: string | null | undefined,
): string {
  if (!name?.trim()) return `${NEUTRAL.bg} ${NEUTRAL.text}`;
  if (map) {
    const idx = map.get(name.trim().toUpperCase());
    if (idx !== undefined) {
      const p = PALETTE[idx]!;
      return `${p.bg} ${p.text}`;
    }
  }
  return familyChipClasses(name);
}
