'use client';

// Home — the daily-starting-point dashboard for the VAT practitioner.
//
// Design intent (after 2026-04-18 audit per PROTOCOLS §11): every block
// on this page must answer "if this number changes, do I act
// differently?". Vanity stats are out. Current roster:
//
//   1. Priority cards: In review / AED urgent / Overdue — each click
//      takes you to the action screen.
//   2. Upcoming deadlines list: clickable rows.
//   3. "Filed this month" momentum chip: informs whether we're tracking.
//   4. Portfolio table: the drill-in for specific clients.
//
// Removed in the audit:
//   - "Active clients" KPI (pure count, not actionable)
//   - "In review" second counter (duplicates the priority card)
//   - "AI accuracy" placeholder that never had data

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PlusIcon, FileTextIcon, InboxIcon, CalendarIcon,
  ArrowRightIcon, AlertTriangleIcon, ClockIcon,
  SparklesIcon, TrendingUpIcon, BuildingIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSkeleton } from '@/components/ui/Skeleton';

interface Entity { id: string; name: string; client_name: string | null; regime: string; frequency: string }
interface Declaration {
  id: string; entity_id: string; entity_name: string;
  year: number; period: string; status: string;
  vat_due: number | null; filed_at: string | null; created_at: string;
}
interface DeadlineRow {
  entity_id: string; entity_name?: string;
  due_date: string; days_until: number; is_overdue: boolean; bucket: string;
  declaration_id: string | null; declaration_status: string;
}
interface AedLetter {
  id: string; type: string | null; amount: number | null;
  urgency: string | null; deadline_date: string | null; status: string;
  summary: string | null;
}

