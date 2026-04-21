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

// ── Construction / renovation / cleaning (Art. 61§2 c LTVA domestic RC) ──
// LU-to-LU supplies of these works are reverse-charged to the recipient
// per Art. 61§2 c LTVA + Règlement grand-ducal du 21 décembre 1991.
export const CONSTRUCTION_KEYWORDS: readonly string[] = [
  'construction', 'travaux de construction', 'bauleistung',
  'renovation', 'rénovation', 'renovierung',
  'demolition', 'démolition', 'abbruch',
  'cleaning', 'nettoyage', 'reinigung',
  'gros œuvre', 'second œuvre',
  'masonry', 'plumbing', 'plomberie', 'installation',
  'electrical works', 'travaux électriques', 'elektroinstallation',
];

// ── Scrap metals / emission allowances / electricity wholesale (Art. 61§2 a-b LTVA) ──
// Domestic reverse-charge per Art. 199a Directive (quick-reaction mechanism).
export const SPECIFIC_RC_KEYWORDS: readonly string[] = [
  'scrap', 'ferraille', 'altmetall',
  'used materials', 'matériaux de récupération',
  'waste', 'déchets', 'abfall',
  'emission allowance', 'quota d\'émission', 'emissionszertifikat',
  'co2 allowance',
  'electricity wholesale', 'électricité en gros',
  'gas wholesale',
];

// ── Reduced-rate service categories (for rate-split reverse charge) ──
// Used by RULES 11B/C/D and 13B/C/D to pick the correct RC rate when the
// service is in one of the LU reduced-rate categories (Art. 40-1 LTVA /
// Annex III Directive).
export const REDUCED_RATE_14_KEYWORDS: readonly string[] = [
  // Note: the LU 14% parking rate has narrowed post-2022/542. Currently
  // applies to certain depositary-adjacent services (CONFIRM against
  // LTVA Annex post-2025).
  'depositary 14', 'garde de valeurs mobilières',
];
export const REDUCED_RATE_08_KEYWORDS: readonly string[] = [
  // Reduced 8% — district heating, some cultural / sports services
  'district heating', 'chauffage urbain', 'fernwärme',
  'admission fee sports', 'billetterie sportive',
];
export const REDUCED_RATE_03_KEYWORDS: readonly string[] = [
  // Super-reduced 3% — books, e-books, certain foodstuffs, printed matter
  'book', 'livre', 'buch', 'libro', 'książka',
  'e-book', 'ebook', 'e-publication',
  'periodical', 'périodique', 'zeitschrift',
  'foodstuffs', 'denrées alimentaires', 'lebensmittel',
  'pharmaceutical', 'médicament', 'arzneimittel',
];

// ── Pre-payment / advance / deposit keywords (Art. 61§1 LTVA chargeability) ──
export const PREPAYMENT_KEYWORDS: readonly string[] = [
  'acompte', 'avance', 'deposit', 'advance payment',
  'pre-payment', 'prepayment', 'prepaid',
  'anzahlung', 'vorauszahlung',
  'anticipo',
];

// ── Bad-debt relief (Art. 62 LTVA regularisation) ──
export const BAD_DEBT_KEYWORDS: readonly string[] = [
  'bad debt', 'créance irrécouvrable', 'créance douteuse',
  'uneinbringlich', 'uneinbringliche forderung',
  'insolvency', 'faillite', 'insolvenzverfahren',
  'debt write-off', 'radiation de créance',
];

// ── Platform economy — deemed supplier (Fenix / ViDA) ──
// Identifies invoices from platforms that are deemed the supplier for
// B2C transactions under Art. 9a Reg. 282/2011 + ViDA 2027 extension.
// Authority: Fenix International C-695/20 (validity of Art. 9a).
// NOTE: Versãofast T-657/24 was PREVIOUSLY cited here but is a CREDIT
// INTERMEDIATION case, not a platform-economy case — the correct
// attribution is in CREDIT_INTERMEDIATION_KEYWORDS (RULE 36).
export const PLATFORM_DEEMED_SUPPLIER_KEYWORDS: readonly string[] = [
  'marketplace facilitator', 'deemed supplier',
  'plateforme de distribution', 'intermédiaire numérique',
  'platform economy', 'art. 9a', 'article 9a',
  'art. 14a', 'article 14a',
];

