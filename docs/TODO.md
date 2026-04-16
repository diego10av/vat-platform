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
> Last updated: 2026-04-16

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
