import { Pool, type QueryResultRow } from 'pg';
import { v4 as uuidv4 } from 'uuid';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await getPool().query<T>(text, params);
  return rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export async function execute(text: string, params?: unknown[]): Promise<void> {
  await getPool().query(text, params);
}

export async function initializeSchema(): Promise<void> {
  await execute(`
    -- Entities: client companies/funds
    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      vat_number TEXT,
      matricule TEXT,
      rcs_number TEXT,
      legal_form TEXT,
      entity_type TEXT,
      regime TEXT NOT NULL DEFAULT 'simplified',
      frequency TEXT NOT NULL DEFAULT 'annual',
      address TEXT,
      bank_iban TEXT,
      bank_bic TEXT,
      tax_office TEXT,
      client_name TEXT,
      client_email TEXT,
      csp_name TEXT,
      csp_email TEXT,
      has_fx BOOLEAN NOT NULL DEFAULT false,
      has_outgoing BOOLEAN NOT NULL DEFAULT false,
      has_recharges BOOLEAN NOT NULL DEFAULT false,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Declarations: one per entity per period
    CREATE TABLE IF NOT EXISTS declarations (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      year INTEGER NOT NULL,
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      vat_due NUMERIC,
      filed_at TIMESTAMPTZ,
      approved_at TIMESTAMPTZ,
      approved_by TEXT,
      filing_ref TEXT,
      payment_ref TEXT,
      payment_confirmed_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entity_id, year, period)
    );

    -- Documents: uploaded files
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      declaration_id TEXT NOT NULL REFERENCES declarations(id),
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      page_count INTEGER,
      status TEXT NOT NULL DEFAULT 'uploaded',
      triage_result TEXT,
      triage_confidence NUMERIC,
      error_message TEXT,
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Invoices: extracted from documents
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES documents(id),
      declaration_id TEXT NOT NULL REFERENCES declarations(id),
      provider TEXT,
      provider_vat TEXT,
      country TEXT,
      invoice_date TEXT,
      invoice_number TEXT,
      direction TEXT NOT NULL DEFAULT 'incoming',
      total_ex_vat NUMERIC,
      total_vat NUMERIC,
      total_incl_vat NUMERIC,
      currency TEXT,
      currency_amount NUMERIC,
      ecb_rate NUMERIC,
      extraction_source TEXT NOT NULL DEFAULT 'ai',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Invoice Lines: VAT treatment rows (the core working layer)
    CREATE TABLE IF NOT EXISTS invoice_lines (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id),
      declaration_id TEXT NOT NULL REFERENCES declarations(id),
      description TEXT,
      amount_eur NUMERIC,
      vat_rate NUMERIC,
      vat_applied NUMERIC,
      rc_amount NUMERIC,
      amount_incl NUMERIC,
      treatment TEXT,
      treatment_source TEXT,
      ai_confidence NUMERIC,
      override_id TEXT,
      flag BOOLEAN NOT NULL DEFAULT false,
      flag_reason TEXT,
      flag_acknowledged BOOLEAN NOT NULL DEFAULT false,
      reviewed BOOLEAN NOT NULL DEFAULT false,
      sort_order INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      state TEXT NOT NULL DEFAULT 'extracted',
      deleted_at TIMESTAMPTZ,
      deleted_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Precedents: historical treatments by provider/entity
    CREATE TABLE IF NOT EXISTS precedents (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      provider TEXT NOT NULL,
      country TEXT,
      treatment TEXT NOT NULL,
      description TEXT,
      last_amount NUMERIC,
      last_used TEXT,
      times_used INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(entity_id, provider, country)
    );

    -- Legal overrides: jurisprudence changes
    CREATE TABLE IF NOT EXISTS legal_overrides (
      id TEXT PRIMARY KEY,
      rule_changed TEXT NOT NULL,
      new_treatment TEXT NOT NULL,
      legal_basis TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      provider_match TEXT,
      description_match TEXT,
      justification TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Audit log: every edit tracked
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      entity_id TEXT,
      declaration_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Registrations: VAT registration tracking (schema only for V1)
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL REFERENCES entities(id),
      status TEXT NOT NULL DEFAULT 'docs_requested',
      regime_requested TEXT,
      filed_at TIMESTAMPTZ,
      filing_ref TEXT,
      vat_received_at TIMESTAMPTZ,
      docs_checklist TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_declarations_entity ON declarations(entity_id);
    CREATE INDEX IF NOT EXISTS idx_documents_declaration ON documents(declaration_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_declaration ON invoices(declaration_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_document ON invoices(document_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_declaration ON invoice_lines(declaration_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON invoice_lines(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_precedents_entity ON precedents(entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_declaration ON audit_log(declaration_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id);
  `);
}

export function generateId(): string {
  return uuidv4();
}

export async function logAudit(params: {
  userId?: string;
  entityId?: string;
  declarationId?: string;
  action: string;
  targetType: string;
  targetId: string;
  field?: string;
  oldValue?: string;
  newValue?: string;
}): Promise<void> {
  await execute(
    `INSERT INTO audit_log (id, user_id, entity_id, declaration_id, action, target_type, target_id, field, old_value, new_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      generateId(),
      params.userId || 'founder',
      params.entityId || null,
      params.declarationId || null,
      params.action,
      params.targetType,
      params.targetId,
      params.field || null,
      params.oldValue || null,
      params.newValue || null,
    ]
  );
}
