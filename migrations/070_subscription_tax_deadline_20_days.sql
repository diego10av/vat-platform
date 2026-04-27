-- Stint 53 — correct the subscription tax filing+payment deadline.
--
-- cifra had 15 days seeded in mig 045 (rule_subscription_tax_quarterly).
-- Diego: "creo que la deadline es 20 días, por favor verifica."
-- Verified against Guichet.lu official documentation: the deadline is
-- IDENTICAL for all subscription-tax-eligible vehicles (UCITS, SIF, RAIF):
-- the filing AND payment must be made within the first 20 days of the
-- quarter following the one to which the tax relates.
--
--   Q1 → 20 April · Q2 → 20 July · Q3 → 20 October · Q4 → 20 January
--
-- Legal basis (cited in statutory_description below):
--   - Loi du 17 décembre 2010 (UCI) — Art. 175 §3
--   - Loi du 13 février 2007 (SIF)  — Art. 68 §2
--   - Loi du 23 juillet 2016 (RAIF) — Art. 46
-- Source: https://guichet.public.lu/en/entreprises/fiscalite/declaration/
--         instruments-financiers/taxe-abonnement.html
--
-- Effect on existing filings: NEW filings born after this rule update
-- will get the 20-day deadline automatically. Filings created BEFORE
-- this point with deadline_date already persisted at the 15-day mark
-- are bumped by +5 days for the ones still open (status NOT IN
-- 'filed', 'paid', 'waived'). Closed filings are left as historical
-- record.

UPDATE tax_deadline_rules SET
  rule_params = '{"days_after":20}'::jsonb,
  statutory_description =
    'Subscription tax (taxe d''abonnement) — filing AND payment within 20 days of quarter-end. Loi du 17 déc. 2010 Art. 175 §3 (UCI), Loi du 13 fév. 2007 Art. 68 §2 (SIF), Loi du 23 juil. 2016 Art. 46 (RAIF). Strict deadline, identical for all vehicles.',
  market_practice_note =
    'Filing + payment simultaneous. Late: 0.4% / month interest + admin penalty. AED is strict — no tolerance.'
WHERE id = 'rule_subscription_tax_quarterly';

-- Bump the deadline_date on filings still open (haven't been filed/paid).
-- Historical filings (filed/paid/waived) keep the date they had when
-- they were closed, for audit-trail accuracy.
UPDATE tax_filings f
   SET deadline_date = deadline_date + INTERVAL '5 days',
       updated_at = NOW()
  FROM tax_obligations o
 WHERE f.obligation_id = o.id
   AND o.tax_type = 'subscription_tax_quarterly'
   AND f.deadline_date IS NOT NULL
   AND f.status NOT IN ('filed', 'paid', 'waived');

INSERT INTO audit_log (id, user_id, action, target_type, target_id, new_value)
VALUES (
  gen_random_uuid()::text, 'migration_070',
  'subscription_tax_deadline_corrected',
  'tax_deadline_rules', 'rule_subscription_tax_quarterly',
  jsonb_build_object(
    'migration', '070',
    'change', '15 days → 20 days',
    'legal_basis', 'Loi 17 déc 2010 Art. 175 §3 + Loi 13 fév 2007 Art. 68 §2 + Loi 23 juil 2016 Art. 46',
    'open_filings_bumped', 'deadline_date += 5 days for status NOT IN (filed,paid,waived)'
  )::text
);
