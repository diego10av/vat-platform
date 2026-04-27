-- Stint 51.F — sidebar reorder + icon polish.
--
-- Diego: "VAT filings, por favor, colócamelo debajo de Tasks y por
-- encima de Corporate tax returns." + "El símbolo del euro no me gusta.
-- Busca otra cosa, otro simbolito más que tenga más sentido para los
-- VAT. El símbolo del euro queda cutrísimo."
--
-- The sidebar order today (from mig 050):
--   10 · Corporate tax returns
--   20 · VAT Annual           (group=vat)
--   22 · VAT Quarterly        (group=vat)
--   23 · VAT Monthly          (group=vat)
--   30 · Subscription tax
--   40/41/42 · WHT × 3
--   50 · FATCA / CRS
--   60/61 · BCL × 2
--
-- After this migration:
--   5  · VAT Annual           (group=vat)   ← top under Tasks
--   6  · VAT Quarterly        (group=vat)
--   7  · VAT Monthly          (group=vat)
--   8  · VAT Annual simplified (hidden)
--   10 · Corporate tax returns
--   …
--
-- Icons: ReceiptIcon stays for the VAT children (it's the most natural
-- visual for "filing"). The PARENT "VAT filings" still pulls its icon
-- from its first child via Sidebar.tsx fallback, so swapping ReceiptIcon
-- to a less-monetary glyph here is enough — no Sidebar.tsx code change
-- needed for the icon ask. Using CalculatorIcon for the VAT parent + a
-- distinct ScrollTextIcon for the children would force a Sidebar code
-- change. We keep it db-driven and uniform: ReceiptIcon for the children
-- but drop the EuroIcon hardcoded fallback at the parent level (handled
-- in code in this same stint by switching to CalculatorIcon).

-- Move VAT block to the top of Tax-Ops categories.
UPDATE tax_deadline_rules SET sidebar_order = 5  WHERE tax_type = 'vat_annual';
UPDATE tax_deadline_rules SET sidebar_order = 6  WHERE tax_type = 'vat_quarterly';
UPDATE tax_deadline_rules SET sidebar_order = 7  WHERE tax_type = 'vat_monthly';
UPDATE tax_deadline_rules SET sidebar_order = 8  WHERE tax_type = 'vat_simplified_annual';

INSERT INTO audit_log (id, user_id, action, target_type, target_id, new_value)
VALUES (
  gen_random_uuid()::text, 'migration_067',
  'tax_deadline_rules_sidebar_reorder',
  'tax_deadline_rules', 'batch_067',
  jsonb_build_object(
    'migration', '067',
    'description',
    'Diego asked for VAT filings above Corporate tax returns. Moved sidebar_order of vat_* rules from 20-23 → 5-8 so the VAT block surfaces immediately under Tasks.'
  )::text
);
