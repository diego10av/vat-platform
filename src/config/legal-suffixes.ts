// Shared legal-suffix strip list used for fuzzy entity-name matching.
//
// Both the extractor and the triage prompts reference this list so that the
// two agents produce identical equivalence classes when fuzzing an entity
// name. The classifier also uses it (via normaliseProviderName in
// classification-rules.ts) for precedent matching.
//
// Adding a suffix here — e.g. a new LU legal form introduced by statute —
// requires no other code change.

export const LEGAL_SUFFIXES: readonly string[] = [
  // Luxembourg
  'sarl', 's.à r.l.', 's.a r.l.', 's.à.r.l.', 's.a.r.l.', 'sàrl', 'sarl-s',
  'sa', 's.a.',
  'scs', 'sca', 's.c.a.', 'scsp', 's.c.sp.', 's.à r.l.-s',
  'sicav', 'sicaf', 'sicav-sif', 'sicav-raif', 'sicav-part ii',
  'fcp', 'fcp-sif', 'fcp-raif',
  'soparfi', 'raif', 'sif', 'sicar',
  'asbl', 'fondation',
  // France
  'sas', 'sasu', 'sprl', 'sci',
  // Germany
  'gmbh', 'ag', 'se', 'kg', 'kgaa', 'ohg', 'ug',
  // UK / IE
  'ltd', 'limited', 'plc', 'llp', 'lp', 'lp.', 'llc',
  'inc', 'inc.',
  // BE / NL
  'bvba', 'bv', 'nv', 'comm.v.', 'commv',
  // Italy
  'srl', 's.r.l.', 'spa', 's.p.a.', 'sapa',
  // Spain / PT
  'slu', 'sl', 's.l.', 'sad', 'lda.',
  // PL
  'sp. z o.o.', 'sp z o o', 'spzoo', 'sa.',
  // CH
  'sa sa', 'gmbh ch',
];

// Common fillers to strip before fuzzy-match. These are words that appear
// in many entity names and have no discriminating power.
export const NAME_FILLERS: readonly string[] = [
  'luxembourg', 'lux',
  'holdings', 'holding', 'partners', 'capital', 'capital partners',
  'fund', 'fonds', 'funds',
  'group', 'groupe', 'gruppe',
  'international', 'intl',
  'the', 'and', 'de', 'des', 'du', 'la', 'le', 'les',
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x',
];

/** Human-readable list of the most common LU legal forms, for inclusion
 *  in agent prompts that need to show examples. */
export const LU_LEGAL_FORMS_FOR_PROMPTS =
  'SARL, S.à r.l., Sàrl, SA, SCA, SCS, SCSp, SICAV, SICAF, ' +
  'RAIF, SIF, SICAR, SOPARFI, FCP, ASBL';
