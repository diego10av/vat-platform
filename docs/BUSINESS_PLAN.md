# cifra SARL-S · Business Plan

> **v0.1 — living document.** Revise after every customer discovery call,
> every product milestone, every funding discussion. Keep this in Git
> so every iteration is versioned.

---

## 1. Elevator pitch

cifra is modern Luxembourg VAT compliance software for tax professionals.
Built classifier-first (deterministic rules with full LTVA / CJEU
citations; AI only for genuinely ambiguous cases), cifra cuts VAT filing
time from hours to minutes while preserving the audit-defensible
trail an AED inspection demands.

## 2. The problem

Luxembourg VAT return preparation today:

- ~70% of firms still work from Excel + Word templates
- A mid-size fund entity return takes **2-5 hours of senior time**
- Most of that time is transcription (reading a PDF, typing numbers)
  and judgment (classifying services under Art. 44 sub-paragraphs)
- Classification requires deep LU VAT knowledge → expensive senior
  hours spent on work that is 80% routine
- AED audit defensibility is hard to reconstruct if challenged three
  years after filing
- **ViDA directives (2027-2030)** force every LU firm to digitise before
  those deadlines → compulsory modernisation window

Translation: every LU tax professional is over-paying for under-traceable
work, on a deadline.

## 3. Target customers (ICP)

**Primary ICP (year 1):** Boutique fiduciary firms in Luxembourg,
5-20 people, handling 50-300 fund entities.
- Why this segment: big enough to pay for SaaS (not €20/mo consumer
  software), small enough to adopt fast without 12-month procurement
  cycles, the pain is acute, and the buyer is typically the managing
  partner (short sales cycle).

**Secondary ICP:** Mid-tier accounting firms with VAT specialism
(not Big-4).

**Tertiary (year 2+):** In-house VAT teams at mid-to-large AIFMs.

**Explicitly not (yet):** Big-4. They build internally. They are the
exit target, not the day-1 customer.

**Market sizing (rough):**
- ~200-300 boutique fiduciary firms in LU
- ~50 mid-tier accounting firms with VAT practice
- Addressable market in LU ≈ 300-400 firms
- Average spend potential €3-8k/year per firm
- Pure LU TAM ≈ €1-3M annual revenue
- BE + NL + DE expansion (years 2-3) extends TAM 5-10×

## 4. Product positioning

See `docs/positioning.md`.

## 5. Pricing hypothesis (TO VALIDATE)

Current best-guess model (**hypothesis only — must be tested with 5
customer conversations before committing**):

| Plan | Monthly | Seats | Entities | Declarations/mo | Extra decl. | Chat AI cap (€/user/mo) |
|------|---------|-------|----------|-----------------|-------------|---------------------------|
| Starter | €99 | 1 | up to 3 | 1 included | €25 | €1 (Haiku only) |
| Firm | €299 | 3 | up to 15 | 10 included | €15 | €2 (Haiku + Ask-Opus) |
| Enterprise | custom | soft-unlimited | soft-unlimited | soft-unlimited | 0 | €10 (admin can raise to €30) |

Enterprise adds: SSO, SLA, white-label, account manager.

**Nothing is truly unlimited** — every quantity has a soft cap
enforced in-product, denominated either in units (seats, entities,
declarations) or in monthly LLM spend (chat AI). Rationale: a single
rogue user pasting huge documents into the chat on Opus can run up
€50+/day; without caps, "unlimited" plans become gross-margin
landmines. See `docs/MODELS.md §4` for AI cap mechanics.

**Validation action:** 5 discovery calls with LU firms (varied size)
within 14 days. Open-ended questions on pricing, not "would you pay €X".

**Alternative models to consider:**
- Pure per-declaration (€30-50 per return) — simpler to explain
- Revenue-share on savings (harder to measure, harder to sell)
- Flat per-entity-per-year (€200-400/entity/year, no seat cap)

## 6. Competition

| Competitor | Strength | Weakness vs cifra |
|------------|----------|---------------------|
| **Excel + Word templates** | Free, familiar, no procurement | No classifier, no audit trail, no scale. 80% of today's market. |
| **Big-4 internal tools** | Deep, integrated | Not for sale externally; slow to evolve; no LU-specific classifier with CJEU citations |
| **Avalara, Sovos, Taxually** | Global VAT coverage | Shallow on LU specifics (no Art. 44 sub-paragraphs, no AED circular tracking, no CJEU citation system) |
| **TaxCloud, Fonoa** | US/global focus | Not LU |
| **Fiduciary firms' in-house IT** | Know the specific client | Maintenance burden; no network effects |

**Our moat:**
1. LU-specific depth nobody else will invest in (the market is too small
   for global players to care)
2. Legal-watch system that survives regulatory change (built into DNA,
   not a bolted-on feature)
3. Domain-native founder who can speak the language with buyers
4. Classifier with 32+ rules and 60-case regression corpus — competitors
   using pure LLM classification cannot match the defensibility

## 7. Go-to-market

### Phase 1 — founder-led sales (months 0-6)
- Cold outreach to 50 LU fiduciary firms (LinkedIn + warm intros)
- Target: 10 discovery calls → 3 paid customers → €5-15k MRR
- Channels: LinkedIn, ALFI events, ACEL (Chambre des experts comptables), referrals