export default function Home() {
  const [entities, setEntities] = useState<Entity[] | null>(null);
  const [declarations, setDeclarations] = useState<Declaration[] | null>(null);
  const [deadlines, setDeadlines] = useState<DeadlineRow[] | null>(null);
  const [aed, setAed] = useState<AedLetter[] | null>(null);

  useEffect(() => {
    Promise.allSettled([
      fetch('/api/entities').then(r => r.json()),
      fetch('/api/declarations').then(r => r.json()),
      fetch('/api/deadlines').then(r => r.json()),
      fetch('/api/aed').then(r => r.json()),
    ]).then(([e, d, dl, a]) => {
      setEntities(e.status === 'fulfilled' ? e.value : []);
      setDeclarations(d.status === 'fulfilled' ? d.value : []);
      setDeadlines(dl.status === 'fulfilled' ? dl.value : []);
      setAed(a.status === 'fulfilled' ? a.value : []);
    });
  }, []);

  if (!entities || !declarations || !deadlines || !aed) return <PageSkeleton />;

  // ── KPIs and priorities ────────────────────────────────────────────
  const inReview = declarations.filter(d => d.status === 'review');
  const overdue  = deadlines.filter(d => d.is_overdue);
  const dueIn7   = deadlines.filter(d => d.bucket === 'urgent' && !d.is_overdue);
  const aedOpen  = aed.filter(a => a.status !== 'actioned' && a.status !== 'archived');
  const aedUrgent = aedOpen.filter(a => a.urgency === 'high');

  // Filed this month — "momentum" indicator
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const filedThisMonth = declarations.filter(d => d.filed_at && d.filed_at >= monthStart).length;

  const totalDueAmount = inReview.reduce((sum, d) => sum + Number(d.vat_due || 0), 0);

  // Top 5 upcoming deadlines for the side list
  const upcomingDeadlines = [...deadlines]
    .filter(d => d.days_until >= 0 || d.is_overdue)
    .sort((a, b) => a.days_until - b.days_until)
    .slice(0, 5);

  const entityById = new Map(entities.map(e => [e.id, e]));

  const greeting = getGreeting(now);

  return (
    <div className="max-w-[1200px]">
      {/* ── Hero greeting + quick actions ───────────────────────────── */}
      <header className="mb-8">
        <h1 className="text-[28px] font-bold text-ink tracking-tight leading-none" style={{ letterSpacing: '-0.02em' }}>
          {greeting}
        </h1>
        <p className="text-[14px] text-ink-muted mt-2">
          {summarySentence({
            inReviewCount: inReview.length,
            overdueCount: overdue.length,
            aedUrgentCount: aedUrgent.length,
          })}
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link href="/declarations">
            <Button variant="primary" size="md" icon={<PlusIcon size={14} />}>New declaration</Button>
          </Link>
          <Link href="/clients/new">
            <Button variant="secondary" size="md" icon={<BuildingIcon size={14} />}>Add client</Button>
          </Link>
          <Link href="/aed-letters">
            <Button variant="secondary" size="md" icon={<InboxIcon size={14} />}>Upload AED letter</Button>
          </Link>
        </div>
      </header>

      {/* ── Priority cards (attention + AED + overdue) ─────────────── */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <PriorityCard
          tone="warning"
          icon={<FileTextIcon size={16} />}
          title="In review"
          count={inReview.length}
          detail={
            inReview.length === 0
              ? 'Nothing waiting'
              : `${formatEur(totalDueAmount)} across ${inReview.length} declaration${inReview.length === 1 ? '' : 's'}`
          }
          cta="Open queue"
          href="/declarations?status=review"
          empty={inReview.length === 0}
        />
        <PriorityCard
          tone="danger"
          icon={<InboxIcon size={16} />}
          title="AED urgent"
          count={aedUrgent.length}
          detail={
            aedUrgent.length === 0
              ? aedOpen.length === 0 ? 'Inbox clear' : `${aedOpen.length} non-urgent letter${aedOpen.length === 1 ? '' : 's'}`
              : 'High-urgency letters awaiting action'
          }
          cta="Open inbox"
          href="/aed-letters"
          empty={aedUrgent.length === 0}
        />
        <PriorityCard
          tone="warning"
          icon={<AlertTriangleIcon size={16} />}
          title="Overdue"
          count={overdue.length}
          detail={
            overdue.length === 0
              ? dueIn7.length > 0
                ? `${dueIn7.length} due within 7 days`
                : 'No overdue deadlines'
              : `${overdue.length} past-due filing${overdue.length === 1 ? '' : 's'}`
          }
          cta="See deadlines"
          href="/deadlines"
          empty={overdue.length === 0}
        />
      </section>

      {/* ── Body grid: deadlines + KPIs ─────────────────────────────── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-8">
        {/* Upcoming deadlines — 2/3 width */}
        <div className="lg:col-span-2">
          <SectionCard
            title="Upcoming deadlines"
            subtitle="Next 5 filings by due date"
            right={
              <Link href="/deadlines" className="text-[12px] font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
                See all <ArrowRightIcon size={12} />
              </Link>
            }
          >
            {upcomingDeadlines.length === 0 ? (
              <EmptyState
                icon={<CalendarIcon size={22} />}
                title="No upcoming deadlines"
                description="Once you create a declaration, its filing deadline will appear here."
              />
            ) : (
              <ul className="divide-y divide-divider">
                {upcomingDeadlines.map((d, idx) => {
                  const entity = entityById.get(d.entity_id);
                  return (
                    <li key={`${d.entity_id}-${idx}`} className="py-3 first:pt-0 last:pb-0 flex items-center gap-3">
                      <BucketIcon bucket={d.bucket} isOverdue={d.is_overdue} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-ink truncate">
                          {entity?.name ?? d.entity_name ?? 'Entity'}
                        </div>
                        <div className="text-[11.5px] text-ink-muted mt-0.5">
                          {entity?.client_name && <>{entity.client_name} · </>}
                          {formatDate(d.due_date)}
                        </div>
                      </div>
                      <div className="shrink-0">
                        <BucketBadge bucket={d.bucket} days={d.days_until} isOverdue={d.is_overdue} />
                      </div>
                      <Link
                        href={d.declaration_id ? `/declarations/${d.declaration_id}` : `/entities/${d.entity_id}`}
                        className="shrink-0 text-[11.5px] font-medium text-brand-600 hover:text-brand-700"
                      >
                        Open →
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Momentum chip — 1/3 width. One actionable signal only:
            "filed this month" tells you whether you're on track. */}
        <div className="space-y-3">
          <SectionCard
            title="This month"
            subtitle="Momentum at a glance"
            compact
          >
            <div className="flex items-baseline gap-2">
              <div className="text-[34px] font-bold text-ink tabular-nums leading-none tracking-tight">
                {filedThisMonth}
              </div>
              <div className="text-[12px] text-ink-muted">declarations filed</div>
            </div>
            {filedThisMonth === 0 ? (
              <p className="text-[11.5px] text-ink-muted mt-3 leading-relaxed">
                Nothing filed yet this month. If you have declarations
                ready, they&apos;ll show up in the In-review card above.
              </p>
            ) : (
              <Link
                href="/declarations?status=filed"
                className="inline-flex items-center gap-1 mt-3 text-[12px] font-medium text-brand-600 hover:text-brand-700"
              >
                See filed list <ArrowRightIcon size={12} />
              </Link>
            )}
          </SectionCard>
        </div>
      </section>

      {/* ── Portfolio table ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h2 className="text-[16px] font-semibold text-ink tracking-tight">Your portfolio</h2>
            <p className="text-[12px] text-ink-muted mt-0.5">Every client entity you manage, sorted by next deadline.</p>
          </div>
          <Link href="/clients" className="text-[12px] font-medium text-brand-600 hover:text-brand-700 inline-flex items-center gap-1">
            Manage clients <ArrowRightIcon size={12} />
          </Link>
        </div>

        {entities.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl">
            <EmptyState
              icon={<SparklesIcon size={22} />}
              title="No clients yet"
              description="Start by creating your first client. Entities hang off clients — you add entities once the client exists."
              action={
                <Link href="/clients/new">
                  <Button variant="primary" icon={<PlusIcon size={14} />}>Create first client</Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-hidden shadow-xs">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-alt border-b border-divider text-ink-muted">
                <tr>
                  <Th>Client · Entity</Th>
                  <Th>Regime · Frequency</Th>
                  <Th>Latest period</Th>
                  <Th>Status</Th>
                  <Th align="right">Due</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {buildPortfolioRows(entities, declarations, deadlines).map(({ entity: e, decl, deadline }) => (
                  <tr
                    key={e.id}
                    className="border-b border-divider last:border-0 hover:bg-surface-alt/60 transition-colors duration-150"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/entities/${e.id}`} className="group">
                        <div className="font-medium text-ink group-hover:text-brand-600 transition-colors">{e.name}</div>
                        {e.client_name && <div className="text-[11px] text-ink-muted mt-0.5">{e.client_name}</div>}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-soft capitalize">{e.regime} · {e.frequency}</td>
                    <td className="px-4 py-3 text-ink-soft">
                      {decl ? `${decl.year} ${decl.period}` : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {decl ? <StatusPill status={decl.status} /> : <StatusPill status="not_started" />}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {deadline ? <BucketBadge bucket={deadline.bucket} days={deadline.days_until} isOverdue={deadline.is_overdue} /> : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {decl ? (
                        <Link href={`/declarations/${decl.id}`} className="text-brand-600 hover:text-brand-700 text-[11.5px] font-medium">
                          Open
                        </Link>
                      ) : (
                        <Link href={`/declarations?entity_id=${e.id}`} className="text-brand-600 hover:text-brand-700 text-[11.5px] font-medium">
                          Start
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ═════════════════ Sub-components (local to Home) ═════════════════

function PriorityCard({
  tone, icon, title, count, detail, cta, href, empty,
}: {
  tone: 'warning' | 'danger' | 'success';
  icon: React.ReactNode;
  title: string;
  count: number;
  detail: string;
  cta: string;
  href: string;
  empty: boolean;
}) {
  const toneClasses = empty
    ? 'border-border bg-surface'
    : tone === 'danger'
      ? 'border-danger-500/20 bg-gradient-to-br from-danger-50 to-surface'
      : tone === 'warning'
        ? 'border-brand-100 bg-gradient-to-br from-brand-50 to-surface'
        : 'border-success-500/20 bg-gradient-to-br from-success-50 to-surface';

  const iconClasses = empty
    ? 'bg-surface-alt text-ink-muted'
    : tone === 'danger'
      ? 'bg-danger-500 text-white'
      : tone === 'warning'
        ? 'bg-brand-500 text-white'
        : 'bg-success-500 text-white';

  return (
    <Link href={href} className="group block">
      <div className={`rounded-xl border ${toneClasses} p-5 transition-all duration-150 group-hover:shadow-md group-hover:-translate-y-px`}>
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0 ${iconClasses}`}>
            {icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-ink-muted">{title}</div>
            <div className="text-[28px] font-bold text-ink tabular-nums leading-none mt-1.5 tracking-tight" style={{ letterSpacing: '-0.02em' }}>
              {count}
            </div>
            <div className="text-[12px] text-ink-soft mt-2">{detail}</div>
            <div className="text-[12px] text-brand-600 font-medium mt-3 inline-flex items-center gap-1 group-hover:gap-1.5 transition-all">
              {cta} <ArrowRightIcon size={12} />
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function SectionCard({
  title, subtitle, right, compact = false, children,
}: {
  title: string; subtitle?: string; right?: React.ReactNode; compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-border rounded-xl shadow-xs overflow-hidden">
      <div className={`px-4 ${compact ? 'py-2.5' : 'py-3'} border-b border-divider flex items-center justify-between`}>
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-ink tracking-tight">{title}</h3>
          {subtitle && <p className="text-[11px] text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      <div className={compact ? 'p-4' : 'p-4'}>
        {children}
      </div>
    </div>
  );
}

function BucketIcon({ bucket, isOverdue }: { bucket: string; isOverdue: boolean }) {
  const cls =
    isOverdue ? 'bg-danger-50 text-danger-700' :
    bucket === 'urgent' ? 'bg-brand-50 text-brand-700' :
    bucket === 'soon' ? 'bg-warning-50 text-warning-700' :
    'bg-surface-alt text-ink-muted';
  const Icon = isOverdue ? AlertTriangleIcon : bucket === 'urgent' ? ClockIcon : CalendarIcon;
  return (
    <div className={`w-8 h-8 rounded-lg inline-flex items-center justify-center shrink-0 ${cls}`}>
      <Icon size={14} />
    </div>
  );
}

function BucketBadge({ bucket, days, isOverdue }: { bucket: string; days: number; isOverdue: boolean }) {
  if (isOverdue) return <Badge tone="danger" icon={<AlertTriangleIcon size={10} />}>{Math.abs(days)}d overdue</Badge>;
  if (bucket === 'urgent') return <Badge tone="warning" icon={<ClockIcon size={10} />}>{days}d</Badge>;
  if (bucket === 'soon') return <Badge tone="amber">{days}d</Badge>;
  if (bucket === 'comfortable') return <Badge tone="info">{days}d</Badge>;
  return <Badge tone="neutral">{days}d</Badge>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { tone: 'neutral' | 'info' | 'violet' | 'amber' | 'warning' | 'success' | 'teal' | 'brand'; label: string }> = {
    not_started: { tone: 'neutral', label: 'Not started' },
    created:     { tone: 'neutral', label: 'Created' },
    uploading:   { tone: 'info',    label: 'Uploading' },
    extracting:  { tone: 'violet',  label: 'Extracting' },
    classifying: { tone: 'amber',   label: 'Classifying' },
    review:      { tone: 'warning', label: 'Review' },
    approved:    { tone: 'success', label: 'Approved' },
    filed:       { tone: 'teal',    label: 'Filed' },
    paid:        { tone: 'success', label: 'Paid' },
  };
  const { tone, label } = map[status] || { tone: 'neutral' as const, label: status };
  return <Badge tone={tone}>{label}</Badge>;
}

function Th({ children, align = 'left' }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-4 py-2.5 font-medium text-[10.5px] uppercase tracking-[0.06em] ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}

// ═════════════════ Helpers ═════════════════

function buildPortfolioRows(entities: Entity[], declarations: Declaration[], deadlines: DeadlineRow[]) {
  return entities
    .map(e => {
      const lastDecl = declarations
        .filter(d => d.entity_id === e.id)
        .sort((a, b) => (b.year - a.year) || b.period.localeCompare(a.period))[0];
      const dl = deadlines.find(d => d.entity_id === e.id);
      return { entity: e, decl: lastDecl, deadline: dl };
    })
    .sort((a, b) => (a.deadline?.days_until ?? 9999) - (b.deadline?.days_until ?? 9999));
}

function getGreeting(now: Date): string {
  // Reviewer-specific: defaults to "Diego" until we wire user profile
  const name = 'Diego';
  const h = now.getHours();
  if (h < 6)  return `Late night, ${name}`;
  if (h < 12) return `Good morning, ${name}`;
  if (h < 18) return `Good afternoon, ${name}`;
  return `Good evening, ${name}`;
}

function summarySentence({
  inReviewCount, overdueCount, aedUrgentCount,
}: { inReviewCount: number; overdueCount: number; aedUrgentCount: number }): string {
  const parts: string[] = [];
  if (inReviewCount > 0) parts.push(`${inReviewCount} declaration${inReviewCount === 1 ? '' : 's'} in review`);
  if (aedUrgentCount > 0) parts.push(`${aedUrgentCount} AED letter${aedUrgentCount === 1 ? '' : 's'} to answer`);
  if (overdueCount > 0) parts.push(`${overdueCount} deadline${overdueCount === 1 ? '' : 's'} overdue`);
  if (parts.length === 0) return 'Inbox clear. Nothing urgent on the list.';
  if (parts.length === 1) return `${parts[0]} — that\u2019s your priority today.`;
  return parts.join(' · ') + '.';
}

function formatEur(n: number): string {
  if (n === 0) return 'EUR 0';
  return 'EUR ' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return iso;
  }
}

// Suppress unused warning — retained for future KPI expansion
void TrendingUpIcon;