// ── Non-deductible LU input VAT categories (Art. 54 LTVA) ──
// LU 17% invoices that should land in LUX_17_NONDED rather than LUX_17.
export const NON_DEDUCTIBLE_KEYWORDS: readonly string[] = [
  'restauration', 'restaurant', 'repas d\'affaires',
  'hotel', 'hôtel', 'accommodation',
  'reception', 'réception', 'client entertainment',
  'entertainment', 'cadeau', 'gift',
  'tabac', 'tobacco',
  'véhicule de tourisme', 'passenger car',
];

// ── Clearly-taxable professional services for passive-holding guard ──
// A pure passive SOPARFI is NOT a taxable person (Polysar C-60/90 /
// Cibo Participations C-16/00). When a clearly-taxable service is
// received by a passive holding, the supplier should charge origin-
// country VAT; the LU recipient does NOT reverse-charge. The classifier
// surfaces a flag because the deduction right depends on active-holding
// status.
export const PASSIVE_HOLDING_HIGH_FLAG_KEYWORDS: readonly string[] = [
  'due diligence', 'm&a advisory', 'acquisition advisory',
  'legal advisory', 'tax advisory',
  'corporate finance advisory',
];

// ── Independent director fees (CJEU C-288/22 TP) ──
// Natural-person independent directors are NOT taxable persons per the
// 21 December 2023 CJEU ruling — no VAT on their fees. Legal-person
// directors remain taxable per AED Circ. 781-2 but the position is
// contested. The classifier uses these keywords to trigger RULES 32a/b
// and then inspects the supplier name to decide natural vs legal.
export const DIRECTOR_FEE_KEYWORDS: readonly string[] = [
  // English
  'director fee', 'director fees', 'board fee', 'board fees',
  'board member fee', 'board member fees',
  'non-executive director', 'non executive director',
  'independent director', 'directorship fee', 'directorship fees',
  'administrator fee', 'administrator fees',
  // French (Luxembourg)
  'jetons de présence', 'jeton de présence',
  'tantièmes', 'tantième',
  'tantièmes d\'administrateur',
  'indemnité de conseil d\'administration',
  'rémunération d\'administrateur',
  'rémunération du conseil d\'administration',
  'honoraires d\'administrateur',
  'mandat d\'administrateur', 'mandat social',
  // German
  'verwaltungsratsmitglied', 'aufsichtsratsmitglied',
  'vergütung für verwaltungsratsmitglied',
  'aufsichtsratsvergütung', 'tantieme',
  // Italian
  'compenso amministratore', 'compenso amministratori',
  'gettone di presenza',
  // Spanish
  'honorarios del consejero', 'remuneración del consejero',
  'dietas de asistencia al consejo',
  // Portuguese
  'remuneração de administrador',
  // Dutch
  'vergoeding bestuurder', 'bestuurderbeloning',
  'commissaris',
];

// ── Carry interest / carried interest ──
// Substance-driven classification: OUT_SCOPE when paid to a GP who is
// also an investor (profit distribution on invested capital), vs
// taxable 17% or EXEMPT_44 when paid to a pure-service GP
// (performance fee for services). Classifier ALWAYS flags these.
export const CARRY_INTEREST_KEYWORDS: readonly string[] = [
  'carried interest', 'carry interest', 'carry distribution',
  'carry payment', 'carry allocation', 'carry payable',
  'performance allocation', 'performance participation',
  'gp carry', 'gp profit share', 'general partner carry',
  'promote' /* US-style equivalent */, 'promoted interest',
  'intéressement différé', 'intéressement aux plus-values',
  'gewinnbeteiligung', 'carried-interest tranche',
  'incentive allocation',
];

