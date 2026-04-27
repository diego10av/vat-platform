'use client';

// Stint 51.C — React Context that carries a FamilyColorMap (built from
// the rendered list of families) so chip components in a matrix can
// avoid colour collisions between adjacent rows. See familyColors.ts
// for the algorithm.
//
// Components that aren't wrapped in a provider keep using the natural
// hash via familyChipClasses() — no behaviour change for the entity-
// detail chip, the dropdown options, etc.

import { createContext, useContext } from 'react';
import {
  type FamilyColorMap, familyChipClassesFromMap,
} from './familyColors';

const FamilyColorContext = createContext<FamilyColorMap | null>(null);

export const FamilyColorProvider = FamilyColorContext.Provider;

/** Hook used by row renderers (matrix-row-columns.tsx) to compute the
 *  chip classes for a family within the current matrix render. */
export function useFamilyChipClasses(name: string | null | undefined): string {
  const map = useContext(FamilyColorContext);
  return familyChipClassesFromMap(map, name);
}
