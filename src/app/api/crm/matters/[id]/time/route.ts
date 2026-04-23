import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// Budget thresholds checked after every time-entry insert. When
// cumulative spend crosses any of these (upward) as a result of the
// new entry, we auto-create a single crm_tasks row. One task per
// threshold per matter — dedup guarantees we don't spam the user on
// repeat logging around the same percentage band.
const BUDGET_THRESHOLDS = [0.75, 0.90, 1.00] as const;

// GET /api/crm/matters/[id]/time — list time entries for a matter.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const rows = await query(
    `SELECT id, matter_id, user_id, entry_date, hours, rate_eur, billable,
            billed_on_invoice_id, description, created_at, updated_at
       FROM crm_time_entries
      WHERE matter_id = $1
      ORDER BY entry_date DESC, created_at DESC`,
    [id],
  );
  return NextResponse.json(rows);
}

// POST /api/crm/matters/[id]/time — log a new time entry.
// Required: entry_date, hours. rate_eur inherits from matter.hourly_rate_eur
// if not provided + matter.fee_type === 'hourly'.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: matterId } = await params;
  const body = await request.json().catch(() => ({}));
  const hours = Number(body.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return apiError('hours_required', 'hours must be a positive number.', { status: 400 });
  }
  if (!body.entry_date) return apiError('date_required', 'entry_date is required.', { status: 400 });

  // Resolve rate from matter if not explicit.
  let rate = body.rate_eur != null ? Number(body.rate_eur) : null;
  if (rate === null) {
    const matter = await query<{ hourly_rate_eur: string; fee_type: string }>(
      `SELECT hourly_rate_eur::text, fee_type FROM crm_matters WHERE id = $1`,
      [matterId],
    );
    if (matter[0] && matter[0].fee_type === 'hourly' && matter[0].hourly_rate_eur) {
      rate = Number(matter[0].hourly_rate_eur);
    }
  }

  const id = generateId();
  await execute(
    `INSERT INTO crm_time_entries
       (id, matter_id, activity_id, user_id, entry_date, hours, rate_eur,
        billable, description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id, matterId,
      body.activity_id ?? null,
      body.user_id ?? 'founder',
      body.entry_date,
      hours,
      rate,
      body.billable !== false,
      body.description ?? null,
    ],
  );

  await logAudit({
    action: 'time_logged',
    targetType: 'crm_matter',
    targetId: matterId,
    newValue: `${hours}h on ${body.entry_date}`,
    reason: body.description || 'Time entry',
  });

  // Budget threshold auto-tasks. Fails open — an alert error doesn't
  // block the primary POST response.
  try {
    await checkBudgetThresholds(matterId, id);
  } catch { /* swallow */ }

  return NextResponse.json({ id, hours, entry_date: body.entry_date }, { status: 201 });
}

// Checks spent-before vs spent-after for the matter and creates auto-
// tasks for any threshold crossed upward. Called AFTER the new time
// entry row exists — we subtract its contribution to compute "before".
async function checkBudgetThresholds(matterId: string, newEntryId: string): Promise<void> {
  const matter = await queryOne<{
    id: string; title: string | null;
    estimated_budget_eur: string | null; hourly_rate_eur: string | null;
  }>(
    `SELECT id, title, estimated_budget_eur::text, hourly_rate_eur::text
       FROM crm_matters WHERE id = $1`,
    [matterId],
  );
  if (!matter) return;
  const budget = Number(matter.estimated_budget_eur ?? 0);
  if (!Number.isFinite(budget) || budget <= 0) return;   // no budget set → no alert

  // Total billable unbilled-or-billed spend on the matter.
  const totals = await queryOne<{ time_total: string; disb_total: string; new_contrib: string }>(
    `SELECT
        COALESCE((SELECT SUM(te.hours * COALESCE(te.rate_eur, m.hourly_rate_eur, 0))
                    FROM crm_time_entries te
                    JOIN crm_matters m ON m.id = te.matter_id
                   WHERE te.matter_id = $1 AND te.billable = TRUE), 0)::text AS time_total,
        COALESCE((SELECT SUM(amount_eur) FROM crm_disbursements
                   WHERE matter_id = $1 AND billable = TRUE), 0)::text AS disb_total,
        COALESCE((SELECT te.hours * COALESCE(te.rate_eur, m.hourly_rate_eur, 0)
                    FROM crm_time_entries te
                    JOIN crm_matters m ON m.id = te.matter_id
                   WHERE te.id = $2), 0)::text AS new_contrib`,
    [matterId, newEntryId],
  );
  if (!totals) return;
  const spentAfter = Number(totals.time_total) + Number(totals.disb_total);
  const newContrib = Number(totals.new_contrib);
  const spentBefore = Math.max(0, spentAfter - newContrib);

  for (const t of BUDGET_THRESHOLDS) {
    const pct = Math.round(t * 100);
    const crossedUp = spentBefore / budget < t && spentAfter / budget >= t;
    if (!crossedUp) continue;

    // Dedup: open task for this same threshold on this matter?
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM crm_tasks
        WHERE related_type = 'crm_matter' AND related_id = $1
          AND auto_generated = TRUE
          AND status IN ('open','in_progress')
          AND title LIKE $2`,
      [matterId, `Budget ${pct}% crossed%`],
    );
    if (existing) continue;

    const taskId = generateId();
    const title = `Budget ${pct}% crossed — ${matter.title ?? matterId}`;
    const due = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const priority = t >= 1.00 ? 'high' : 'medium';

    await execute(
      `INSERT INTO crm_tasks
         (id, title, description, related_type, related_id, status,
          priority, due_date, auto_generated, created_at, updated_at)
       VALUES ($1,$2,$3,'crm_matter',$4,'open',$5,$6,TRUE,NOW(),NOW())`,
      [
        taskId, title,
        `€${spentAfter.toFixed(2)} of €${budget.toFixed(2)} budget spent on this matter. ` +
          (t >= 1.00
            ? 'Budget exceeded — discuss scope change or cap increase with the client before logging more billable work.'
            : t >= 0.90
              ? 'Approaching budget. Consider a client check-in before you pass 100%.'
              : 'Past 75% of budget. Sanity-check remaining scope and inform the client.'),
        matterId,
        priority, due,
      ],
    );
    await logAudit({
      action: 'budget_threshold_task_created',
      targetType: 'crm_matter',
      targetId: matterId,
      field: `${pct}_pct`,
      newValue: spentAfter.toFixed(2),
      reason: `Auto-created ${pct}% budget alert task for matter ${matter.title ?? matterId}`,
    });
  }
}
