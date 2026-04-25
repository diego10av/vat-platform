-- ════════════════════════════════════════════════════════════════════════
-- Migration 057 — Status enum rework v2 (stint 43)
--
-- Diego's iteration on the status workflow after using stints 39-42 in
-- production:
--   - Fuse info_received → working (if I have the info, I'm already
--     working on it; separating them adds zero signal)
--   - Drop assessment_received as a status — the date already lives on
--     tax_assessment_received_at + the CIT Assessment chip surfaces it.
--   - Drop blocked / waived — never used in practice.
--   - Add partially_approved (1+ approvers signed off, others pending)
--     because Diego occasionally has 2 directors who must approve
--     jointly and one signs before the other.
--   - Add client_approved (all approvals in, pending to file).
--
-- Final 7-status workflow:
--   1. info_to_request
--   2. working                       ← was: info_received + working
--   3. awaiting_client_clarification
--   4. draft_sent
--   5. partially_approved            ← NEW
--   6. client_approved               ← NEW
--   7. filed
--
-- Migration is data-only (no schema change). The status column stays
-- TEXT — no enum constraint to alter. Inline UPDATE remaps the four
-- soon-to-be-invalid values to neutral states. tax_assessment_received_at
-- is preserved as-is so the CIT Assessment chip keeps showing the date.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  n_info_received INTEGER;
  n_assessment    INTEGER;
  n_blocked       INTEGER;
  n_waived        INTEGER;
BEGIN
  SELECT COUNT(*) INTO n_info_received FROM tax_filings WHERE status = 'info_received';
  SELECT COUNT(*) INTO n_assessment    FROM tax_filings WHERE status = 'assessment_received';
  SELECT COUNT(*) INTO n_blocked       FROM tax_filings WHERE status = 'blocked';
  SELECT COUNT(*) INTO n_waived        FROM tax_filings WHERE status = 'waived';

  UPDATE tax_filings SET status = 'working',         updated_at = NOW() WHERE status = 'info_received';
  UPDATE tax_filings SET status = 'filed',           updated_at = NOW() WHERE status = 'assessment_received';
  UPDATE tax_filings SET status = 'info_to_request', updated_at = NOW() WHERE status = 'blocked';
  UPDATE tax_filings SET status = 'filed',           updated_at = NOW() WHERE status = 'waived';

  -- One global audit row capturing the migration.
  INSERT INTO audit_log (id, user_id, action, target_type, target_id, new_value, created_at)
  VALUES (
    gen_random_uuid()::text,
    'system',
    'tax_filing_status_migration',
    'tax_filings',
    'global',
    jsonb_build_object(
      'migration', '057',
      'remap', jsonb_build_object(
        'info_received → working', n_info_received,
        'assessment_received → filed', n_assessment,
        'blocked → info_to_request', n_blocked,
        'waived → filed', n_waived
      ),
      'note', 'tax_assessment_received_at preserved unchanged. CIT Assessment chip keeps showing the date.'
    )::text,
    NOW()
  );
END $$;
