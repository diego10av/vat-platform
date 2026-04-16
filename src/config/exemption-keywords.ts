// Multi-language keyword dictionaries used by the classification rules engine.
// All matching is case-insensitive substring. Edit this file to extend coverage;
// no code changes needed elsewhere.

// ── VAT exemption references (mixed languages) ──
export const EXEMPTION_KEYWORDS: readonly string[] = [
  // Luxembourg LTVA
  'article 44', 'art. 44', 'art.44', 'art 44',
  'article 44, paragraphe 1er',
  // EU VAT Directive
  'article 135', 'art. 135', 'art.135',
  'article 132',   // public-interest exemptions (rare for funds)
  'artikel 135', 'artikel 44',
  // English
  'exempt from vat', 'exempt from tax', 'vat exempt', 'vat exemption',
  'not subject to vat', 'without vat', 'zero rated',
  'tax-exempt management',
  'regulated investment fund',
  // French
  'exonéré', 'exonere', 'exonération', 'exoneration',
  'exonéré de tva', 'hors tva', 'exonéré de la tva', 'non soumis à la tva',
  'régime d\'exonération',
  // German
  'steuerbefreit', 'steuerfrei', 'umsatzsteuerbefreit',
  'von der steuer befreit', 'mwst-befreit',
  // Italian
  'esente iva', 'esente da iva', 'esenzione iva',
  // Spanish
  'exento de iva', 'exención de iva', 'exencion de iva',
  // Polish
  'zwolniony z vat', 'zwolnione z podatku', 'zwolnienie z vat',
  'bez vat', 'bez podatku',
  // Dutch
  'vrijgesteld van btw', 'btw-vrijgesteld', 'vrijstelling artikel 11',
  // Portuguese
  'isento de iva', 'isenção de iva', 'isencao de iva',
  'isenção ao abrigo do artigo',
];

// ── Specific Art. 44 sub-paragraph references ──
// Used by the classifier to pick the correct sub-basis when an invoice cites
// a specific paragraph. The presence of any of these phrases in the invoice
// text overrides text-sweep heuristics.
// Luxembourg invoice styles vary in how they punctuate the Art. 44
// paragraphs: "Art. 44§1 a", "Art. 44 §1 a", "Art. 44 § 1 a",
// "Article 44, paragraphe 1er, lettre a", etc. The lists below enumerate
// the common forms; the classifier matches case-insensitively.
export const ART_44_PARA_A_REFS: readonly string[] = [
  // Art. 44§1 a — financial operations (banking, investment, insurance-adjacent)
  'article 44, paragraphe 1er, lettre a',
  'art. 44§1 a', 'art. 44 §1 a', 'art. 44 § 1 a', 'art 44 § 1 a',
  'art. 44 para 1 a', 'art 44 1 a', 'art. 44(1)(a)', 'art. 44 (1)(a)',
  'article 135(1)(a)', 'article 135(1)(b)', 'article 135(1)(c)',
  'article 135(1)(d)', 'article 135(1)(e)', 'article 135(1)(f)',
];
export const ART_44_PARA_B_REFS: readonly string[] = [
  // Art. 44§1 b — letting of immovable property
  'article 44, paragraphe 1er, lettre b',
  'art. 44§1 b', 'art. 44 §1 b', 'art. 44 § 1 b', 'art 44 § 1 b',
  'art. 44 para 1 b', 'art 44 1 b', 'art. 44(1)(b)', 'art. 44 (1)(b)',
  'article 135(1)(l)', 'article 135(2)',
];
export const ART_44_PARA_D_REFS: readonly string[] = [
  // Art. 44§1 d — management of special investment funds
  'article 44, paragraphe 1er, lettre d',
  'art. 44§1 d', 'art. 44 §1 d', 'art. 44 § 1 d', 'art 44 § 1 d',
  'art. 44 para 1 d', 'art 44 1 d', 'art. 44(1)(d)', 'art. 44 (1)(d)',
  'article 135(1)(g)', 'art. 135 §1 g', 'art. 135 § 1 g',
];
export const ART_45_OPT_REFS: readonly string[] = [
  // Art. 45 — opt-in to tax immovable letting
  'article 45 ltva', 'art. 45 ltva', 'art. 45',
  'option pour la taxation', 'option to tax',
];

