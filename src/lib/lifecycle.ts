// Declaration lifecycle state machine per PRD Section 2

export type DeclarationStatus =
  | 'created'
  | 'uploading'
  | 'extracting'
  | 'classifying'
  | 'review'
  | 'approved'
  | 'filed'
  | 'paid';

// Valid transitions: [from, to]
const VALID_TRANSITIONS: [DeclarationStatus, DeclarationStatus][] = [
  ['created', 'uploading'],
  ['uploading', 'extracting'],
  ['extracting', 'classifying'],
  ['classifying', 'review'],
  ['review', 'approved'],
  ['approved', 'filed'],
  ['filed', 'paid'],
  // Reopen transitions
  ['review', 'uploading'],      // User adds more invoices
  ['approved', 'review'],       // User reopens for changes
  ['filed', 'review'],          // AED rejection or post-filing error (critical audit event)
];

export function canTransition(from: DeclarationStatus, to: DeclarationStatus): boolean {
  return VALID_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export function getValidNextStates(current: DeclarationStatus): DeclarationStatus[] {
  return VALID_TRANSITIONS
    .filter(([f]) => f === current)
    .map(([, t]) => t);
}

// Document status per PRD Section 2.4
export type DocumentStatus =
  | 'uploaded'
  | 'triaging'
  | 'triaged'
  | 'extracting'
  | 'extracted'
  | 'rejected'
  | 'error';

// Invoice line state per PRD Section 2.5
export type InvoiceLineState =
  | 'extracted'
  | 'classified'
  | 'reviewed'
  | 'deleted';

// Blocking rules per PRD Section 2.3
export interface BlockingCheck {
  canApprove: boolean;
  blockingErrors: string[];
  warnings: string[];
}

export function checkApprovalBlocking(lines: Array<{
  treatment: string | null;
  flag: boolean;
  flag_acknowledged: boolean;
  state: string;
}>, totalVatDue: number): BlockingCheck {
  const blockingErrors: string[] = [];
  const warnings: string[] = [];

  const activeLines = lines.filter(l => l.state !== 'deleted');

  // Zero invoice rows
  if (activeLines.length === 0) {
    blockingErrors.push('No invoice lines exist');
  }

  // Unclassified rows
  const unclassified = activeLines.filter(l => !l.treatment);
  if (unclassified.length > 0) {
    blockingErrors.push(`${unclassified.length} invoice line(s) have no treatment assigned`);
  }

  // Unacknowledged flags
  const unacknowledgedFlags = activeLines.filter(l => l.flag && !l.flag_acknowledged);
  if (unacknowledgedFlags.length > 0) {
    blockingErrors.push(`${unacknowledgedFlags.length} flagged line(s) have not been acknowledged`);
  }

  // Negative VAT
  if (totalVatDue < 0) {
    blockingErrors.push(`Total VAT due is negative (EUR ${totalVatDue.toFixed(2)}) — indicates a calculation error`);
  }

  return {
    canApprove: blockingErrors.length === 0,
    blockingErrors,
    warnings,
  };
}
