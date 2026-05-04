import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/crm/upcoming?days=7
//
// Unified next-N-days event feed across every date-bearing CRM entity
// + (since stint 64.Q.6) tax-ops deadlines. Powers <UpcomingThisWeek
// Widget /> on the home and the /crm/calendar month view.
//
// Diego: "todos los calendarios de la plataforma cifracompliance están
// vinculados de tal modo que si me meto me aparecen todas las cosas
// que tengo pendientes, o por hacer tanto de tax operations como de
// CRM o como de VAT. No quiero tener que ir pasando de calendario en
// calendario." Right call — there's now ONE calendar feed for the
// whole product.
//
// Sources + event types:
//   - crm_contacts.next_follow_up          → type: 'follow_up'
//   - crm_contacts.birthday (MMDD match)   → type: 'birthday'
//   - crm_contacts.client_anniversary (MMDD match) → type: 'anniversary'
//   - crm_opportunities.estimated_close_date       → type: 'opp_close'
//   - crm_opportunities.next_action_due    → type: 'opp_next_action'
//   - crm_matters.closing_date (active)    → type: 'matter_close'
//   - crm_tasks.due_date (open)            → type: 'task_due'
//   - crm_billing_invoices.due_date (outstanding) → type: 'invoice_due'
//
// Stint 66.B — `tax_deadline` source removed (Rule §14: strict
// module independence). The 'tax_deadline' event type stays in the
// union so existing consumers don't crash, but no new events of
// that type are emitted by this endpoint.
//
// Returns flat array, sorted ascending by date.

export type UpcomingEventType =
  | 'follow_up'
  | 'birthday'
  | 'anniversary'
  | 'opp_close'
  | 'opp_next_action'
  | 'matter_close'
  | 'task_due'
  | 'invoice_due'
  | 'tax_deadline';

export interface UpcomingEvent {
  id: string;
  type: UpcomingEventType;
  date: string;
  title: string;
  detail?: string;
  link: string;
  target_type: string;
  target_id: string;
}

