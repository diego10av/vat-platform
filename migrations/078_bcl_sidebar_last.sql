-- Migration 078 — BCL reporting moved to the bottom of the tax-ops
-- sidebar (stint 64.V.1).
--
-- Diego: "BCL es un reporting que hago yo que es bastante rentable,
-- pero no son tax... estaría bien que estuviese solo por encima de
-- Other (ad-hoc)."
--
-- Reasoning: every other entry in tax-ops (VAT / CIT / NWT /
-- subscription / WHT / FATCA-CRS) is a TAX filing. BCL is reporting
-- to the Banque Centrale de Luxembourg — non-tax. Sitting it
-- between CIT and Subscription (its old position via sidebar_order=11)
-- mixed two semantically different things. New position 60 puts it
-- AFTER FATCA/CRS (50) and BEFORE the hardcoded "Other (ad-hoc)"
-- entry that the sidebar component appends on the client side.
--
-- Idempotent: simple UPDATE to a known column.

UPDATE tax_deadline_rules
   SET sidebar_order = 60
 WHERE tax_type LIKE 'bcl_%';
