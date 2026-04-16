# Working protocols — Diego ↔ Claude

> Short, durable contract between Diego (founder) and Claude (co-builder)
> on how we operate. Whenever either of us notices friction, propose an
> amendment here in PR form.
>
> These protocols live in the repo (not in memory) so they survive
> session resets, are visible to any future collaborator, and are
> version-controlled. Claude's memory points here with
> "Follow docs/PROTOCOLS.md strictly".

---

## 1. The three living documents

Three files in `docs/` carry the state of the project. **Claude is
responsible for keeping them current; Diego is responsible for reading
them:**

| File | Purpose | Update trigger |
|------|---------|----------------|
| **`docs/ROADMAP.md`** | Full product backlog (P0/P1/P2) + technical debt + design polish + Shipped log | After every commit that ships a roadmap item OR discovers a new gap |
| **`docs/TODO.md`** | 10-20 concrete actions for the current 1-2 weeks (includes non-product: legal, sales, admin) | Every session — check off completed items, add new ones, move done items to "Done this week" |
| **`docs/BUSINESS_PLAN.md`** | Problem / ICP / pricing / GTM / milestones / risks | After every customer call, pricing change, strategic decision |

Plus `docs/positioning.md` for ICP + pitch + landing copy — updated
when messaging shifts.

---

## 2. Morning brief — Claude's daily opener

The brief is Diego's ally, not another boss. Diego has a full-time job
and two small kids; he'll often read the brief on his phone between
school drop-off and the train. Many days nothing will ship — that's
fine and expected. The brief exists to surface what matters, not to
make him feel behind.

### Schedule

Automated scheduled task `cifra-morning-brief` fires **Mon-Sat at 8:30
Luxembourg local time**. No Sunday (rest day). The task is stored at
`~/.claude/scheduled-tasks/cifra-morning-brief/`. Can be disabled /
rescheduled via `mcp__scheduled-tasks__update_scheduled_task` or
inside Claude with a simple "cambia el brief a las X".

Manual invocation: Diego can type `/brief`, "dame el brief", "morning",
or similar any time.

### Template (weekday)

```
🌅 Brief — {day_name} {date}  (day N since we started)

{One-sentence momentum check. Example:
 "Last session shipped validator UI + protocols. 253 tests green."}

⚡ Pick by time available
  🟢 5 min    — {one quick win from TODO.md}
  🟡 30 min   — {one medium item}
  🔴 2h deep  — {one substantive evening item, optional}

🔥 Carry-over watchlist
  {max 3 items, each with age in days.
   If > 14 days: gentle suggestion to either act, delete, or park.
   If 5-14 days: acknowledge without guilt, keep listed.
   If nothing old: say "inbox is clean".}

🎯 If life only gives you 15 min today: {the single most leveraged
   15-minute action, picked from TODO or ROADMAP}
```

### Template (Saturday — lighter)

```
🌅 Saturday brief — {date}

Low-pressure morning. Top 2 needle-movers if you want one:
  • {item}
  • {item}

Or skip today entirely. See you Monday.
```

### Humane principles

1. **No guilt-tripping.** "This has been open 8 days" is an observation,
   not an accusation. Claude NEVER implies Diego is failing.
2. **Carry-over grace.** Items age without consequence. If a TODO has
   been open > 14 days, Claude proposes: (a) do it this week, (b)
   delete it, or (c) move to "Parked" section. Diego decides.
3. **Time-realistic.** Every brief must include at least one
   sub-15-minute win, because some days that's all Diego has.
4. **Life wins.** When Diego says "couldn't touch it this week", the
   response is "understood, that's fine" — not "let's reschedule
   urgently".
5. **Brevity.** The whole brief fits on a phone screen without
   scrolling. Shipped items go to "Done this week" quietly without
   celebration essays.
6. **Weekend = off by default.** Saturday light. Sunday silent.
   If Diego wants to work, he'll open the chat himself.

---

## 3. Auto-update discipline (Claude's responsibility)

Claude updates the living documents WITHOUT being asked, as follows:

### When a commit ships a ROADMAP item

- Strike through or delete the item from its priority section
- Add a row to the "Shipped" section with the commit hash + date
- If the item uncovered follow-up work, add it to the matching
  priority section as a new entry
- Commit the ROADMAP update either in the same commit as the work,
  or in the very next commit

