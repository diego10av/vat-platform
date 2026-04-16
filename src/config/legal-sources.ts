// ════════════════════════════════════════════════════════════════════════
// Legal sources — the living legal reference map of the platform.
//
// Every classification rule, treatment code, eCDF box and agent prompt
// that embeds a legal position MUST cite one or more ids from this file.
// This turns plain-text legal citations ("Art. 44§1 d LTVA") into
// structured references that the UI can hyperlink, the legal-watch
// system can flag for review, and downstream audit trails can prove.
//
// How to update this file:
//   1.  When the AED publishes a new circular, add an entry under CIRCULARS.
//   2.  When a CJEU decision lands that affects LU VAT practice, add it
//       under CASES_EU.
//   3.  When a Luxembourg Tribunal administratif / Cour administrative
//       ruling changes AED administrative practice, add it under CASES_LU.
//   4.  When law itself changes (LTVA amendment, Directive amendment),
//       update the `effective` range and the `superseded_by` link.
//   5.  Bump `last_reviewed` on any entry you have confirmed is still
//       current. The legal-watch report lists everything whose
//       last_reviewed is more than 12 months old.
//
// Principle: an internal tool for VAT work at Magic-Circle level is only
// as good as the rigour of its legal references. Never cite a statute
// without a structured source id; never let a source id rot.
// ════════════════════════════════════════════════════════════════════════

export interface LegalSource {
  id: string;                     // canonical id used by rules/boxes/prompts
  kind: 'law' | 'directive' | 'regulation' | 'circular' | 'case_eu' | 'case_lu' | 'practice';
  title: string;                  // short human-readable label
  citation: string;               // full formal citation
  article?: string;               // article or paragraph reference
  jurisdiction: 'LU' | 'EU' | 'LU+EU';
  effective_from?: string;        // ISO date when the source first took effect
  effective_until?: string | null;// ISO date when superseded, or null if still in force
  superseded_by?: string;         // legal-source id of the newer instrument, if any
  subject: string;                // one-line summary of what it regulates
  relevance: string;              // why it matters for this tool
  last_reviewed: string;          // ISO date the maintainer confirmed this is still current
  sources_url?: string;           // link to official text (legilux.lu / eur-lex / curia.europa.eu / etc.)
  notes?: string;                 // free text — practitioner commentary
}

