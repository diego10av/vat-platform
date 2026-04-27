-- Stint 52 follow-up — rename ICS → ISS.
--
-- Diego: "no es ICS es ISS." Migration 068 added the columns under the
-- wrong abbreviation. ISS is the correct LU acronym (Intra-community
-- Supply of Services). Rename the columns + their comments before any
-- production data lands in them.
--
-- Idempotent: only renames if the old column still exists.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tax_filings'
       AND column_name = 'invoice_price_ics_eur'
  ) THEN
    ALTER TABLE tax_filings
      RENAME COLUMN invoice_price_ics_eur TO invoice_price_iss_eur;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tax_filings'
       AND column_name = 'invoice_price_ics_note'
  ) THEN
    ALTER TABLE tax_filings
      RENAME COLUMN invoice_price_ics_note TO invoice_price_iss_note;
  END IF;
END $$;

COMMENT ON COLUMN tax_filings.invoice_price_iss_eur IS
  'Price (EUR) charged for the ISS / Intra-community Supply of Services companion deliverable to this VAT filing. NULL = not applicable / no ISS prepared. Stints 52 + 52-followup.';
COMMENT ON COLUMN tax_filings.invoice_price_iss_note IS
  'Free-text note for the ISS price (e.g. scope, billing month). Stints 52 + 52-followup.';
