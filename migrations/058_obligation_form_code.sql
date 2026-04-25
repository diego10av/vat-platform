-- ════════════════════════════════════════════════════════════════════════
-- Migration 058 — `form_code` on tax_obligations (stint 43.D4)
--
-- Diego: "para algunas declaraciones hago el formulario 500, para otras
-- el 205 y muy a veces el 200... lo mismo, la empresa que rellena el
-- formulario 500 siempre hace 500, a no ser que haya una conversión y
-- pases de una forma societaria a otra."
--
-- Per-obligation field. Defaults NULL until Diego picks one. Used today
-- only on CIT (form 500/205/200), but the column is generic — future
-- jurisdictions / tax types might reuse it.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE tax_obligations
  ADD COLUMN IF NOT EXISTS form_code TEXT;

COMMENT ON COLUMN tax_obligations.form_code IS
  'Tax form identifier. For CIT in Luxembourg: 500 (standard),
   205 (small entities / abbreviated), 200 (special cases).
   NULL until set. Per-obligation because the form is stable for
   an entity year-over-year unless there is a société conversion.';