const MAX_DAYS = 90;
const MIN_DAYS = 1;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const daysRaw = Number(url.searchParams.get('days') ?? 7);
  const days = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Number.isFinite(daysRaw) ? daysRaw : 7));

  const events: UpcomingEvent[] = [];

  // ─── 1. Contact follow-ups ─────────────────────────────────────
  const followUps = await query<{ id: string; full_name: string; next_follow_up: string }>(
    `SELECT id, full_name, next_follow_up::text
       FROM crm_contacts
      WHERE deleted_at IS NULL
        AND next_follow_up IS NOT NULL
        AND next_follow_up BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const f of followUps) {
    events.push({
      id: `follow_up:${f.id}`, type: 'follow_up', date: f.next_follow_up,
      title: `Follow up with ${f.full_name}`,
      link: `/crm/contacts/${f.id}`,
      target_type: 'crm_contact', target_id: f.id,
    });
  }

  // ─── 2. Birthdays (DOY-based, year-agnostic) ───────────────────
  // Project the stored birthday onto the current or next calendar
  // year so it falls within the requested window. Using a CTE keeps
  // the MMDD maths explicit — current-year candidate first, fall
  // back to next year if already past.
  const birthdays = await query<{ id: string; full_name: string; upcoming_date: string }>(
    `WITH candidates AS (
       SELECT id, full_name,
              CASE
                WHEN (DATE_TRUNC('year', CURRENT_DATE) +
                      (EXTRACT(DOY FROM birthday) - 1 || ' days')::interval)::date < CURRENT_DATE
                THEN (DATE_TRUNC('year', CURRENT_DATE + INTERVAL '1 year') +
                      (EXTRACT(DOY FROM birthday) - 1 || ' days')::interval)::date
                ELSE (DATE_TRUNC('year', CURRENT_DATE) +
                      (EXTRACT(DOY FROM birthday) - 1 || ' days')::interval)::date
              END AS upcoming_date
         FROM crm_contacts
        WHERE deleted_at IS NULL AND birthday IS NOT NULL
     )
     SELECT id, full_name, upcoming_date::text
       FROM candidates
      WHERE upcoming_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const b of birthdays) {
    events.push({
      id: `birthday:${b.id}`, type: 'birthday', date: b.upcoming_date,
      title: `${b.full_name}'s birthday`,
      link: `/crm/contacts/${b.id}`,
      target_type: 'crm_contact', target_id: b.id,
    });
  }

  // ─── 3. Client anniversaries ────────────────────────────────────
  const anniversaries = await query<{ id: string; full_name: string; upcoming_date: string }>(
    `WITH candidates AS (
       SELECT id, full_name,
              CASE
                WHEN (DATE_TRUNC('year', CURRENT_DATE) +
                      (EXTRACT(DOY FROM client_anniversary) - 1 || ' days')::interval)::date < CURRENT_DATE
                THEN (DATE_TRUNC('year', CURRENT_DATE + INTERVAL '1 year') +
                      (EXTRACT(DOY FROM client_anniversary) - 1 || ' days')::interval)::date
                ELSE (DATE_TRUNC('year', CURRENT_DATE) +
                      (EXTRACT(DOY FROM client_anniversary) - 1 || ' days')::interval)::date
              END AS upcoming_date
         FROM crm_contacts
        WHERE deleted_at IS NULL AND client_anniversary IS NOT NULL
     )
     SELECT id, full_name, upcoming_date::text
       FROM candidates
      WHERE upcoming_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const a of anniversaries) {
    events.push({
      id: `anniversary:${a.id}`, type: 'anniversary', date: a.upcoming_date,
      title: `${a.full_name}'s client anniversary`,
      link: `/crm/contacts/${a.id}`,
      target_type: 'crm_contact', target_id: a.id,
    });
  }

  // ─── 4. Opportunity close + next-action dates ───────────────────
  const oppCloses = await query<{ id: string; name: string; estimated_close_date: string; client_name: string | null }>(
    `SELECT o.id, o.name, o.estimated_close_date::text, c.company_name AS client_name
       FROM crm_opportunities o
       LEFT JOIN crm_companies c ON c.id = o.company_id
      WHERE o.deleted_at IS NULL
        AND o.stage NOT IN ('won', 'lost')
        AND o.estimated_close_date IS NOT NULL
        AND o.estimated_close_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const o of oppCloses) {
    events.push({
      id: `opp_close:${o.id}`, type: 'opp_close', date: o.estimated_close_date,
      title: `Opp close: ${o.name}`,
      detail: o.client_name ?? undefined,
      link: `/crm/opportunities/${o.id}`,
      target_type: 'crm_opportunity', target_id: o.id,
    });
  }

  const oppNext = await query<{ id: string; name: string; next_action: string; next_action_due: string }>(
    `SELECT id, name, next_action, next_action_due::text
       FROM crm_opportunities
      WHERE deleted_at IS NULL
        AND stage NOT IN ('won', 'lost')
        AND next_action IS NOT NULL AND next_action_due IS NOT NULL
        AND next_action_due BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const o of oppNext) {
    events.push({
      id: `opp_next_action:${o.id}`, type: 'opp_next_action', date: o.next_action_due,
      title: o.next_action,
      detail: o.name,
      link: `/crm/opportunities/${o.id}`,
      target_type: 'crm_opportunity', target_id: o.id,
    });
  }

  // ─── 5. Matter closing dates (active only) ─────────────────────
  const matterCloses = await query<{ id: string; matter_reference: string; title: string; closing_date: string }>(
    `SELECT id, matter_reference, title, closing_date::text
       FROM crm_matters
      WHERE deleted_at IS NULL
        AND status = 'active'
        AND closing_date IS NOT NULL
        AND closing_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const m of matterCloses) {
    events.push({
      id: `matter_close:${m.id}`, type: 'matter_close', date: m.closing_date,
      title: `Close matter: ${m.title}`,
      detail: m.matter_reference,
      link: `/crm/matters/${m.id}`,
      target_type: 'crm_matter', target_id: m.id,
    });
  }

  // ─── 6. Tasks due ──────────────────────────────────────────────
  const tasks = await query<{ id: string; title: string; due_date: string; priority: string }>(
    `SELECT id, title, due_date::text, priority
       FROM crm_tasks
      WHERE status = 'open'
        AND due_date IS NOT NULL
        AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const t of tasks) {
    events.push({
      id: `task_due:${t.id}`, type: 'task_due', date: t.due_date,
      title: t.title,
      detail: `Priority: ${t.priority}`,
      link: `/crm/tasks`,
      target_type: 'crm_task', target_id: t.id,
    });
  }

  // ─── 7. Invoices due ───────────────────────────────────────────
  const invoices = await query<{ id: string; invoice_number: string; due_date: string; outstanding: string; client_name: string | null }>(
    `SELECT b.id, b.invoice_number, b.due_date::text, b.outstanding::text,
            c.company_name AS client_name
       FROM crm_billing_invoices b
       LEFT JOIN crm_companies c ON c.id = b.company_id
      WHERE b.status IN ('sent', 'partial_paid', 'overdue')
        AND b.outstanding > 0
        AND b.due_date IS NOT NULL
        AND b.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + ($1 || ' days')::interval`,
    [days],
  );
  for (const i of invoices) {
    events.push({
      id: `invoice_due:${i.id}`, type: 'invoice_due', date: i.due_date,
      title: `Invoice ${i.invoice_number} due`,
      detail: i.client_name ? `${i.client_name} · €${Number(i.outstanding).toFixed(2)} outstanding` : `€${Number(i.outstanding).toFixed(2)} outstanding`,
      link: `/crm/billing/${i.id}`,
      target_type: 'crm_invoice', target_id: i.id,
    });
  }

  // Stint 66.B — section "Tax-ops filing deadlines" REMOVED. It was
  // pulling tax_filings + tax_obligations + tax_entities into the CRM
  // upcoming widget (stint 64.Q.6). Diego's Rule §14: strict module
  // independence — CRM does not surface Tax-Ops data. Tax deadlines
  // belong to /tax-ops (TasksDueWidget + StuckFollowUpsWidget +
  // filings 2x2 grid on /tax-ops home + the inbox on every page).
  //
  // The `tax_deadline` event type stays in the union so older clients
  // don't break, but the GET will never emit one. A future cleanup
  // can drop it from the type union and consumers.

  // Sort ascending by date, then by type for stable ordering.
  events.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));

  return NextResponse.json({ days, events });
}
