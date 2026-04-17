# cifra · TODO

> **Living action list.** Claude reads this at the start of each
> session and in the daily 8:30 brief. When an item is done, it's
> checked off and moved to "Done this week". When an item has been
> open > 14 days, Claude proposes either acting, deleting, or parking.
>
> **Time-bucket convention:** every item tagged with one of
> `🟢 5min` · `🟡 30min` · `🔴 2h+deep` · `📞 external` · `🧠 decision`
> so the brief can match items to available windows.
>
> **Carry-over convention:** when an item has been open several days,
> Claude keeps it here with an age indicator. This is a feature, not
> a failure. Diego has a day job and two small kids; many things slip.
>
> Last updated: 2026-04-18 (overnight sprint)

---

## 🔥 This week

### Next 48h

- [ ] 🟢 **5min · Rotate GitHub Personal Access Token** — exposed in
      the remote config. Revoke at https://github.com/settings/tokens,
      create new with `repo` scope. Claude provides the reconfig
      command. *Security exposure — don't let this sit past Friday.*
- [ ] 📞 **Call 2 notaries for SARL-S quote** — Alex Schmitt, Bonn
      Steichen, Notaire Hellinckx or cheaper alternative. Need at
      least 2 quotes to compare. Expected €1,500-2,500 one-off.
- [ ] 🟡 **30min · Set up `contact@cifracompliance.com`** — Google
      Workspace (€5.75/mo) or Fastmail linked to the domain.

### This week (7 days)

- [ ] 🧠 **Read + edit the 3 strategy docs** — ROADMAP, BUSINESS_PLAN,
      positioning. They're Claude's v0.1; your v0.2 makes them yours.
      30 min per doc, skim + mark what to change.
- [ ] 📞 **Schedule 3 customer discovery calls** — from the 20-firm
      list (section below). Message template in your head: "I'm
      building a LU VAT tool. Would love 20 min to learn how you
      prepare returns today, no pitch." LinkedIn DM > cold email > phone.
- [ ] 🔴 **2h deep · Landing page live on cifracompliance.com** —
      copy already in `docs/positioning.md`. Framer or Vercel. Hero +
      3 features + "Request demo" form. Can be done in one evening
      after kids sleep.
- [ ] 🧠 **Draft friendly-customer pilot offer** — one boutique firm
      you already know. 30-50% discount × 6 months in exchange for
      case study + weekly feedback calls. First paid customer
      typically takes 2-4 weeks to close.

### This sprint (14 days)

- [ ] 🧠 **Decide pricing after first 3 calls** — current hypothesis
      €99 / €299 / custom. Anchor question to ask: "What do you
      spend per year on VAT software today?"
- [ ] 🟢 **5min · Rename repo `vat-platform` → `cifra-app`** — GitHub
      UI (Settings > General > Rename). Then `git remote set-url
      origin ...` locally.
- [ ] 📞 **SARL-S constitution complete** — expected 7-10 days after
      engaging a notary.
- [ ] 🔴 **2h deep · Start P0 #2 multi-user + roles** — only after
      3 customer calls confirm the need (they will). Claude executes
      the implementation; Diego designs the role names + permissions.

---

## 📋 Prospect list (fill as you go)

*Target: 20 LU firms to reach out to. Fill in during commute / wait
times. No pressure to complete in one sitting.*

| Firm | Size | Contact (LinkedIn / email) | Status | Notes |
|------|------|------------------------------|--------|-------|
| _(TBD)_ | | | Not contacted | |
| _(TBD)_ | | | Not contacted | |

*Where to mine: ALFI member directory, ACEL (Chambre experts comptables),
Luxembourg for Finance directory, LinkedIn search "VAT + Luxembourg +
fiduciary + compliance".*

---

## 🧊 Parked (not this sprint)

Things worth remembering but not actionable yet:

- First hire decision (CS or technical) → month 3-6 once revenue
- Bootstrap vs raise (pre-seed €150-300k for 15%?) → month 2
- BE + NL expansion research → month 6
- Big-4 partnership conversation → when 10+ customers
- Logo redesign with a real designer → when cash allows

---

## ✅ Done this week

*(Archived every Monday morning into `docs/archive/TODO-YYYY-WW.md`.)*