// ── Fund management / investment advisory service descriptions ──
// Extensive coverage per CJEU Abbey National (C-169/04), BlackRock (C-231/19),
// DBKAG (C-58/20) and AED Circulaire 723. Includes core management + the
// outsourced services confirmed by the CJEU to fall within Art. 44§1 d.
export const FUND_MGMT_KEYWORDS: readonly string[] = [
  // Core management — English
  'fund management', 'aifm', 'aifm services', 'aifm delegation',
  'management fee', 'management fees',
  'management services', 'management company services', 'manco services',
  'third-party manco',
  'investment advisory', 'advisory fee',
  'sub-advisory', 'sub advisory',
  'portfolio management', 'portfolio management delegation',
  'investment management', 'collective portfolio management',
  'ucits management', 'ucits services',
  'risk management services',
  'performance fee', 'management and performance fee',
  // Outsourced admin — within Art. 44§1 d per CJEU
  'fund administration', 'administration de fonds',
  'nav calculation', 'calcul de la vni', 'calcul de la valeur nette d\'inventaire',
  'registrar and transfer agency', 'agent de transfert', 'rta',
  'transfer agency', 'registrar',
  'depositary services', 'dépositaire', 'depositary',
  'quasi-négociation',
  // French
  'gestion de fonds', 'gestion de portefeuille', 'conseil en investissement',
  'honoraires de gestion', 'frais de gestion',
  'gestion collective de portefeuille',
  // German
  'fondsverwaltung', 'fondsadministration', 'anlageberatung', 'portfoliomanagement',
  'verwaltungsgebühr', 'wertpapierverwaltung',
  // Italian
  'gestione del fondo', 'consulenza sugli investimenti', 'gestione di portafoglio',
  // Spanish
  'gestión de fondos', 'asesoramiento de inversiones', 'gestión de cartera',
  // Dutch
  'fondsbeheer', 'beleggingsadvies', 'portefeuillebeheer',
  // Portuguese
  'gestão de fundos', 'consultoria de investimentos',
];

// ── INFERENCE C/D exclusion keywords ──
// When any of these phrases is present, the invoice is LESS likely to fall
// within Art. 44§1 d — training, software licensing, M&A advisory and plain
// professional services are not "specific and essential to fund management"
// per BlackRock (C-231/19). The inference rules will bail out.
export const FUND_MGMT_EXCLUSION_KEYWORDS: readonly string[] = [
  'training', 'formation', 'cours', 'seminar', 'séminaire', 'schulung',
  'software licence', 'software license', 'licence logicielle',
  'saas', 'cloud', 'hosting', 'data hosting',
  'support informatique', 'it support', 'it consulting',
  'legal advisory', 'legal fee', 'avocat',
  'tax advisory', 'tax compliance', 'conseil fiscal',
  'audit', 'auditor', 'commissaire aux comptes', 'réviseur',
  'm&a advisory', 'merger advisory', 'conseil en m&a',
  'due diligence', 'capital markets advisory',
];

// ── Taxable professional-services backstop (INFERENCE E) ──
// When one of these phrases matches, the invoice is taxable regardless of
// other inference signals. Prevents legal / tax / audit invoices from being
// silently swept into the fund-management exemption through keyword
// collisions like "advisory".
export const TAXABLE_PROFESSIONAL_KEYWORDS: readonly string[] = [
  'legal advisory', 'legal services', 'legal fee', 'honoraires juridiques',
  'avocat', 'law firm', 'rechtsanwalt', 'kanzlei',
  'tax advisory', 'tax services', 'tax compliance',
  'conseil fiscal', 'honoraires fiscaux', 'steuerberatung',
  'audit', 'audit services', 'audit fee',
  'commissaire aux comptes', 'réviseur d\'entreprises',
  'wirtschaftsprüfer',
  'm&a advisory', 'merger and acquisition', 'transaction advisory',
  'due diligence',
  'notary', 'notaire', 'notar', 'notarielle',
  'consulting', 'consultance', 'unternehmensberatung',
  'it consulting', 'technology consulting',
];

// ── Real-estate / rent ──
// "Domiciliation" has been REMOVED — it is a Circ. 764 taxable service at
// 17%, not a real-estate letting. It was causing every SOPARFI's
// domiciliation invoice to be silently exempted.
export const REAL_ESTATE_KEYWORDS: readonly string[] = [
  'rent', 'lease', 'loyer', 'bail',
  'miete', 'pacht', 'affitto', 'alquiler', 'aluguel',
  'arrendamiento', 'alquiler comercial',
  'location immobilière', 'location de bureaux',
  'charges locatives',   // flag — may still be taxable
];