// ────────────────────────── Primary Luxembourg law ──────────────────────────
export const LU_LAW: Record<string, LegalSource> = {
  LTVA: {
    id: 'LTVA',
    kind: 'law',
    title: 'Loi sur la TVA (LTVA)',
    citation: 'Loi du 12 février 1979 concernant la taxe sur la valeur ajoutée, telle que modifiée',
    jurisdiction: 'LU',
    effective_from: '1979-02-12',
    effective_until: null,
    subject: 'Primary Luxembourg VAT law — rates, exemptions, chargeability, deduction, filing',
    relevance: 'Every classification rule and eCDF box ultimately cites a LTVA article. This is the master law.',
    last_reviewed: '2026-04-16',
    sources_url: 'https://legilux.public.lu',
    notes: 'Amended dozens of times. When citing specific articles, prefer the current consolidated version on legilux.',
  },
  LTVA_ART_2: {
    id: 'LTVA_ART_2',
    kind: 'law', title: 'LTVA Art. 2 — scope of VAT',
    citation: 'Loi TVA, article 2',
    article: '2',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Defines the scope: supplies of goods and services effected for consideration by a taxable person acting as such.',
    relevance: 'Baseline test for OUT_SCOPE / VAT_GROUP_OUT classifications.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_12: {
    id: 'LTVA_ART_12',
    kind: 'law', title: 'LTVA Art. 12 — self-supply (autolivraison)',
    citation: 'Loi TVA, article 12',
    article: '12',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Deemed supplies of goods and services for consideration (application to own use, private use of business assets).',
    relevance: 'Legal basis for treatment AUTOLIV_17.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_17: {
    id: 'LTVA_ART_17',
    kind: 'law', title: 'LTVA Art. 17 — place of supply of services (general B2B rule)',
    citation: 'Loi TVA, article 17§1',
    article: '17§1',
    jurisdiction: 'LU', effective_until: null,
    subject: 'General B2B rule: place of supply is where the customer is established. Grounds the reverse charge.',
    relevance: 'Legal basis for RC_EU_TAX and RC_NONEU_TAX.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_18BIS: {
    id: 'LTVA_ART_18BIS',
    kind: 'law', title: 'LTVA Art. 18bis — triangulation simplification',
    citation: 'Loi TVA, article 18bis',
    article: '18bis',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Simplification for intra-Community triangular transactions (3 parties, 2 countries, 1 movement).',
    relevance: 'Legal basis for OUT_LU_TRIANG.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_21: {
    id: 'LTVA_ART_21',
    kind: 'law', title: 'LTVA Art. 21 — intra-Community acquisitions',
    citation: 'Loi TVA, article 21',
    article: '21',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Defines and taxes the intra-Community acquisition of goods by LU taxable persons.',
    relevance: 'Legal basis for IC_ACQ family of treatments and boxes 051/056/711-717.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_27: {
    id: 'LTVA_ART_27',
    kind: 'law', title: 'LTVA Art. 27 — import of goods',
    citation: 'Loi TVA, article 27',
    article: '27',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Taxation of goods imported from outside the EU; chargeability at customs clearance.',
    relevance: 'Legal basis for IMPORT_VAT. Links to Art. 57-58 (deduction of import VAT).',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_28: {
    id: 'LTVA_ART_28',
    kind: 'law', title: 'LTVA Art. 28§3 c — exclusion of disbursements from the taxable amount',
    citation: 'Loi TVA, article 28§3 c',
    article: '28§3 c',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Amounts received by the supplier from the customer as repayment of expenses paid in the customer\'s name and for his account are excluded from the taxable amount.',
    relevance: 'Legal basis for DEBOURS treatment.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_40: {
    id: 'LTVA_ART_40',
    kind: 'law', title: 'LTVA Art. 40 — standard rate',
    citation: 'Loi TVA, article 40',
    article: '40',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Standard rate of VAT (17% from 2024).',
    relevance: 'Legal basis for LUX_17, OUT_LUX_17, AUTOLIV_17.',
    last_reviewed: '2026-04-16',
    notes: 'Rate was 16% (2023 budget temporary measure) and reverted to 17% from 2024-01-01.',
  },
  LTVA_ART_40_1: {
    id: 'LTVA_ART_40_1',
    kind: 'law', title: 'LTVA Art. 40-1 — reduced rates',
    citation: 'Loi TVA, article 40-1',
    article: '40-1',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Intermediate (14%), reduced (8%) and super-reduced (3%) rates with their annexes.',
    relevance: 'Legal basis for LUX_14, LUX_08, LUX_03 and the rate-variants of IC_ACQ.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_43: {
    id: 'LTVA_ART_43',
    kind: 'law', title: 'LTVA Art. 43 — IC supply of goods',
    citation: 'Loi TVA, article 43',
    article: '43',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Zero-rating (exempt with credit) of intra-Community supplies of goods to VAT-registered EU customers.',
    relevance: 'Legal basis for OUT_IC_GOODS.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_44: {
    id: 'LTVA_ART_44',
    kind: 'law', title: 'LTVA Art. 44 — exemptions',
    citation: 'Loi TVA, article 44',
    article: '44',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Exemptions without right of deduction — financial (44§1 a), real estate (44§1 b), medical (44§1 c), fund management (44§1 d), etc.',
    relevance: 'Legal basis for LUX_00, EXEMPT_44, EXEMPT_44A_FIN, EXEMPT_44B_RE, RC_EU_EX, RC_NONEU_EX, OUT_LUX_00.',
    last_reviewed: '2026-04-16',
    notes: 'The fund-management exemption (44§1 d) transposes Art. 135(1)(g) of EU Directive 2006/112/EC. Scope is actively developed by the CJEU — see CASES_EU.',
  },
  LTVA_ART_45: {
    id: 'LTVA_ART_45',
    kind: 'law', title: 'LTVA Art. 45 — opt-in to tax real-estate letting',
    citation: 'Loi TVA, article 45',
    article: '45',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Option for the lessor to tax real-estate letting (between VAT-registered taxable persons, mostly B2B).',
    relevance: 'Legal basis for OUT_LUX_17_OPT.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_54: {
    id: 'LTVA_ART_54',
    kind: 'law', title: 'LTVA Art. 54 — excluded deductions',
    citation: 'Loi TVA, article 54',
    article: '54',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Restrictions on input VAT deduction for passenger cars, entertainment, gifts, etc.',
    relevance: 'Legal basis for LUX_17_NONDED.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_60TER: {
    id: 'LTVA_ART_60TER',
    kind: 'law', title: 'LTVA Art. 60ter — VAT group',
    citation: 'Loi TVA, article 60ter',
    article: '60ter',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Optional LU VAT group regime (introduced 2018) — supplies within the group are outside the scope of VAT.',
    relevance: 'Legal basis for VAT_GROUP_OUT.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_61: {
    id: 'LTVA_ART_61',
    kind: 'law', title: 'LTVA Art. 61 — invoice content requirements',
    citation: 'Loi TVA, article 61',
    article: '61',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Mandatory content of a valid LU invoice (issuer/customer, VAT numbers, date, description, taxable amount, rate, VAT amount).',
    relevance: 'Guides the extractor prompt — what fields to extract for deduction support.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_62: {
    id: 'LTVA_ART_62',
    kind: 'law', title: 'LTVA Art. 62 — self-billing and bad-debt relief',
    citation: 'Loi TVA, article 62',
    article: '62',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Self-billing agreement requirements; regularisation of VAT on uncollectible receivables.',
    relevance: 'Legal basis for BAD_DEBT_RELIEF and for the "facturation par le preneur" extractor guidance.',
    last_reviewed: '2026-04-16',
  },
  LTVA_ART_65: {
    id: 'LTVA_ART_65',
    kind: 'law', title: 'LTVA Art. 65 — credit notes',
    citation: 'Loi TVA, article 65',
    article: '65',
    jurisdiction: 'LU', effective_until: null,
    subject: 'Content and timing requirements for credit notes (reference to original invoice, explicit correction).',
    relevance: 'Guides the is_credit_note extractor logic.',
    last_reviewed: '2026-04-16',
  },
};

// ────────────────────────── EU primary legislation ──────────────────────────
export const EU_LAW: Record<string, LegalSource> = {
  DIR_2006_112: {
    id: 'DIR_2006_112',
    kind: 'directive', title: 'EU VAT Directive',
    citation: 'Council Directive 2006/112/EC of 28 November 2006 on the common system of value added tax',
    jurisdiction: 'EU', effective_from: '2007-01-01', effective_until: null,
    subject: 'EU-wide common VAT system; every LTVA exemption article transposes a Directive article.',
    relevance: 'Cited in reasons alongside LTVA references. Art. 135(1)(g) fund management is the most important for this tool.',
    last_reviewed: '2026-04-16',
    sources_url: 'https://eur-lex.europa.eu/eli/dir/2006/112/oj',
  },
  DIR_2006_112_ART_135_1_G: {
    id: 'DIR_2006_112_ART_135_1_G',
    kind: 'directive', title: 'Directive Art. 135(1)(g) — management of special investment funds',
    citation: 'Directive 2006/112/EC, Art. 135(1)(g)',
    article: '135(1)(g)',
    jurisdiction: 'EU', effective_until: null,
    subject: 'Exemption for the management of special investment funds as defined by Member States.',
    relevance: 'The source of LTVA Art. 44§1 d. Scope actively developed by CJEU — see CASES_EU.BLACKROCK, CASES_EU.FISCALE_EENHEID_X.',
    last_reviewed: '2026-04-16',
  },
  REG_282_2011: {
    id: 'REG_282_2011',
    kind: 'regulation', title: 'EU Implementing Regulation 282/2011',
    citation: 'Council Implementing Regulation (EU) 282/2011',
    jurisdiction: 'EU', effective_from: '2011-07-01', effective_until: null,
    subject: 'Implementation rules on place of supply, taxable persons, evidentiary presumptions.',
    relevance: 'Reference for direction / place-of-supply logic in the classifier.',
    last_reviewed: '2026-04-16',
  },
};

// ────────────────────────── AED circulars ──────────────────────────
// Maintainer: keep `last_reviewed` current. An entry whose last_reviewed is
// more than 12 months old is listed by the legal-watch report as "to
// reconfirm". When the AED publishes a replacement, add the new circular
// here with superseded_by pointing to the old id, then set the old one's
// effective_until to the new one's effective_from.
export const CIRCULARS: Record<string, LegalSource> = {
  // PLACEHOLDER — populated from agent E-4 output. Each circular entry
  // will be added here with its number, year, subject, and effect on the
  // classifier. See `/docs/legal-watch.md` for the working list.
};

// ────────────────────────── CJEU and EU General Court ──────────────────────
export const CASES_EU: Record<string, LegalSource> = {
  VERSAOFAST: {
    id: 'VERSAOFAST',
    kind: 'case_eu', title: 'Versãofast — referral fees and fund management exemption',
    citation: 'General Court, T-657/24, 26 November 2025',
    jurisdiction: 'EU', effective_from: '2025-11-26', effective_until: null,
    subject: 'Treatment of referral fees paid to a non-LU intermediary by a LU fund as exempt under Art. 135(1)(g) / LTVA Art. 44§1 d.',
    relevance: 'Cited by the drafter prompt as an example of a legal-position flag.',
    last_reviewed: '2026-04-16',
    notes: 'See also AG opinion (2025-06) and the LU Administration\'s position on non-amendment of prior-year returns.',
  },
  BLACKROCK: {
    id: 'BLACKROCK',
    kind: 'case_eu', title: 'BlackRock Investment Management (UK) — scope of fund-management exemption',
    citation: 'CJEU, C-231/19, 2 July 2020',
    jurisdiction: 'EU', effective_from: '2020-07-02', effective_until: null,
    subject: 'A single indivisible supply of IT services to a fund manager is not exempt under Art. 135(1)(g) Directive — the exemption is narrow.',
    relevance: 'The cornerstone for INFERENCE C/D exclusion keywords and for RULES 10/12 entity-type guard. A supply must be "specific and essential to fund management" — IT licences, SaaS, training, legal/tax/audit services are NOT.',
    last_reviewed: '2026-04-16',
  },
  FISCALE_EENHEID_X: {
    id: 'FISCALE_EENHEID_X',
    kind: 'case_eu', title: 'Fiscale Eenheid X — boundary of "special investment funds"',
    citation: 'CJEU, C-595/13, 9 December 2015',
    jurisdiction: 'EU', effective_from: '2015-12-09', effective_until: null,
    subject: 'Defines the comparability test for what counts as a "special investment fund" under Art. 135(1)(g). An entity must be subject to specific state supervision and comparable to a UCITS.',
    relevance: 'Grounds the "qualifying fund" restriction in RULES 10/12 — only funds meeting this test get Art. 44§1 d treatment on incoming services.',
    last_reviewed: '2026-04-16',
  },
  ATP_PENSION: {
    id: 'ATP_PENSION',
    kind: 'case_eu', title: 'ATP Pension Service — pension funds as special investment funds',
    citation: 'CJEU, C-464/12, 13 March 2014',
    jurisdiction: 'EU', effective_from: '2014-03-13', effective_until: null,
    subject: 'Certain occupational-pension funds qualify as "special investment funds" for Art. 135(1)(g).',
    relevance: 'Expands the qualifying-fund perimeter beyond UCITS to include comparable pension vehicles.',
    last_reviewed: '2026-04-16',
  },
  DBKAG: {
    id: 'DBKAG',
    kind: 'case_eu', title: 'DBKAG / K — outsourced fund administration and tax services',
    citation: 'CJEU, C-58/20 & C-59/20, 17 June 2021',
    jurisdiction: 'EU', effective_from: '2021-06-17', effective_until: null,
    subject: 'Outsourced fund-admin services (including software-based NAV calculation) can fall within Art. 135(1)(g) if "specific and essential". Tax-advice services do not.',
    relevance: 'Grounds the expanded FUND_MGMT_KEYWORDS list (NAV calculation, fund administration, RTA, depositary services). Also validates the exclusion list (tax advisory = taxable).',
    last_reviewed: '2026-04-16',
  },
  DEUTSCHE_BANK: {
    id: 'DEUTSCHE_BANK',
    kind: 'case_eu', title: 'Deutsche Bank — narrow reading of the financial exemption',
    citation: 'CJEU, C-44/11, 19 July 2012',
    jurisdiction: 'EU', effective_from: '2012-07-19', effective_until: null,
    subject: 'Discretionary portfolio management combining investment advice and execution is taxable — neither a composite exempt financial service nor within the fund-management exemption.',
    relevance: 'Cited by INFERENCE E taxable backstop to prevent financial-adjacent keywords from over-exempting.',
    last_reviewed: '2026-04-16',
  },
  MORGAN_STANLEY: {
    id: 'MORGAN_STANLEY',
    kind: 'case_eu', title: 'Morgan Stanley — cross-border head-office / branch deduction',
    citation: 'CJEU, C-165/17, 24 January 2019',
    jurisdiction: 'EU', effective_from: '2019-01-24', effective_until: null,
    subject: 'Deduction right of a branch providing services to its head office; the deduction fraction depends on the mix of taxable and exempt supplies at both levels.',
    relevance: 'Relevant to LU entities with non-LU branches / head offices when computing pro-rata for box 095.',
    last_reviewed: '2026-04-16',
  },
  SKANDIA: {
    id: 'SKANDIA',
    kind: 'case_eu', title: 'Skandia America — cross-border VAT group supplies',
    citation: 'CJEU, C-7/13, 17 September 2014',
    jurisdiction: 'EU', effective_from: '2014-09-17', effective_until: null,
    subject: 'A supply from a non-EU head office to an EU VAT-group branch is taxable (the branch is not part of the head-office taxable person when it is in a VAT group).',
    relevance: 'Relevant to VAT_GROUP_OUT classification when the LU group has non-EU head-office relationships.',
    last_reviewed: '2026-04-16',
  },
  DANSKE_BANK: {
    id: 'DANSKE_BANK',
    kind: 'case_eu', title: 'Danske Bank — intra-EU VAT group supplies',
    citation: 'CJEU, C-812/19, 11 March 2021',
    jurisdiction: 'EU', effective_from: '2021-03-11', effective_until: null,
    subject: 'Similar to Skandia: a supply from a branch outside the VAT group (in another MS) to a branch in the group is taxable.',
    relevance: 'Same as Skandia for intra-EU arrangements.',
    last_reviewed: '2026-04-16',
  },
  // Further cases to populate from agent E-4 output.
};

// ────────────────────────── LU Tribunal administratif / Cour administrative ──
export const CASES_LU: Record<string, LegalSource> = {
  // Populated from agent E-4 output.
};

// ────────────────────────── Market practice (Big 4 / Magic Circle LU) ─────
export const PRACTICE: Record<string, LegalSource> = {
  // Populated from agent E-4 output. These are not law but prevailing
  // professional consensus. Citing them is explicit — we do NOT present
  // market practice as if it were law.
};

// ────────────────────────── All sources flat map ──────────────────────────
export const ALL_LEGAL_SOURCES: Record<string, LegalSource> = {
  ...LU_LAW,
  ...EU_LAW,
  ...CIRCULARS,
  ...CASES_EU,
  ...CASES_LU,
  ...PRACTICE,
};

export type LegalSourceId = keyof typeof ALL_LEGAL_SOURCES;

/** Resolve a source id to the full entry (or undefined if unknown). */
export function resolveLegalSource(id: string): LegalSource | undefined {
  return ALL_LEGAL_SOURCES[id];
}

/** Return every source whose last_reviewed is older than `months` months. */
export function sourcesDueForReview(
  months = 12,
  now: Date = new Date(),
): LegalSource[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);
  return Object.values(ALL_LEGAL_SOURCES)
    .filter(s => new Date(s.last_reviewed).getTime() < cutoff.getTime())
    .sort((a, b) => a.last_reviewed.localeCompare(b.last_reviewed));
}
