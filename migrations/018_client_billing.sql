-- ════════════════════════════════════════════════════════════════════════
-- 018 — Client billing (fees agreed with each client).
--
-- Stint 15 (2026-04-20). Per Diego:
--
--   "cuando estamos añadiendo las declaraciones, a lo mejor tendría
--    sentido añadir otro pequeñito panel más con el tema del Billing
--    para poder ver qué FIIs hemos acordado con ese cliente… también
--    tendría sentido que se pudiese subir el Engagement Letter"
--
-- One row per client (1:1), nullable columns everywhere so you can
-- capture "we haven't agreed the monthly fee yet but we know it'll be
-- €400/quarter for this client". Amounts stored in cents as BIGINT to
-- avoid floating-point drift.
--
-- Engagement letter itself lives in Supabase Storage (path +
-- filename held in this table). Re-uploading overwrites the storage
-- object and records a new filename; historical engagement letters
-- aren't versioned (unlike VAT letters) because the last one signed
-- is the one that binds — old engagement terms don't need to be
-- surfaced live on the client page.
--
-- Disbursement percentage is captured because cifra forwards VAT
-- payments to the AED on behalf of the client and (typically) charges
-- a 4-6% handling fee. The `vat_on_disbursement_fee` flag notes whether
-- that fee itself is VAT-subject (it usually is, as the fee is for a
-- service taxable in Luxembourg).
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS client_billing (
  client_id                     TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,

  -- Recurring declaration fees. All nullable: a client may only have
  -- one of them in scope. Amounts in EURO CENTS. Example: €400.00 =
  -- 40000.
  fee_monthly_cents             BIGINT,
  fee_quarterly_cents           BIGINT,
  fee_annual_cents              BIGINT,
  -- "Yearly" above covers the periodic yearly declaration; "annual
  -- summary" is the once-a-year recap that sits on top in some
  -- simplified regimes. Separate so we can bill the €1,200 quarterly
  -- + €250 annual-summary split that Diego described.
  fee_annual_summary_cents      BIGINT,

  -- One-offs
  fee_vat_registration_cents    BIGINT,
  fee_ad_hoc_hourly_cents       BIGINT,   -- consultation rate per hour

  currency                      TEXT NOT NULL DEFAULT 'EUR',

  -- Disbursements. When cifra pays VAT to the AED on the client's
  -- behalf, cifra charges a handling fee, usually 4-6% of the amount
  -- disbursed. Stored as basis points (1/100 of a percent) so 4.25%
  -- → 425.
  disbursement_fee_bps          INTEGER,
  -- Whether the disbursement fee is VAT-subject (typically yes —
  -- it's a supply of service taxable in Luxembourg). Leaving this
  -- nullable means "not discussed yet".
  vat_on_disbursement_fee       BOOLEAN,
  disbursement_notes            TEXT,

  -- Free-form notes the engagement letter fine-print doesn't capture.
  billing_notes                 TEXT,

  -- Engagement letter attachment (optional). Lives in the `documents`
  -- Supabase bucket at `client-billing/<client_id>/<filename>`.
  engagement_letter_filename    TEXT,
  engagement_letter_path        TEXT,
  engagement_letter_content_type TEXT,
  engagement_letter_size_bytes  INTEGER,
  engagement_letter_uploaded_at TIMESTAMPTZ,
  engagement_letter_signed_on   DATE,

  created_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enforce non-negative monetary amounts. Defensive — the UI clamps too.
ALTER TABLE client_billing
  DROP CONSTRAINT IF EXISTS client_billing_nonneg_fees;
ALTER TABLE client_billing
  ADD CONSTRAINT client_billing_nonneg_fees CHECK (
    (fee_monthly_cents           IS NULL OR fee_monthly_cents           >= 0)
    AND (fee_quarterly_cents     IS NULL OR fee_quarterly_cents         >= 0)
    AND (fee_annual_cents        IS NULL OR fee_annual_cents            >= 0)
    AND (fee_annual_summary_cents IS NULL OR fee_annual_summary_cents   >= 0)
    AND (fee_vat_registration_cents IS NULL OR fee_vat_registration_cents >= 0)
    AND (fee_ad_hoc_hourly_cents IS NULL OR fee_ad_hoc_hourly_cents     >= 0)
    AND (disbursement_fee_bps    IS NULL OR (disbursement_fee_bps >= 0 AND disbursement_fee_bps <= 10000))
  );

-- RLS — same deny-all posture.
ALTER TABLE client_billing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON client_billing;
CREATE POLICY "deny all anon"
  ON client_billing FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "deny all authenticated" ON client_billing;
CREATE POLICY "deny all authenticated"
  ON client_billing FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- Verification:
-- SELECT column_name, data_type, is_nullable FROM information_schema.columns
--  WHERE table_name = 'client_billing' ORDER BY ordinal_position;
-- SELECT conname FROM pg_constraint WHERE conrelid = 'client_billing'::regclass;