// ── Waterfall distributions ──
// Profit distributions flowing through a fund's waterfall to LPs / GP.
// Default OUT_SCOPE; structuring / set-up fees embedded in the waterfall
// are independently taxable — captured by a separate keyword list.
export const WATERFALL_DISTRIBUTION_KEYWORDS: readonly string[] = [
  'waterfall distribution', 'waterfall payment',
  'distribution aux associés commanditaires',
  'lp distribution', 'limited partner distribution',
  'preferred return', 'preferred-return step',
  'hurdle distribution', 'hurdle payment',
  'catch-up distribution', 'catch up distribution',
  'gp catch-up', 'catch-up step',
  'capital distribution', 'return of capital',
  'remboursement de capital', 'retour sur investissement',
  'distribution waterfall',
];

export const STRUCTURING_FEE_KEYWORDS: readonly string[] = [
  'structuring fee', 'structuring fees',
  'set-up fee', 'setup fee', 'set up fee',
  'formation fee', 'organisational fee',
  'frais de structuration', 'frais de constitution',
  'strukturierungsgebühr',
];

// ── Credit intermediation (Versãofast T-657/24 / Ludwig C-453/05) ──
// Materially widened safe harbour post-26 November 2025. Drives RULE 36:
// LU → LUX_00, EU → RC_EU_EX, non-EU → RC_NONEU_EX (Art. 44§1 a LTVA).
// Counter-examples (still taxable): pure marketing, generic info, data
// enrichment to a bank, debt collection (Aspiro C-40/15 — handled on the
// SV servicer path in RULE 37, not here).
export const CREDIT_INTERMEDIATION_KEYWORDS: readonly string[] = [
  // English
  'credit intermediation', 'credit broker', 'credit brokering',
  'mortgage broker', 'mortgage brokering', 'mortgage intermediation',
  'loan broker', 'loan brokering', 'loan intermediation',
  'loan origination', 'loan originator', 'loan referral',
  'home loan broker', 'consumer-credit intermediation', 'consumer credit broker',
  'credit application assistance', 'credit mediation',
  'negotiation of credit', 'negotiation of loan', 'negotiation of loans',
  'private-debt placement', 'private debt placement',
  'placement agent private debt',
  'loan arrangement fee — intermediation', // flagged variant
  // French
  'intermédiation crédit', 'intermédiation de crédit', 'intermédiaire en crédit',
  'courtier en crédit', 'courtier en prêts', 'courtier en prêts immobiliers',
  'courtage de prêt', 'courtage en prêts', 'courtage en crédits',
  'apporteur d\'affaires crédit', 'apport d\'affaires crédit',
  'apporteur d\'affaires pour', 'apporteur d\'affaires bancaire',
  'sous-agent de crédit', 'sous-agent crédit', 'sub-agent crédit',
  'agent apporteur', 'intermédiaire financier', 'intermédiaire bancaire',
  'intermédiation en opérations de banque',
  // German
  'kreditvermittlung', 'kreditvermittler', 'kreditmakler',
  'darlehensvermittlung', 'hypothekenvermittler',
  // Italian
  'mediazione creditizia', 'mediatore creditizio', 'intermediazione creditizia',
  // Spanish
  'intermediación crediticia', 'intermediación de crédito', 'mediación crediticia',
  'corredor de créditos', 'corredor de préstamos',
  // Portuguese
  'mediação de crédito', 'mediador de crédito', 'intermediário de crédito',
  'corretor de crédito', 'corretor de empréstimos',
  // Dutch
  'kredietbemiddeling', 'kredietbemiddelaar', 'hypotheekbemiddeling',
];

