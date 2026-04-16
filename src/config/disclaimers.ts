// ════════════════════════════════════════════════════════════════════════
// Professional-liability disclaimers used by the drafter agent.
//
// Replaces the prior one-line disclaimer that was insufficient for a
// Magic-Circle-quality VAT practice. The text below scopes the engagement
// explicitly, preserves reviewer judgement on individual classifications,
// excludes third-party reliance, and reserves the right to revise when
// new facts surface — all requirements of professional-responsibility
// coverage under LU practice.
//
// Maintainer: update this file (not the drafter prompt) when the
// disclaimer language needs to change. The prompt references the disclaimer
// by language key.
// ════════════════════════════════════════════════════════════════════════

export const DISCLAIMERS = {
  en:
`This return has been prepared on the basis of documents and information provided by the client. We have not audited the underlying books, contracts or invoices; we have not verified compliance of the invoices with the formal requirements of Art. 61 LTVA or AED Circular 706. The classification of individual supplies reflects our professional judgement on the facts as presented; a different classification may be reached on fuller investigation or upon a position taken by the AED. This communication is not a tax ruling and may not be relied upon by third parties. Our engagement does not cover direct tax, transfer pricing, DAC 6 / DAC 7, or any matter outside Luxembourg VAT. We will revise this return if additional facts or documents are subsequently brought to our attention.`,

  fr:
`Cette déclaration a été préparée sur la base des documents et informations fournis par le client. Nous n'avons pas audité la comptabilité, les contrats ni les factures sous-jacents ; nous n'avons pas vérifié la conformité des factures aux exigences formelles de l'article 61 LTVA ni à la Circulaire AED n° 706. La classification de chaque opération reflète notre jugement professionnel sur les faits tels que présentés ; une classification différente pourrait résulter d'une investigation plus approfondie ou d'une position prise par l'AED. Cette communication ne constitue pas une décision anticipée et ne peut être invoquée par des tiers. Notre mission ne couvre pas la fiscalité directe, les prix de transfert, DAC 6 / DAC 7, ni toute autre matière hors TVA luxembourgeoise. Nous réviserons la déclaration si des faits ou documents complémentaires étaient portés à notre connaissance.`,

  de:
`Diese Erklärung wurde auf Grundlage der vom Mandanten zur Verfügung gestellten Dokumente und Informationen erstellt. Wir haben die zugrunde liegenden Bücher, Verträge und Rechnungen nicht geprüft; wir haben die Einhaltung der Formvorschriften gemäß Art. 61 LTVA oder des AED-Rundschreibens Nr. 706 nicht verifiziert. Die Klassifizierung der einzelnen Umsätze spiegelt unser berufliches Urteil auf Basis der dargelegten Sachverhalte wider; eine andere Klassifizierung könnte sich aus einer umfassenderen Prüfung oder aus einer Position der AED ergeben. Diese Mitteilung stellt keine verbindliche Auskunft dar und darf von Dritten nicht herangezogen werden. Unser Mandat umfasst weder die direkte Besteuerung noch Verrechnungspreise, DAC 6 / DAC 7 oder sonstige nicht-Mehrwertsteuer-Angelegenheiten. Wir werden die Erklärung überarbeiten, falls uns nachträglich weitere Tatsachen oder Unterlagen bekannt werden.`,
} as const;

export type DisclaimerLanguage = keyof typeof DISCLAIMERS;

export function getDisclaimer(language?: string): string {
  const key = (language || 'en').toLowerCase() as DisclaimerLanguage;
  return DISCLAIMERS[key] ?? DISCLAIMERS.en;
}
