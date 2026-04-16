// AED payment reference generator per PRD §7.2.
// Format: [Matricule] EA [Year code][Period code]
//
//   Annual:    20232456346 EA25Y1
//   Quarterly: 20232456346 EA26Q1
//   Monthly:   20232456346 EA2601  (Jan=01, …, Dec=12)
//
// AED bank details are constants — do not take them from user input.

export interface PaymentInstructions {
  reference: string;       // full structured reference
  matricule: string;
  year_code: string;       // 2-digit
  period_code: string;     // Y1 | Q1..Q4 | 01..12
  amount: number;          // EUR
  iban: string;
  bic: string;
  beneficiary: string;
}

export const AED_BANK_DETAILS = {
  iban: 'LU35 0019 5655 0668 3000',
  bic: 'BCEELULL',
  beneficiary: 'AED-RECETTE CENTRALE-TVA',
} as const;

export function generatePaymentReference(params: {
  matricule: string | null;
  year: number;
  period: string;
  amount: number;
}): PaymentInstructions {
  const matricule = (params.matricule || '').replace(/\s+/g, '');
  if (!matricule) {
    throw new Error('Entity matricule is required to generate a payment reference.');
  }
  // Luxembourg entity matricules are either 11 digits (legal entities) or
  // 13 digits (individuals / older numbers). Anything else almost certainly
  // produces a reference the AED will refuse.
  if (!/^\d{11}(\d{2})?$/.test(matricule)) {
    throw new Error(
      `Invalid matricule format: "${matricule}". Expected 11 or 13 digits (no dots, no spaces).`,
    );
  }
  if (!Number.isInteger(params.year) || params.year < 2000 || params.year > 2099) {
    throw new Error(`Invalid year for payment reference: ${params.year}.`);
  }
  const year_code = String(params.year % 100).padStart(2, '0');
  const period_code = normalisePeriodCode(params.period);
  return {
    reference: `${matricule} EA${year_code}${period_code}`,
    matricule,
    year_code,
    period_code,
    amount: Math.round(params.amount * 100) / 100,
    iban: AED_BANK_DETAILS.iban,
    bic: AED_BANK_DETAILS.bic,
    beneficiary: AED_BANK_DETAILS.beneficiary,
  };
}

// Strict period normaliser. The previous implementation silently fell back
// to the sanitised first four characters of whatever junk was given (and
// further to 'Y1'), which meant a typo like "Q5" or "XYZ" would produce
// a plausible-looking reference that the AED bank would bounce. We now
// throw instead, so the caller must supply a recognised period.
function normalisePeriodCode(period: string): string {
  const p = (period || '').trim().toUpperCase();
  // Annual
  if (p === 'Y1' || p === 'ANNUAL' || p === '') return 'Y1';
  // Quarterly
  if (/^Q[1-4]$/.test(p)) return p;
  // Monthly — numeric 1..12 (with or without leading zero)
  if (/^\d{1,2}$/.test(p)) {
    const n = Number(p);
    if (n >= 1 && n <= 12) return String(n).padStart(2, '0');
  }
  // Month names — EN and FR
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const monthsFr = ['JAN','FEV','MAR','AVR','MAI','JUI','JUL','AOU','SEP','OCT','NOV','DEC'];
  const tri = p.slice(0, 3);
  let idx = months.indexOf(tri);
  if (idx < 0) idx = monthsFr.indexOf(tri);
  if (idx >= 0) return String(idx + 1).padStart(2, '0');
  throw new Error(
    `Invalid period code "${period}". Expected one of: Y1, Q1..Q4, 01..12, or a month name.`,
  );
}