// ── Securitization vehicle — fund-management exemption perimeter ──
// For entity_type = 'securitization_vehicle'. Management services received
// by the SV are exempt Art. 44§1 d per Fiscale Eenheid X C-595/13 extension,
// Loi du 22 mars 2004 (modifiée 2022). The classifier path piggy-backs on
// the existing FUND_MGMT_KEYWORDS list — these are the additional SV-specific
// phrases that the fund list did not cover.
export const SECURITIZATION_MGMT_KEYWORDS: readonly string[] = [
  // English — SV-specific management / admin
  'securitization vehicle management', 'securitisation vehicle management',
  'sv management', 'sv administration',
  'compartment management', 'compartment administration',
  'securitisation administration', 'securitization administration',
  'calculation agent', 'agent de calcul',
  'paying agent', 'agent payeur',
  'listing agent', 'agent de cotation',
  'corporate administration services', // SV-specific when combined with SV-vehicle context
  'asset-backed note administration', 'notes administration',
  'waterfall calculation', 'waterfall administration', // distinct from the distribution keywords
  // French
  'administration du véhicule de titrisation', 'gestion du véhicule de titrisation',
  'administration des compartiments', 'gestion des compartiments',
  // German
  'verbriefungsverwaltung', 'verwaltung der verbriefungsgesellschaft',
  // Italian
  'amministrazione veicolo di cartolarizzazione',
  // Portuguese
  'administração veículo de titularização',
];

// ── Securitization-vehicle SERVICER / debt-collection keywords ──
// Triggers the Aspiro C-40/15 split-analysis flag when the recipient is a
// securitization_vehicle. Servicer agreements often bundle exempt management
// (cash management, reporting) with taxable collection / enforcement — cifra
// refuses to auto-exempt and routes to the reviewer.
export const SECURITIZATION_SERVICER_KEYWORDS: readonly string[] = [
  // English
  'servicing agreement', 'servicer fee', 'servicer fees',
  'master servicer', 'special servicer', 'back-up servicer',
  'debt collection', 'collection services', 'collections administration',
  'loan recovery', 'receivables recovery', 'recovery services',
  'delinquency management', 'delinquent loan servicing',
  'enforcement services', 'enforcement against debtor',
  'portfolio servicing',
  'npl servicing', 'non-performing loan servicing',
  // French
  'convention de servicing', 'accord de servicing',
  'recouvrement de créances', 'recouvrement amiable', 'recouvrement contentieux',
  'gestion des impayés', 'gestion du contentieux créances',
  // German
  'servicing-vertrag', 'forderungseinzug', 'inkassotätigkeit',
  'mahnwesen', 'forderungsmanagement',
  // Italian
  'contratto di servicing', 'recupero crediti',
  // Spanish
  'contrato de servicing', 'recuperación de créditos',
  // Portuguese
  'contrato de servicing', 'recuperação de créditos',
];

// ── IGP / cost-sharing (Art. 44§1 y LTVA / Art. 132(1)(f) Directive) ──
// Narrowed by Kaplan C-77/19 (cross-border excluded), DNB Banka C-326/15
// + Aviva C-605/15 (financial / insurance sectors excluded). Classifier
// routes by country + entity_type per RULE 35 / 35-lu / 35-ok.
export const IGP_KEYWORDS: readonly string[] = [
  'cost-sharing', 'cost sharing', 'cost-pooling', 'cost pooling',
  'independent group of persons', 'igp',
  'groupement autonome de personnes', 'gap',
  'article 132(1)(f)', 'art. 132(1)(f)', 'art. 132 (1)(f)',
  'article 44§1 y', 'art. 44§1 y', 'art. 44 § 1 y',
  'kostenteilungsgemeinschaft', 'kostengemeinschaft',
  'shared-services group',
];

// ── Legal-entity suffixes (used to detect natural vs legal person directors) ──
// Shared between provider-name normalisation and the supplier-kind
// detection that routes RULES 32a vs 32b. Exported so the classifier
// can inspect the supplier name without re-declaring the list.
export const LEGAL_SUFFIXES: readonly string[] = [
  'sarl', 's.a.r.l.', 's.à.r.l.', 's.à r.l.', 's.a r.l.', 'sàrl',
  'sa', 's.a.', 'scs', 'sca', 's.c.a.', 'scsp',
  'sicav', 'sicaf', 'sif', 'raif', 'sicar',
  'gmbh', 'ag', 'ltd', 'limited', 'llp', 'lp', 'plc', 'inc', 'llc',
  'sas', 's.a.s.', 'sprl', 'bvba', 'nv', 'bv',
  'sp. z o.o.', 'sp z o o', 'spzoo',
  'sl', 's.l.',
  // Common English descriptors used where a suffix is missing
  'company', 'corp', 'corporation', 'limited', 'partnership',
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