### Phase 2 — content + community (months 6-12)
- LinkedIn posts on VAT technicalities (BlackRock, Versãofast, ViDA)
- ALFI event sponsorship / speaking
- First case studies with paying customers
- Target: 10-20 paid customers → €20-60k MRR

### Phase 3 — first hire (year 2)
- First sales / CS hire to free founder for product
- Channel partnerships (notaries, corporate services)
- Expansion to BE + NL
- Target: 50-100 paid customers → €150-400k MRR

## 8. Milestones

| When | What |
|------|------|
| **Tonight (2026-04-16)** | ROADMAP + BUSINESS_PLAN + positioning docs · Validator UI integration |
| Week 1 | SARL-S constituted (€1 capital, notary) · GitHub token rotated · `cifra-app` repo rename |
| Week 1 | Landing page live on cifracompliance.com |
| Week 1-2 | First 5 customer discovery calls |
| Week 2-3 | Pricing validated · first "friendly" paid pilot |
| Week 4-6 | Multi-user + roles shipped · client approval portal shipped · Sentry + rate limiting |
| Month 3 | 3 paying customers · €2-5k MRR |
| Month 6 | 10 paying customers · €10-30k MRR · first hire decision |
| Month 12 | 25-40 customers · €50-100k MRR |

## 9. Financial projections (skeleton — TBD)

Operating costs (year 1):
- Anthropic API: €500-1,500/month at scale (assuming 50 declarations/
  month · €3-10 per declaration in tokens)
- Supabase Pro: $25/mo early, $599/mo when scale hits
- Vercel Pro: $20/mo
- Sentry: free tier → $29/mo
- Legal (notary, SARL-S): one-off ~€1,500 + ~€600/year accountant
- Domain + email: <€50/year

**Year-1 burn if full-time founder with no salary: ~€15-25k**
**Year-1 burn with founder salary (€4,000/month net): ~€65-85k**

Revenue projections (to iterate):
- Month 3: €2,000 MRR → €24k ARR
- Month 6: €10,000 MRR → €120k ARR
- Month 12: €50,000 MRR → €600k ARR (aggressive but reachable with 100 customers at €500/mo blended)

Break-even (assuming €60k annual founder salary + ~€15k other): ~€75k
ARR → ~15 customers at €420/mo. Achievable in 6-9 months with disciplined GTM.

**TBD:** full P&L, cash runway, fundraise decision (bootstrap vs
angels vs seed).

## 10. Legal / Corporate

- **Entity:** cifra SARL-S (Société à responsabilité limitée
  simplifiée) to be constituted in Luxembourg
- **Capital:** €1 minimum (SARL-S innovation for new businesses)
- **Notary cost:** ~€1,500 one-off + RCS + CCSS registration
- **Setup time:** 7-10 days with a notary
- **Domain:** cifracompliance.com (owned)
- **Repo:** github.com/diego10av/cifra (renamed from `vat-platform` on 2026-04-18)
- **IP:** all code in repo; MIT or proprietary (to decide — proprietary
  for the core classifier + legal-sources, probably open-source the UI
  components for marketing)
- **Founder equity:** 100% Diego Gonzalez Manso (at formation)
- **First contract client:** cifra SARL-S will be its own first user,
  filing its own VAT returns — useful dogfooding + credible story

## 11. Key risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Slow LU adoption ("we've always used Excel") | High | Target early adopters, case studies, free pilot window |
| Big-4 clones the approach | Medium | Their speed is slow; cifra gets to 10 customers first; defensible moat via legal-watch depth |
| Single-founder bandwidth limit | High | Plan to hire CS/technical by month 6-12; consider co-founder |
| AED schema changes invalidate eCDF output | Medium | Legal-watch triage system already tracks this; budget 2-3 days/quarter for schema refresh |
| Anthropic pricing / availability risk | Low | All LLM calls are logged; model is swappable; cache validator runs |
| ViDA timeline shifts | Low-medium | Track in legal-watch; communicate to customers as it evolves |
| GDPR violation exposure | Medium | Ship GDPR tooling (P2 #27) before multi-tenant customers |
| Cash runway before revenue | High | Bootstrap initially; keep burn under €5k/mo until €10k MRR |

## 12. Key decisions to make (dated checklist)

- [ ] **Week 1:** confirm SARL-S vs SA vs SARL (recommendation: SARL-S)
- [ ] **Week 1:** choose notary (get 2 quotes; Alex Schmitt notaries, Bonn Steichen, or lower-cost alternative)
- [ ] **Week 1-2:** finalise domain email setup (contact@cifracompliance.com)
- [ ] **Week 2-3:** finalise pricing based on customer calls
- [ ] **Week 3-4:** first paid pilot closed
- [ ] **Month 2:** decide bootstrap vs raise (angels: €150-300k pre-seed for 15% is standard for LU)
- [ ] **Month 3:** decide first hire role (CS or product)
- [ ] **Month 6:** decide BE+NL expansion timing
- [ ] **Year 1:** evaluate Big-4 conversation (partnership / acquisition)

---

*Next review of this document: after the first 5 customer calls (expected week 2-3 of 2026-04).*
