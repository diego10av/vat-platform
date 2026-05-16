# Security overview & data flow

> Living reference. Updated whenever a new third-party is added or
> the auth model changes. For the full audit posture see
> [SECURITY_AUDIT_2026-05-16.md](SECURITY_AUDIT_2026-05-16.md).

---

## 1 · Auth model (post 2026-05-05 reset)

Single password (`ADMIN_PASSWORD` env var in Vercel). Login at
`/login` issues an HMAC-SHA256 cookie signed with `AUTH_SECRET`,
HttpOnly + Secure + SameSite=lax, 30-day max-age. Rate-limit
10 attempts / 15 minutes per IP on `/api/auth/login`.

Every authenticated request goes through
[`requireSession`](../src/lib/auth.ts), which validates the cookie
HMAC and resolves to a single "founder" identity. There are no
roles, no multi-user, no scopes — by design (Rule §11 / dogfood).

**Login attempts** are persisted to `auth_login_log` (mig 091) with
IP, user-agent, success boolean, timestamp. Read-only SQL access.

## 2 · Authorisation (RLS)

RLS is enabled on every public-schema table (mig 006). Policies for
`anon` + `authenticated` roles default to deny-all; the app uses
`service_role` which has `BYPASSRLS`. Postgres enforces this at the
connection level — the backend cannot accidentally elevate to a
different identity.

When/if cifra ever moves to multi-user, this changes: each row will
need policy `USING (organization_id = auth.jwt() ->> 'org_id')` or
similar. Until then the current architecture is the right tradeoff.

## 3 · Data flow — who sees what

```
                                            ┌───────────────────────┐
                                            │ Diego's browser       │
                                            │ (single user)         │
                                            └─────────┬─────────────┘
                                                      │
                                                      │  HTTPS (TLS 1.2+)
                                                      ▼
                              ┌───────────────────────────────────────┐
                              │ Vercel (eu-central-1 edge)            │
                              │ - sees: every request URL + headers   │
                              │ - logs: 7d retention default          │
                              │ - serves: Next.js app + static assets │
                              └─────────┬──────────────┬──────────────┘
                                        │              │
                       ┌────────────────┘              └──────────────┐
                       │                                              │
                       ▼ HTTPS                                        ▼ HTTPS
        ┌────────────────────────────┐               ┌────────────────────────────┐
        │ Supabase Postgres          │               │ Anthropic API              │
        │ - eu-central-1 (Frankfurt) │               │ - Claude Haiku 4.5         │
        │ - TDE at rest              │               │ - Claude Opus (validator)  │
        │ - sees: ALL data           │               │ - sees:                    │
        │   (it's the DB)            │               │     · invoice text         │
        │ - 7d PITR (Pro plan)       │               │     · classification       │
        │ - service_role connection  │               │       diffs                │
        │                            │               │     · AED letter drafts    │
        │                            │               │ - retention: standard      │
        │                            │               │   Claude API terms         │
        └────────────────────────────┘               └────────────────────────────┘
                                                                     ▲
                                                                     │ HTTPS
                                                                     │
                                                     ┌───────────────┴──────────┐
                                                     │ ECB                      │
                                                     │ - sees: currency codes   │
                                                     │   (public data only)     │
                                                     └──────────────────────────┘
```

**Removed from the diagram in the 2026-05-05 reset:** Sentry,
PostHog. No external telemetry survives.

## 4 · Secrets

| Secret | Where | Rotation | Notes |
|---|---|---|---|
| `ADMIN_PASSWORD` | Vercel env | Manual (no schedule) | Login password. Single. |
| `AUTH_SECRET` | Vercel env | Manual | HMAC key for session cookies. Rotate → all sessions invalidate. |
| `DATABASE_URL` | Vercel env | When Supabase rotates | Service-role connection string. BYPASSRLS. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel env | When Supabase rotates | Used by `@supabase/supabase-js` clients. |
| `ANTHROPIC_API_KEY` | Vercel env | Manual | Claude API. Track spend at `/settings/budget`. |
| `DEBUG_SECRET` | Vercel env | Manual | Gates debug endpoints in production. |

`.env.local` for dev is gitignored. **Never commit secrets.** `git
log -p` is checked by CI design-lint for `*_KEY` / `*_SECRET`
patterns.

## 5 · Transport headers (production)

See [`next.config.ts`](../next.config.ts) for the full list. Notable:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy`: `default-src 'self'`,
  `frame-ancestors 'none'`, vendor allowlist (Supabase, Anthropic,
  ECB). Production drops `'unsafe-eval'` + Vercel Live origins from
  `script-src` + `connect-src` (stint 91); `'unsafe-inline'` stays
  because Next.js 16 needs it for its inline bootstrap shim — a
  nonce-based scheme is a real refactor and is queued, not done.
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy`: camera/microphone/geolocation/USB/etc all
  denied.

## 6 · Audit log

Every meaningful state transition writes to `audit_log` (mig 015).
The table is **append-only** by convention — no DELETE/UPDATE paths
in the app. The `audit_log` row carries:

- `id`, `created_at`, `actor` ("founder").
- `action` (e.g. `invoice_classify_override`, `declaration_filed`).
- `target_type`, `target_id`.
- `payload_before`, `payload_after` (JSONB).

The **USER OVERRIDE** event is the compliance backbone: when Diego
changes a classification away from the AI suggestion, the diff is
captured and exportable as PDF via
[`src/lib/audit-trail-pdf.ts`](../src/lib/audit-trail-pdf.ts).

## 7 · What's NOT here (intentional)

- **No Sentry / PostHog / Mixpanel** — all external telemetry was
  removed in the 2026-05-05 reset.
- **No client-side analytics** — `/api/calls` (internal) tracks model
  spend but nothing leaves the cifra stack.
- **No third-party scripts** in the CSP allowlist beyond Vercel Live
  (preview only).

## 8 · Incident response

See [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md).
