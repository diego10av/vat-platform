-- Stint 50.D — tighten the UNIQUE partial index from migration 064.
--
-- Round-1 dedup (mig 064) used a permissive regex that only stripped
-- comma / dot / parens. That missed real duplicates with these patterns:
--
--   • "Avallon MBO II SARL" vs "Avallon MBO II S.à r.l."
--     (the spaces inside "S.à r.l." aren't covered by [,.()])
--   • "Avallon MBO Fund III SCA" vs "Avallon MBO Fund III SCA;"
--     (trailing semicolon)
--   • "Magenta CL Sàrl" vs "Magenta CL SARL;"
--     (accent on à + trailing semicolon)
--   • "Portobello Capital Coinvestment Fund SCA SICAV-RAIF" vs
--     "Portobello Capital Coinvestment Fund SCA SICAV-RAIF:"
--     (trailing colon)
--
-- Round-2 dedup (stint 50.D) re-ran with this stricter normalization and
-- merged 11 additional groups (22 → 11 entities, 178 → 167 active).
--
-- This migration drops the permissive index from mig 064 and replaces it
-- with the same aggressive normalization the dedup script now uses:
--   - TRANSLATE strips Latin-1 accents (à → a, á → a, ç → c, …)
--   - REGEXP_REPLACE collapses every non-alphanumeric char to nothing
--   - LOWER folds case
--
-- III / IV / II remain distinct because the digits/roman-numeral letters
-- survive the strip; only punctuation and whitespace differences collapse.

DROP INDEX IF EXISTS tax_entities_norm_unique;

CREATE UNIQUE INDEX IF NOT EXISTS tax_entities_norm_unique
  ON tax_entities (
    LOWER(REGEXP_REPLACE(
      TRANSLATE(legal_name,
        'àáâãäåèéêëìíîïòóôõöùúûüñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÑÇ',
        'aaaaaaeeeeiiiiooooouuuuncAAAAAAEEEEIIIIOOOOOUUUUNC'),
      '[^a-zA-Z0-9]+', '', 'g'
    )),
    COALESCE(client_group_id, '__no_group__')
  )
  WHERE is_active = TRUE;
