-- ════════════════════════════════════════════════════════════════════════
-- Migration 051 — Last-info-request date on tax_filings (stint 39.F)
--
-- Diego's stint-39 feedback:
--   "me gustaría poder saber cuándo he mandado el último email al
--    cliente o al CSP pidiendo información, para saber si toca
--    volver a chasear o si ya se ha enviado hace nada"
--
-- He explicitly asked for a dedicated column (not comments) so it
-- surfaces in the matrix row. NULL means "never chased" — relevant for
-- the info_to_request + awaiting_client_clarification statuses.
--
-- Idempotent: the IF NOT EXISTS guard keeps reruns safe.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE tax_filings
  ADD COLUMN IF NOT EXISTS last_info_request_sent_at DATE;

COMMENT ON COLUMN tax_filings.last_info_request_sent_at IS
  'Date of the last chase email to the client / CSP about info needed for this filing. NULL = never chased or not tracked. Edited inline from the matrix row.';
