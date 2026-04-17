// ════════════════════════════════════════════════════════════════════════
// Declaration detail page — shared types.
//
// Extracted from page.tsx during the 2026-04-18 refactor. Every subfile
// (ReviewTable, PreviewPanel, OutputsPanel, FilingPanel, EmailDrafterModal)
// imports from here so the shapes stay in one place.
//
// No behaviour change — verbatim copies.
// ════════════════════════════════════════════════════════════════════════

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  declaration_id: string;
  description: string;
  amount_eur: number;
  vat_rate: number;
  vat_applied: number;
  rc_amount: number;
  amount_incl: number;
  treatment: string | null;
  treatment_source: string | null;
  ai_confidence: number | null;
  classification_rule: string | null;
  flag: number | boolean;
  flag_reason: string | null;
  flag_acknowledged: number | boolean;
  reviewed: number | boolean;
  note: string | null;
  state: string;
  sort_order: number;
  provider: string;
  provider_vat: string;
  country: string;
  invoice_date: string;
  invoice_number: string;
  direction: string;
  currency: string | null;
  currency_amount: number | null;
  ecb_rate: number | null;
  document_id: string | null;
  extraction_source: string | null;
  source_filename: string | null;
  deleted_reason?: string | null;
}

export interface DocumentRec {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: string;
  triage_result: string | null;
  triage_confidence: number | null;
  error_message: string | null;
}

export interface DeclarationData {
  id: string;
  entity_id: string;
  entity_name: string;
  year: number;
  period: string;
  status: string;
  regime: string;
  frequency: string;
  has_fx: number | boolean;
  has_outgoing: number | boolean;
  vat_number: string;
  matricule: string;
  filing_ref: string | null;
  filed_at: string | null;
  payment_ref: string | null;
  payment_confirmed_at: string | null;
  proof_of_filing_filename: string | null;
  proof_of_filing_uploaded_at: string | null;
  notes: string | null;
  documentStats: {
    total: number;
    uploaded: number;
    invoices: number;
    non_invoices: number;
    extracted: number;
    errors: number;
  };
  documents: DocumentRec[];
  lines: InvoiceLine[];
}

export type PreviewTarget =
  | { kind: 'document'; documentId: string; rowKey: string; filename?: string }
  | { kind: 'manual'; rowKey: string; provider: string }
  | null;

export interface BoxResult {
  box: string;
  label: string;
  section: string;
  value: number;
  computation: 'sum' | 'formula' | 'manual';
  formula?: string;
  manual?: boolean;
}

export interface ECDFReport {
  regime: 'simplified' | 'ordinary';
  year: number;
  period: string;
  form_version: string;
  boxes: BoxResult[];
  box_values: Record<string, number>;
  totals: { vat_due: number; payable: number; credit: number };
  manual_boxes_pending: string[];
  warnings: string[];
}

export interface Payment {
  reference: string;
  iban: string;
  bic: string;
  beneficiary: string;
  amount: number;
}

export interface OutputsResponse {
  ecdf: ECDFReport;
  payment: Payment | null;
  payment_error: string | null;
  declaration: { year: number; period: string; status: string; entity_name: string };
  cost?: { calls: number; eur: number };
}
