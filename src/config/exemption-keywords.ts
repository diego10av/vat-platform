// Multi-language keyword dictionaries used by the classification rules engine.
// All matching is case-insensitive substring. Edit this file to extend coverage;
// no code changes needed elsewhere.

// ── VAT exemption references (mixed languages) ──
export const EXEMPTION_KEYWORDS: readonly string[] = [
  // Luxembourg LTVA
  'article 44', 'art. 44', 'art.44',
  // EU VAT Directive
  'article 135', 'art. 135', 'art.135',
  // English
  'exempt from vat', 'exempt from tax', 'vat exempt', 'vat exemption',
  'not subject to vat', 'without vat', 'zero rated',
  // French
  'exonéré', 'exonere', 'exonération', 'exoneration',
  'exonéré de tva', 'hors tva', 'exonéré de la tva', 'non soumis à la tva',
  // German
  'steuerbefreit', 'steuerfrei', 'umsatzsteuerbefreit',
  'von der steuer befreit', 'mwst-befreit',
  // Italian
  'esente iva', 'esente da iva', 'esenzione iva',
  // Spanish
  'exento de iva', 'exención de iva', 'exencion de iva',
  // Polish
  'zwolniony z vat', 'zwolnione z podatku', 'zwolnienie z vat',
  // Dutch
  'vrijgesteld van btw', 'btw-vrijgesteld',
  // Portuguese
  'isento de iva', 'isenção de iva', 'isencao de iva',
];

// ── Fund management / investment advisory service descriptions ──
export const FUND_MGMT_KEYWORDS: readonly string[] = [
  // English
  'fund management', 'aifm', 'management fee', 'management fees',
  'management services', 'investment advisory', 'advisory fee',
  'sub-advisory', 'sub advisory', 'portfolio management',
  'investment management',
  // French
  'gestion de fonds', 'gestion de portefeuille', 'conseil en investissement',
  'honoraires de gestion', 'frais de gestion',
  // German
  'fondsverwaltung', 'anlageberatung', 'portfoliomanagement', 'verwaltungsgebühr',
  // Italian
  'gestione del fondo', 'consulenza sugli investimenti', 'gestione di portafoglio',
  // Spanish
  'gestión de fondos', 'asesoramiento de inversiones', 'gestión de cartera',
  // Dutch
  'fondsbeheer', 'beleggingsadvies', 'portefeuillebeheer',
  // Portuguese
  'gestão de fundos', 'consultoria de investimentos',
];

// ── Real-estate / rent (LUX_00 Art 44§1 b) ──
export const REAL_ESTATE_KEYWORDS: readonly string[] = [
  'rent', 'lease', 'loyer', 'bail', 'domiciliation',
  'miete', 'pacht', 'affitto', 'alquiler', 'aluguel',
];

// ── Out-of-scope (Chamber of Commerce, regulator subscriptions, …) ──
export const OUT_OF_SCOPE_KEYWORDS: readonly string[] = [
  'cotisation', 'subscription', 'membership', 'contribution fee',
  'chambre de commerce', 'chamber of commerce', 'handelskammer',
  'camera di commercio', 'cámara de comercio', 'izba handlowa',
  'cssf',
  'bulletin de cotisation',
];

// ── Goods (intra-Community acquisitions) ──
export const GOODS_KEYWORDS: readonly string[] = [
  'goods', 'acquisition', 'marchandises', 'achat', 'purchase',
  'delivery', 'livraison', 'equipment', 'hardware',
  'waren', 'lieferung',
  'merci', 'acquisto',
  'bienes', 'compra',
  'towary', 'zakup', 'dostawa',
];

// ── Helpers ──
export function containsAny(haystack: string | null | undefined, needles: readonly string[]): boolean {
  if (!haystack) return false;
  const lower = haystack.toLowerCase();
  return needles.some(n => lower.includes(n.toLowerCase()));
}