// ── Real-estate SUPPLIES that stay TAXABLE (carve-outs from Art. 44§1 b) ──
// Used by the classifier to block the Art 44§1 b exemption when these
// categories appear in the description. Per LTVA Art. 44§1 b points 1-4 and
// AED Circulaire 810.
export const REAL_ESTATE_TAXABLE_CARVEOUTS: readonly string[] = [
  'parking space', 'emplacement de parking', 'parking',
  'garage', 'stellplatz',
  'hotel', 'hôtellerie', 'hôtel', 'hébergement', 'hotel accommodation',
  'camping', 'camping pitch',
  'chasse', 'pêche', 'hunting', 'fishing rights',
  'coffre-fort', 'safe-deposit', 'safety deposit box',
  'location de machines', 'equipment rental',
];

// ── Domiciliation / corporate-services (ALWAYS TAXABLE at 17%) ──
// Separated out because it was previously mis-categorised in
// REAL_ESTATE_KEYWORDS, producing wrongly-exempted Circ. 764 services.
export const DOMICILIATION_KEYWORDS: readonly string[] = [
  'domiciliation',
  'domiciliation service',
  'corporate services',
  'secretarial services',
  'registered office service',
];

// ── Out-of-scope ──
// The bare "cssf" substring was too broad — it caught third-party invoices
// like a law firm's "CSSF filing assistance" (taxable 17%). Replaced with
// specific phrases for the public-authority levy itself.
export const OUT_OF_SCOPE_KEYWORDS: readonly string[] = [
  // Chamber of Commerce & similar member-authority levies
  'cotisation', 'subscription', 'membership', 'contribution fee',
  'chambre de commerce', 'chamber of commerce', 'handelskammer',
  'camera di commercio', 'cámara de comercio', 'izba handlowa',
  'bulletin de cotisation',
  // CSSF public-authority levy (the supervisory fee, NOT third-party services)
  'cssf supervisory fee', 'frais de surveillance cssf',
  'taxe d\'abonnement', 'abonnement cssf',
  // Registration / stamp duty
  'stamp duty', 'droit d\'enregistrement', 'droits de timbre',
  'droits d\'enregistrement',
  // Capital events — outside the scope of VAT per CJEU Kretztechnik C-465/03
  'shareholder contribution', 'apport en capital', 'capital contribution',
  // Dividends — outside the scope
  'dividend', 'dividende', 'distribution aux associés',
  // Damages / penalties — outside the scope per CJEU Société thermale C-277/05
  'fine', 'pénalité', 'penalty', 'dommages-intérêts', 'damages',
  // Employment — outside the scope per LTVA Art. 4
  'salary', 'wages', 'rémunération salariale', 'traitement mensuel',
];

// ── Goods (intra-Community acquisitions) ──
// The previous list had bare "purchase" and "acquisition" which also match
// services ("purchase of advisory services"). Narrowed to goods-qualified
// phrases.
export const GOODS_KEYWORDS: readonly string[] = [
  'goods', 'supply of goods', 'marchandises',
  'livraison de biens', 'livraison intracommunautaire',
  'warenlieferung', 'intra-community supply',
  'delivery of goods', 'livraison',
  'equipment', 'hardware', 'machine', 'machines', 'macchine',
  'inventory', 'stock', 'raw materials', 'matières premières',
  'waren', 'lieferung',
  'merci', 'acquisto di beni',
  'bienes', 'compra de bienes',
  'towary', 'zakup towarów', 'dostawa towarów',
  'vehicle', 'véhicule', 'fahrzeug',   // flag — capital good, deduction restricted
];

// ── Franchise threshold (Art. 57 LTVA) ──
// Suppliers under the threshold issue invoices without VAT citing this
// regime — post-Directive 2020/285 (effective 2025-01-01, €50k in LU).
export const FRANCHISE_KEYWORDS: readonly string[] = [
  'franchise', 'art. 57', 'article 57',
  'petite entreprise', 'small business',
  'kleinunternehmer', 'kleinunternehmerregelung',
  'régime de la franchise', 'régime franchise',
];

// ── Helpers ──
export function containsAny(haystack: string | null | undefined, needles: readonly string[]): boolean {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return needles.some(n => lower.includes(n.toLowerCase()));
}

/** Return the first keyword from `needles` that matches, or null. Useful
 *  when the reason string needs to quote the precise match for audit. */
export function findFirstMatch(
  haystack: string | null | undefined,
  needles: readonly string[],
): string | null {
  if (!haystack) return null;
  const lower = haystack.toLowerCase();
  for (const n of needles) {
    if (lower.includes(n.toLowerCase())) return n;
  }
  return null;
}
