# Incident response playbook

> 1-page runbook for the realistic incidents cifra can hit. Read on
> the day, act on the day. Updated 2026-05-16.

---

## Triage in 30 seconds

| Signal | Probable incident | Section |
|---|---|---|
| `ANTHROPIC_API_KEY` appears in a public commit / Slack / log | API key leak | §1 |
| Unfamiliar IP in `auth_login_log` with successful login | Unauthorised access | §2 |
| Supabase support email about anomaly | DB compromise | §3 |
| Anthropic spend chart spikes 10x in <1h | Runaway loop or key abuse | §4 |
| Vercel down + site unreachable | Provider outage | §5 |
| User-reported "I can't log in" persists 15+ min after a deploy | Auth misconfig | §6 |

---

## §1 · Anthropic API key leak

**Immediate (within 5 min):**

1. Go to `https://console.anthropic.com/account/keys`.
2. Revoke the leaked key. Generate a new one.
3. In Vercel → Project Settings → Environment Variables:
   - Replace `ANTHROPIC_API_KEY` with the new value.
   - Redeploy (or wait for next push).
4. Check `/api/calls` (internal table) for any spend spike in the
   last 24h that you don't recognise. If yes → notify Anthropic
   support (`support@anthropic.com`) requesting a review.

**Follow-up:**

- If the key appeared in a public GitHub commit, force-push to remove
  the commit + run `git filter-repo` if needed.
- Audit how the leak happened (env file? screenshot? clipboard?) and
  add the lesson to this playbook.

---

## §2 · Unauthorised login

**Detection:** `SELECT * FROM auth_login_log WHERE success=true AND
ip NOT IN ('your.home.ip', 'your.office.ip') ORDER BY created_at
DESC;` (or scan for anomalous user agents).

**Immediate:**

1. Rotate `AUTH_SECRET` in Vercel → invalidates ALL active sessions
   (yours and the attacker's). You'll be logged out.
2. Rotate `ADMIN_PASSWORD` in Vercel.
3. Redeploy.
4. Log in again with the new password.

**Investigation:**

- Check `audit_log` for the time window of the unauthorised session.
  Any unexpected writes? Reverts needed?
- Check Vercel function logs for suspicious POST paths.
- If anything sensitive was exported (PDFs, CSVs), assume the attacker
  has it.

**Notification (if real data accessed):**

- Document the incident. Date, time window, what was accessed.
- Per Luxembourg GDPR, if personal data was exfiltrated, notify CNPD
  within 72h. **Only applies if there's evidence of actual
  exfiltration**, not just unauthorised access to your single-user
  workspace with no PII leaking.

---

## §3 · Supabase compromise

Indicators: Supabase support email; admin panel shows unfamiliar
sessions; queries from unexpected IPs in Supabase logs.

**Immediate:**

1. In Supabase Dashboard:
   - Rotate the `service_role` key.
   - Pause the project if data exfiltration is suspected.
2. Update `DATABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
3. Redeploy.

**Recovery:**

- Use PITR to restore to a known-good state (Supabase Pro: up to 7d
  retroactive). Validate by spot-checking row counts on critical
  tables (`invoices`, `declarations`, `tax_filings`, `crm_*`).
- After recovery, audit `audit_log` for the compromise window —
  invariably gives the smoking gun.

---

## §4 · Anthropic spend spike

**Cause usually:** infinite loop, retry storm, or compromised key.

**Immediate:**

1. Check `/settings/budget` dashboard. If the spend chart shows a
   sustained spike:
   - Check `api_calls` table for the most-active agent in the last
     hour. Frequently a stuck `validator` or `extract` retry loop.
2. If you can identify the runaway agent → temporarily set
   `BUDGET_MONTHLY_EUR` to a very low number (e.g. 1) in Vercel +
   redeploy. The budget guard hard-blocks above 100% of cap.
3. If you cannot identify it → revoke the Anthropic key (§1).

**Recovery:**

- Identify the code path that looped (`api_calls.agent` + timestamps).
- Patch the retry/idempotency bug.
- Re-enable budget at the original level.

---

## §5 · Vercel outage

Indicators: `app.cifracompliance.com` 5xx or unreachable; `status.vercel.com`
shows incident.

**Immediate:**

1. Confirm at `https://www.vercel-status.com/`.
2. If it's Vercel: nothing to do but wait. Data is safe (it's in
   Supabase, not Vercel).
3. Communicate to anyone expecting access ("Vercel incident, ETA per
   their status page").

**If outage extended >2h:**

- Supabase is independent — direct DB access still works for read
  queries via the SQL editor in the Supabase dashboard. Useful for
  emergency lookups.

---

## §6 · Auth misconfig after deploy

Symptom: "I can't log in" after recent deploy.

**Quick checks:**

1. Did `ADMIN_PASSWORD` or `AUTH_SECRET` change accidentally? Check
   Vercel env vars history.
2. Did `next.config.ts` headers change in a way that breaks cookies?
   Check `SameSite`, `Secure`, domain attribute.
3. Try login from incognito + clear cookies for the domain.
4. Check `auth_login_log` — are 401s being recorded? If yes, password
   mismatch (likely env regression). If no record at all, the request
   isn't reaching the handler (CSP / proxy issue).

**Recovery:**

- Roll back the offending deploy via Vercel UI ("Promote to
  Production" on the last known-good deployment).

---

## Contact list

| Vendor | Contact | What |
|---|---|---|
| Anthropic | `support@anthropic.com` | API key abuse, billing |
| Supabase | Dashboard ticket | DB / auth issues |
| Vercel | `https://vercel.com/help` | Deploy / DNS / infra |
| CNPD Luxembourg | `commission@cnpd.lu` | GDPR notification (>72h) |

---

## Post-incident

After every incident:

1. **Write what happened** in `docs/incidents/YYYY-MM-DD.md` (1 page
   max — date, what, impact, resolution, learnings).
2. **Update this playbook** if the incident exposed a gap.
3. **Update SECURITY_AUDIT** posture scores if anything materially
   changed.

This is the single source of truth for IR. If it's wrong → fix it
the moment you discover the gap, not the next sprint.