**2026-04-18 (daytime, 08:00 → 08:15)** — Second autonomous stint (Diego with kids)
- ✅ **Client approval portal (P0 #4) shipped** — HMAC-signed self-contained tokens + public `/portal/[token]` review page + "Share for approval" button in declaration action bar + `ShareLinkModal` with selectable expiry (1–30 days) + copy-link + draft-email helpers. Eliminates the 3-5 email back-and-forth per declaration. No new DB table (token is its own truth, signed with AUTH_SECRET).
- ✅ **Chat markdown-lite rendering** — Claude's replies now render **bold**, `inline code`, bulleted + numbered lists, paragraph breaks. Pure parser (`render-markdown.ts`) + React walker. Legal-ref pills preserved.
- ✅ **+45 tests** (approval-tokens +12, render-markdown +18, ecb +15, ui-errors +8, rate-limit +6, api-errors +9, lifecycle +16 NEW during day; chat-context +7, budget-guard +13, logger +7, rate-limit +8 shipped overnight). **Total 372/372.**
- ✅ Two commits: `3cb55ae` (markdown + tests), `[portal commit]` (approval portal)

**Diego action needed:**
- 🧠 Still pending: run `migrations/001_per_user_ai_budget_and_chat.sql` in Supabase (chat MVP works without, but per-user cap only activates once applied)
- 🎯 Try the new "Share for approval" button: open any declaration in review, top-right action bar has a new "Share" button next to "Approve"

**2026-04-18 (overnight, 00:30 → 07:50)** — Nocturnal autonomous sprint
- ✅ **Rate limiting** on `/api/agents/*` (token bucket per IP × path; 5/min extract, 10/min validate, 15/min draft-email, 60/min classify) — commit [shipped]
- ✅ **Structured logger** (`src/lib/logger.ts`) — bound loggers, structured fields, Error serialization, dev pretty-print / prod JSON-lines. Integrated in 8 critical sites (api-errors, anthropic-wrapper, ecb, extract, draft-email, aed/upload, documents/upload, declarations) — commit [shipped]
- ✅ **SQL migration 001** (`migrations/001_per_user_ai_budget_and_chat.sql`) — adds `users` table, `api_calls.user_id`, `chat_threads`, `chat_messages`. Idempotent, ready to apply in Supabase Studio.
- ✅ **Per-user budget tracking** (`requireUserBudget(userId, estimatedCost?)`) — tolerant of missing migration (permissive fallback) + anthropic-wrapper writes user_id with graceful retry on old schema — commit [shipped]
- ✅ **Chat MVP shipped** — "Ask cifra" drawer in TopBar, Haiku default + "Ask Opus" button, context-aware (entity/declaration from URL), quota banner w/ cost-per-message, rate-limited + budget-gated. Stateless server; client holds conversation — commit [shipped]
- ✅ **docs/MODELS.md** central matrix created + §10 in PROTOCOLS.md, quarterly review rule
- ✅ **Chat pricing decided**: €2/user/mo default cap, Starter/Firm/Enterprise tiers (€1/€2/€10 caps with admin raise ladder €2→€5→€10→€20→€30)
- ✅ **Declaration page refactor** — 2,637-line monolith → 1,662 + 7 extracted modules (_types, _helpers, _atoms, PreviewPanel, OutputsPanel, EmailDrafterModal, FilingPanel). 37% reduction, zero behaviour change — commit [shipped]
- ✅ **Error boundaries** — `app/error.tsx` + `app/global-error.tsx` prevent future white-screen crashes, Copy error details button for support
- ✅ **Loading skeletons** everywhere — wired `PageSkeleton` into /entities/[id], /registrations/[id], /settings (list pages already had them)
- ✅ **Test coverage +31** — rate-limit +6, lifecycle +16 NEW, api-errors +9 NEW. 319/319 total.

**Diego action needed tomorrow:**
- 🧠 Review + run `migrations/001_per_user_ai_budget_and_chat.sql` in Supabase SQL Editor (chat works without it — permissive fallback — but per-user quota only activates once applied)
- 🎯 Try the chat: click "Ask cifra" top-right of any page, ask something

**2026-04-17** — Late-night sprint
- ✅ CRITICAL extractor prompt fix — merge-default behavior (one line per unique VAT treatment, generic descriptions) — prevents the over-splitting that was creating N lines for a single invoice
- ✅ ROADMAP expansion — chat Opus P0, ViDA/Peppol e-invoicing P1, accounting-integrations P2, new Fund-compliance section (#40-47: FATCA/CRS, subscription tax, direct tax, KYC/AML, AIFMD Annex IV, DAC6, CBAM, CESOP)
- ✅ `docs/VIDA.md` — strategic briefing on VAT in the Digital Age (3 pillars, LU timeline, cifra product plan 5 phases, pricing, risks, immediate actions for Diego)
- ✅ Nav cleanup — Legal overrides folded into Legal watch page as prominent top-card; route stays alive for deep-links; sidebar Library group now a single item
- ✅ Pre-existing `@ts-expect-error` cleanup in synthetic-corpus fixture — unblocked clean typecheck

**2026-04-16** — Tonight's sprint
- ✅ Three strategy docs created (ROADMAP, BUSINESS_PLAN, positioning) — commit `4c85c81`
- ✅ Validator UI integration shipped — commit `4c85c81`
- ✅ Protocols + TODO system + memory sync — commit `d349246`
- ✅ Morning brief scheduled task configured — commit `f5a986b`
- ✅ CSP + security headers (HSTS, CSP, XFO, Permissions-Policy, COOP) — commit `a3b49a0`
- ✅ Declaration page Rules-of-Hooks crash + pink cifra wordmark — commit `878d063`
- ✅ Anthropic monthly budget guard (hard-cap at €75, configurable via BUDGET_MONTHLY_EUR) — commit `c302cff`
- ✅ Metrics page rebuilt into real ops dashboard (budget progress bar + daily sparkline + cost-by-agent) — commit `acf0bd0`
- ✅ Registrations → lifecycle state of Client (vat_status) + sidebar trimmed + avatar minimalist — commit [incoming]
- ✅ UI redesign phases 1-3 shipped — commits `e7d4f3b`, `54164da`, `401c5ed`
- ✅ Options A/B/C/D/E all complete (see ROADMAP Shipped)
- ✅ Domain `cifracompliance.com` purchased (2026-04-15)
- ✅ Company name decided: cifra SARL-S

---

*Diego: add to this file during calls, walks, 3am-baby-wake-ups. No
formatting police — just write the item with a time bucket guess.
Claude: keep current, keep tagged, keep humane in briefs.*
