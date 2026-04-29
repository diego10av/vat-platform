'use client';

// ════════════════════════════════════════════════════════════════════════
// /crm/help — Getting Started + best-practices guide for cifra's CRM.
//
// This is the document Diego (or a junior) reads ONCE to understand
// how the 7 entities chain together, what the daily + weekly rhythms
// look like, and where the hidden power features live. Written as a
// one-page long-scroll rather than a multi-step tour — faster to
// scan, easier to link to a specific heading, trivially printable.
//
// Kept factual and specific to a LU PE law firm workflow. Not
// marketing prose — actionable guidance.
// ════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import {
  BookOpenIcon, UsersIcon, TargetIcon, BriefcaseIcon,
  CheckSquareIcon, EuroIcon, CalendarIcon, BuildingIcon,
  CalendarDaysIcon, SparklesIcon, KeyboardIcon, ZapIcon,
  HelpCircleIcon, ArrowRightIcon,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

export default function HelpPage() {
  return (
    <div className="max-w-[820px] mx-auto">
      <div className="text-xs text-ink-muted mb-2">
        <Link href="/crm" className="hover:underline">← CRM home</Link>
      </div>
      <PageHeader
        title={<span className="inline-flex items-center gap-2"><BookOpenIcon size={18} />Getting started</span>}
        subtitle="How to use cifra's CRM — the fast path."
      />

      {/* Table of contents */}
      <nav className="border border-border rounded-md bg-surface-alt/30 p-3 mb-6 text-sm">
        <div className="text-2xs uppercase tracking-wide font-semibold text-ink-muted mb-2">Contents</div>
        <ol className="space-y-1 list-decimal list-inside text-ink-soft">
          <li><a href="#what-it-is" className="hover:underline">What this CRM is</a></li>
          <li><a href="#entities" className="hover:underline">The 7 entities + how they chain</a></li>
          <li><a href="#daily" className="hover:underline">Daily workflow (5 minutes)</a></li>
          <li><a href="#weekly" className="hover:underline">Weekly workflow (20 minutes)</a></li>
          <li><a href="#best-practices" className="hover:underline">Best practices (LU PE law)</a></li>
          <li><a href="#power" className="hover:underline">Power features most people miss</a></li>
          <li><a href="#troubleshooting" className="hover:underline">Troubleshooting &amp; FAQ</a></li>
        </ol>
      </nav>

      {/* ─── 1. What this CRM is ─── */}
      <Section id="what-it-is" title="1 · What this CRM is">
        <p>
          A private workspace for the client-facing side of your firm: accounts, deals,
          matters, billing, activities, tasks. It replaces Notion for that work.
        </p>
        <p>
          What this CRM is <strong>not</strong>: the VAT / LTVA compliance module. Those
          live elsewhere in cifra (<code>/clients</code>, <code>/entities</code>,
          <code>/declarations</code>). The CRM is about relationships + pipeline + legal
          billing; the tax module is about declarations + classifier + AED.
        </p>
      </Section>

      {/* ─── 2. The 7 entities ─── */}
      <Section id="entities" title="2 · The 7 entities + how they chain">
        <p>Every record lives in one of these categories. The chain matters — each arrow is a real database link.</p>
        <div className="border border-border rounded-md p-3 bg-white font-mono text-xs leading-loose overflow-x-auto">
          Company &nbsp;→&nbsp; Contact &nbsp;→&nbsp; Opportunity &nbsp;→&nbsp; Matter &nbsp;→&nbsp; Activity / Task &nbsp;→&nbsp; Invoice &nbsp;→&nbsp; Payment
        </div>
        <EntityRow icon={BuildingIcon} title="Company" blurb="A client account (or prospect). Holds classification (Key Account / Standard / Occasional), billing address, VAT, retainer balance." />
        <EntityRow icon={UsersIcon} title="Contact" blurb="A person at a company. Many-to-many with companies (via the junction). Carries lifecycle (lead → customer), engagement (auto-computed from last_activity_at), role tags." />
        <EntityRow icon={TargetIcon} title="Opportunity" blurb="A potential engagement in the pipeline. 7 stages, drag-drop kanban, weighted value = estimated × probability. Won → open a matter." />
        <EntityRow icon={BriefcaseIcon} title="Matter" blurb="An active legal engagement. MP-YYYY-NNNN reference, parties, scope, team, fee structure, budget + cap, time entries, disbursements, closing checklist." />
        <EntityRow icon={CalendarIcon} title="Activity" blurb="A call / meeting / email logged against a company / opportunity / matter / contact. Can auto-create a time entry (check the box)." />
        <EntityRow icon={CheckSquareIcon} title="Task" blurb="A to-do with due date + priority. Can be attached to any record. Many are auto-generated (payment reminders, budget alerts, template apply, anniversaries)." />
        <EntityRow icon={EuroIcon} title="Invoice" blurb="A billable document linked to a company + optional matter. PDF generation, VAT snapshot, retainer drawdown, approval threshold, credit notes. Payments create status transitions." />
      </Section>

      {/* ─── 3. Daily ─── */}
      <Section id="daily" title="3 · Daily workflow — 5 minutes">
        <ol className="list-decimal list-inside space-y-2">
          <li>Open <Link href="/crm" className="text-brand-700 hover:underline">/crm</Link>. Scan the home widgets in order:
            <ul className="list-disc list-inside ml-5 mt-1 text-ink-soft text-sm">
              <li><strong>Forecast</strong> — weighted pipeline closing this quarter.</li>
              <li><strong>Unbilled work</strong> — top matters with WIP waiting to be invoiced.</li>
              <li><strong>Upcoming · next 7 days</strong> — everything date-driven: follow-ups, deal closes, matter closures, birthdays, invoices due.</li>
              <li><strong>Today&apos;s focus</strong> — ranked action list. Handle top 3.</li>
            </ul>
          </li>
          <li>When you close a bit of billable work, log time. From <Link href="/crm/matters" className="text-brand-700 hover:underline">the matter</Link>, or by creating a meeting activity with the &quot;Also log as billable time entry&quot; checkbox ticked.</li>
          <li>If you had a meeting, log the activity with outcome + notes. It auto-updates the contact&apos;s <code>last_activity_at</code> which drives engagement.</li>
          <li>If you kicked off a deal, add it as an Opportunity in <strong>cold_identified</strong> (just a name on a list) or <strong>warm</strong> (you already know the contact). Drag it through the kanban as it progresses: cold → warm → first touch → meeting → proposal → negotiation → won/lost.</li>
        </ol>
      </Section>

      {/* ─── 4. Weekly ─── */}
      <Section id="weekly" title="4 · Weekly workflow — 20 minutes">
        <ul className="list-disc list-inside space-y-2">
          <li><Link href="/crm/billing?view=dashboard" className="text-brand-700 hover:underline">Billing dashboard</Link> — check top-10 clients, aging buckets, YoY. Anything in 60+ aging is calling territory.</li>
          <li>Open <Link href="/crm/opportunities" className="text-brand-700 hover:underline">the opportunities kanban</Link> — anything stuck {'>'}14 days in stage already shows as an NBA action, but eyeball everything for hygiene.</li>
          <li>Scan <Link href="/crm/matters" className="text-brand-700 hover:underline">matters</Link> — filter by active, check closing-date column for anything approaching, trigger closing checklist where relevant.</li>
          <li>Review the <Link href="/crm/calendar" className="text-brand-700 hover:underline">calendar</Link> for the coming two weeks. Birthdays, anniversaries, matter closes, deal closes all cross-cut.</li>
          <li>Glance at any new auto-tasks created during the week (payment reminders, budget crossings, anniversaries, template-applied, rule-fired).</li>
        </ul>
      </Section>

      {/* ─── 5. Best practices ─── */}
      <Section id="best-practices" title="5 · Best practices — LU PE law">
        <Practice title="Open every matter through the wizard, not the quick-add."
          body="The wizard forces the conflict-check step before save. Quick-add exists only to import historic matters with a known clean record." />
        <Practice title="Set estimated_budget_eur on every fee-type=hourly matter."
          body="Enables automatic tasks at 75% / 90% / 100% of budget. Without this, you find out you&apos;re over budget when the invoice lands." />
        <Practice title="Log conflict check every time parties change."
          body="Not just at matter open. Counterparty added mid-deal? Re-run the scan from the matter detail page. Persists into conflict_check_result JSONB for audit trail." />
        <Practice title="Treat engagement letter as the first line item of the first invoice."
          body="It anchors the billing record to a real document + locks the fee basis you agreed with the client." />
        <Practice title="Record payments same day they land."
          body="The aging report + DSO only work if payments match reality. Retainer drawdowns also show up in the ledger in real time." />
        <Practice title="Use task templates at the right moments."
          body='New client onboarding → apply on the company. Matter opening → wizard handles it. M&A deal kickoff → apply on the matter day 1. Closing a matter → mirrors the 7-step checklist.' />
        <Practice title="Fill birthday + client_anniversary for Key Accounts."
          body="Weekly cron surfaces them 7 days ahead so you can send something human. Low-effort, high-retention." />
      </Section>

      {/* ─── 6. Power features ─── */}
      <Section id="power" title="6 · Power features most people miss">
        <Power icon={KeyboardIcon} title="⌘K — Global search"
          body="Cmd+K (Ctrl+K on Windows) from anywhere in /crm opens a fuzzy search across companies + contacts + matters + opportunities + invoices. Arrow keys to navigate. Fastest way to jump." />
        <Power icon={KeyboardIcon} title="Keyboard shortcuts g+letter"
          body="g c → Companies, g o → Opportunities, g m → Matters, g a → Activities, g t → Tasks, g b → Billing. Learn once, use forever." />
        <Power icon={ZapIcon} title="Automations"
          body={<>Rules in <Link href="/crm/settings/automations" className="text-brand-700 hover:underline">/crm/settings/automations</Link>. Three pre-seeded: proposal_sent → follow-up in 5 days, opp won → open matter task, invoice sent → confirm-receipt task. Toggle them off if they don&apos;t fit your flow.</>} />
        <Power icon={SparklesIcon} title="AI meeting brief"
          body={<>Any contact detail page → &quot;Meeting brief&quot; button. Opus 4.7 generates a 1-page prep doc from the contact&apos;s history, companies, open opps, invoice trail. Costs ~€0.01 per brief. Copy + download .md supported.</>} />
        <Power icon={SparklesIcon} title="Monthly lead scoring"
          body={<>First of every month, Haiku 4.5 scores up to 50 lead/prospect contacts 0-100 with reasoning. Badge appears on the contact detail page with the reasoning text. Zero manual work — flag shows up overnight.</>} />
        <Power icon={CheckSquareIcon} title="Task templates"
          body={<>&quot;Apply template&quot; button on matter + company detail pages. 3 pre-seeded: client onboarding (7 tasks), matter closing (7 steps), M&amp;A deal kickoff (7 tasks). Each task gets a due date offset from today. One click to seed 7 to-dos.</>} />
        <Power icon={CalendarDaysIcon} title="Full calendar view"
          body={<><Link href="/crm/calendar" className="text-brand-700 hover:underline">/crm/calendar</Link> cross-cuts every date source. Month grid with up-to-3 events per cell; click a day to see all. Color-coded by type.</>} />
        <Power icon={BuildingIcon} title="Categories are editable"
          body={<>Countries, industries, practice areas, fee types, contact roles, lead sources, loss reasons — all edit at <Link href="/crm/settings/taxonomies" className="text-brand-700 hover:underline">/crm/settings/taxonomies</Link>. Add new values, rename, archive. No code changes.</>} />
      </Section>

      {/* ─── 7. Troubleshooting ─── */}
      <Section id="troubleshooting" title="7 · Troubleshooting + FAQ">
        <FAQ q="The billing dashboard says 'Loading dashboard...' forever."
          a="If you see this again, look for the red error banner above — it now tells you the actual error with a Retry button. If the error mentions SQL, it's a migration out of sync; ping the engineer." />
        <FAQ q="I deleted a company by mistake."
          a={<>Click <strong>Undo</strong> on the success toast within 5 seconds. After that: <Link href="/crm/trash" className="text-brand-700 hover:underline">/crm/trash</Link> holds soft-deleted records for 30 days with a Restore button. After 30 days the weekly trash-purge cron hard-deletes.</>} />
        <FAQ q="A contact shows engagement = lapsed but I called them yesterday."
          a="Log the call as an activity with activity_date = yesterday. The daily cron recomputes engagement from max(activity_date). If you want to override manually, the contact form has an engagement_override field." />
        <FAQ q="My invoice won't move from draft to sent."
          a="Settings → Firm identity → if you set an approval threshold, any invoice above that amount needs an explicit Approve click first. Look for the green 'Approved by' banner on the invoice." />
        <FAQ q="Time entries aren't showing up on the WIP widget."
          a="The WIP widget shows billable unbilled hours. Check (a) the entry's billable=true, (b) billed_on_invoice_id is null, (c) the matter isn't deleted. You can eyeball all time entries on the matter detail page." />
        <FAQ q="How do I disable an automation rule?"
          a={<>Go to <Link href="/crm/settings/automations" className="text-brand-700 hover:underline">/crm/settings/automations</Link>, click the circle next to the rule name to toggle off. The rule stops firing but past auto-created tasks remain.</>} />
        <FAQ q="Can I export data to Excel?"
          a="Every list page has an Excel button in the top right. Export respects your active filters + search. Relations expand to human-readable names (not UUIDs)." />
        <FAQ q="How do I open a matter from a won deal?"
          a="On the opportunity detail page, once stage=won, a green CTA appears: 'Deal won — ready to open the matter?'. Click it and the matter wizard opens with client, contact, practice areas, and title pre-filled." />
      </Section>

      <div className="mt-8 p-4 border border-border rounded-md bg-surface-alt/40 text-sm text-ink-soft">
        <div className="inline-flex items-center gap-2 font-semibold text-ink mb-1">
          <HelpCircleIcon size={14} />
          Still stuck?
        </div>
        <p>Something broken or confusing? The error banner on any CRM page has a Retry button — use it first. For anything deeper, open an issue with the specific URL + what you expected.</p>
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-7 scroll-mt-16">
      <h2 className="text-base font-semibold text-ink mb-3 flex items-center gap-2 pb-1 border-b border-border">
        {title}
        <a href={`#${id}`} className="text-2xs text-ink-muted hover:text-ink ml-1 no-underline" aria-label="Permalink">#</a>
      </h2>
      <div className="text-sm text-ink-soft space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}

function EntityRow({ icon: Icon, title, blurb }: { icon: typeof BookOpenIcon; title: string; blurb: string }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <div className="shrink-0 mt-0.5 w-7 h-7 rounded-md bg-brand-50 text-brand-700 inline-flex items-center justify-center">
        <Icon size={13} />
      </div>
      <div className="text-sm">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-ink-soft"> — {blurb}</span>
      </div>
    </div>
  );
}

function Practice({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <ArrowRightIcon size={14} className="shrink-0 mt-1 text-brand-600" />
      <div>
        <div className="font-semibold text-ink">{title}</div>
        <div className="text-ink-soft mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function Power({ icon: Icon, title, body }: { icon: typeof BookOpenIcon; title: string; body: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <div className="shrink-0 mt-0.5 w-6 h-6 rounded-md bg-surface-alt text-ink-soft inline-flex items-center justify-center">
        <Icon size={12} />
      </div>
      <div>
        <div className="font-semibold text-ink">{title}</div>
        <div className="text-ink-soft mt-0.5">{body}</div>
      </div>
    </div>
  );
}

function FAQ({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="border border-border rounded-md p-2.5 bg-white">
      <summary className="cursor-pointer text-sm font-semibold text-ink">{q}</summary>
      <div className="text-sm text-ink-soft mt-2 pl-0.5">{a}</div>
    </details>
  );
}