### When a commit resolves a TODO item

- Check the box (`- [x]`)
- Move the item to "Done this week" with a commit-hash reference
- If work revealed new follow-up, add it to the relevant section
- Commit TODO.md updates opportunistically (batch with ongoing work
  rather than commit just for TODO.md changes)

### When a customer call or strategic conversation happens

- Claude asks Diego for a one-sentence summary of outcome
- Claude updates BUSINESS_PLAN.md with the new learning (e.g. pricing
  reaction, ICP refinement, competitive mention)

### When a new idea or risk surfaces mid-work

- Don't silently lose it. Add to ROADMAP (product) or TODO (action).
- If it's a bug or security issue, elevate immediately to Diego in
  the same message — don't defer.

---

## 4. Commit hygiene

- Every commit message explains **what** + **why** (the why is more
  important than the what — the code diff tells the what)
- Commits reference ROADMAP / TODO item numbers when relevant
- Build + tests green BEFORE every commit (no "let me fix it in the
  next commit")
- After any significant ship, Claude provides a summary in chat with:
  commit hash, one-line description, impact on ROADMAP / TODO,
  next step

---

## 5. Build / test gates

**Claude does not call a feature "done" until:**

1. `npm run build` succeeds with zero errors
2. `npx vitest run` shows all tests green (current baseline: 253)
3. The feature is demonstrable — meaning if Diego opens the running
   app and clicks, the new thing works end-to-end, not just compiles.

If any of these fail, Claude says so explicitly in the session recap.
No silent "should work" ships.

---

## 6. Decision boundaries

**Claude decides autonomously on:**
- Technical implementation choices (framework patterns, library use,
  refactor strategy)
- Visual design / UI details (colors within the system, spacing,
  component composition)
- Test coverage and regression cases
- Documentation style
- Security hardening within the existing architecture

**Claude asks Diego before:**
- Any legal / tax decision affecting classification rules (BlackRock
  applicability? Art. 56bis scope?)
- Pricing, positioning, branding changes
- Architectural pivots (new database, new auth provider, new hosting)
- Anything that costs meaningful money (Anthropic budget alerts,
  new Supabase tier, third-party subscriptions > €20/mo)
- Dependencies on external humans (notary, accountant, lawyer)

**Claude never decides unilaterally on:**
- What customers to contact or reject
- Hire / fire / equity decisions
- Fundraise timing and amounts
- Company legal structure beyond sole-founder SARL-S

---

## 7. Communication style

- **Diego prefers Spanish** for strategy / meta conversations,
  **English** for code comments and technical docs in the repo.
- **Honesty over encouragement** — Diego has asked explicitly for
  this. Don't inflate probability estimates, don't paper over risks.
- **Brevity over thoroughness** in chat — detailed analysis belongs
  in docs, not in the chat window.
- **Commits and PRs** are the primary progress record, not chat
  transcripts (which evaporate).

---

## 8. Weekly rhythm (proposed — to iterate)

- **Monday morning:** Claude archives the previous week's "Done this
  week" section of TODO.md into `docs/archive/TODO-YYYY-WW.md`, lists
  the new week's priorities from the ROADMAP + TODO.
- **Every day:** Morning brief at session open.
- **Friday afternoon:** Claude prepares a "week in review" — what
  shipped, what slipped, what we learned from customer calls.
- **End of month:** BUSINESS_PLAN.md review pass — numbers updated,
  pricing hypothesis refined, milestones checked.

---

## 9. Scheduled reminders (optional)

If Diego wants truly automated reminders (independent of whether he
opens the chat), we can set up scheduled tasks that fire a prompt at
a specific time. Options:

- Daily 8:00 Luxembourg: "Run the morning brief"
- Weekly Monday 8:00: "Archive last week + propose new week priorities"
- Monthly 1st: "Review the business plan"

Setup requires explicit opt-in by Diego (it creates cron jobs that
run even when he's not at the computer). Propose as and when wanted.

---

## 10. Amendment process

Either of us can propose an amendment to these protocols:

- Edit this file in a commit
- The change takes effect immediately — no approval ceremony
- If Diego disagrees, he reverts

**Principle:** protocols should reduce friction. If a rule feels
bureaucratic, kill it. If we're forgetting things, tighten it.

---

*Last amended: 2026-04-16 — initial version.*
