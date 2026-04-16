# cifra · TODO

> **Living action list.** The difference between this and ROADMAP.md:
>
> - `ROADMAP.md` = the full product backlog with every P0/P1/P2 item
>   we will eventually build.
> - `TODO.md` (this file) = the 10-20 concrete actions that MUST happen
>   in the next 1-2 weeks. Many are non-product (legal, sales, admin).
>
> **Protocol:** Claude reads this file at the start of each session and
> surfaces open items in the morning brief. When a task is done, it's
> checked off and moved to "Done this week" at the bottom. When a week
> passes, the bottom section gets archived to `docs/archive/TODO-YYYY-WW.md`.
>
> Last updated: 2026-04-16

---

## 🔥 This week (by priority)

### Must do in the next 48h

- [ ] **Rotate GitHub Personal Access Token** — the current one (`ghp_loQ9Hhig...`) is exposed in the repo remote config. Revoke at https://github.com/settings/tokens, create new one with `repo` scope, run the reconfig command Claude will provide. **5 minutes.**
- [ ] **Call a notary for SARL-S quote** — at least 2 quotes. Candidates: Alex Schmitt, Bonn Steichen, Notaire Hellinckx. Capital €1, expected cost €1,500-2,500 one-off + €600/year accountant. **30 min of calls.**
- [ ] **Set up `contact@cifracompliance.com`** — Google Workspace or Fastmail linked to the domain. **20 min.**

### This week (7 days)

- [ ] **First 3 customer discovery calls scheduled** — target: 5 LU fiduciary firms. See "Prospect list" section below. Use LinkedIn for warm intros, phone for cold. Ask about pain, not price. **3-5h of outreach.**
- [ ] **Landing page live on cifracompliance.com** — copy is already in `docs/positioning.md`. Frame it in Framer or Vercel. Include hero + 3 features + "Request demo" form. **4h of setup.**
- [ ] **Read and adjust the three strategy docs** — ROADMAP, BUSINESS_PLAN, positioning. Claude wrote v0.1; you tune v0.2. **1h.**
- [ ] **Draft the "friendly customer" offer** — one boutique firm you already know, willing to pilot for a discount (30-50% off) in exchange for case study + feedback. First paid customer typically takes 2-4 weeks to close. **Think + outreach.**

### This sprint (14 days)

- [ ] **Decide pricing after first 3 calls** — current hypothesis: €99 Starter / €299 Firm / custom Enterprise. Adjust based on what you hear. Specifically: ask "how much do you spend per year on VAT software today?" — gives you the anchor.
- [ ] **Rename repo from `vat-platform` to `cifra-app`** — on GitHub UI, takes 30 seconds. Update local `git remote set-url origin ...` after.
- [ ] **Draft legal: founder equity agreement** — even for a sole founder, a vesting schedule keeps doors open to future co-founders / investors. 4-year vest, 1-year cliff is standard.
- [ ] **SARL-S constitution complete** — expected within 7-10 days of engaging a notary.
- [ ] **Start P0 #2 multi-user + roles** — only after customer calls validate the need (they will).

---

## 📋 Prospect list (keep updating)

*Target: 20 LU firms to add before end of week. Fill in as you go.*

| Firm | Size | Contact | Status |
|------|------|---------|--------|
| _(TBD)_ | | | Not contacted |
| _(TBD)_ | | | Not contacted |

*Sources to mine: ALFI member directory, ACEL member list, Luxembourg
for Finance directory, LinkedIn search "VAT + Luxembourg + fiduciary".*

---

## 🧊 Parked (not this sprint, but don't forget)

- First hire decision (CS vs technical) → month 3-6
- Bootstrap vs raise (pre-seed €150-300k for 15%?) → month 2
- BE + NL expansion research → month 6
- Big-4 partnership conversation → when you have 10+ customers

---

## ✅ Done this week

*(Gets auto-archived every Monday morning.)*

**2026-04-16** — Tonight's sprint
- ✅ Three strategy docs created (ROADMAP, BUSINESS_PLAN, positioning) — commit `4c85c81`
- ✅ Validator UI integration shipped — commit `4c85c81`
- ✅ Protocol + TODO system set up — commit [incoming]
- ✅ UI redesign phases 1-3 shipped — commits `e7d4f3b`, `54164da`, `401c5ed`
- ✅ Options A + B + C + D + E all complete (see ROADMAP Shipped section)
- ✅ Domain `cifracompliance.com` purchased
- ✅ Company name decided: cifra SARL-S

---

*Diego: add to this file freely — during calls, walking, in the shower.
Claude: read this at session start, update it after every material action,
surface blockers in the morning brief.*
