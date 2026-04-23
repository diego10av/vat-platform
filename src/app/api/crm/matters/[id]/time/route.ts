import { NextRequest, NextResponse } from 'next/server';
import { query, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

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

  return NextResponse.json({ id, hours, entry_date: body.entry_date }, { status: 201 });
}
