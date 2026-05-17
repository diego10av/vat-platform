import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne, execute, generateId, logAudit } from '@/lib/db';
import { apiError } from '@/lib/api-errors';

// GET /api/crm/companies/[id]/retainers — list topup events +
// computed balance.
//
// Balance formula (EUR, no multi-currency yet):
//   sum(topups) − sum(invoices.drawn_from_retainer_eur where company_id = this)
//
// Per-matter retainer balances: pass ?matter_id=... to scope to a
// single matter. Returns the same shape.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: companyId } = await params;
  const url = new URL(request.url);
  const matterId = url.searchParams.get('matter_id');

  // Top-up events.
  const topupsQ = matterId
    ? `SELECT id, amount_eur, topup_date::text AS topup_date, reference, notes, created_at::text AS created_at, created_by
         FROM crm_retainer_topups
        WHERE company_id = $1 AND matter_id = $2
        ORDER BY topup_date DESC, created_at DESC`
    : `SELECT id, matter_id, amount_eur, topup_date::text AS topup_date, reference, notes, created_at::text AS created_at, created_by
         FROM crm_retainer_topups
        WHERE company_id = $1
        ORDER BY topup_date DESC, created_at DESC`;
  const topupsP = matterId ? [companyId, matterId] : [companyId];
  const topups = await query(topupsQ, topupsP);

  const topupSum = topups.reduce((s, t) => s + Number((t as { amount_eur: string | number }).amount_eur), 0);

  // Drawdowns via invoices.
  const drawdownsQ = matterId
    ? `SELECT id, invoice_number, issue_date::text AS issue_date, drawn_from_retainer_eur
         FROM crm_billing_invoices
        WHERE company_id = $1 AND matter_id = $2 AND drawn_from_retainer_eur > 0
        ORDER BY issue_date DESC NULLS LAST`
    : `SELECT id, invoice_number, matter_id, issue_date::text AS issue_date, drawn_from_retainer_eur
         FROM crm_billing_invoices
        WHERE company_id = $1 AND drawn_from_retainer_eur > 0
        ORDER BY issue_date DESC NULLS LAST`;
  const drawdowns = await query(drawdownsQ, topupsP);
  const drawnSum = drawdowns.reduce((s, d) => s + Number((d as { drawn_from_retainer_eur: string | number }).drawn_from_retainer_eur), 0);

  return NextResponse.json({
    balance_eur: topupSum - drawnSum,
    total_topped_up_eur: topupSum,
    total_drawn_down_eur: drawnSum,
    topups,
    drawdowns,
  });
}

// POST — record a top-up. Body: { amount_eur (required, ≠ 0),
// topup_date (required), matter_id?, reference?, notes? }.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: companyId } = await params;
  const body = await request.json().catch(() => ({}));

  const amount = Number(body.amount_eur);
  if (!Number.isFinite(amount) || amount === 0) {
    return apiError('amount_invalid', 'amount_eur must be a non-zero number (negative = adjustment/refund).', { status: 400 });
  }
  const topupDate = typeof body.topup_date === 'string' ? body.topup_date : null;
  if (!topupDate) {
    return apiError('topup_date_required', 'topup_date is required (YYYY-MM-DD).', { status: 400 });
  }

  // Verify company exists.
  const existingCompany = await queryOne<{ id: string; company_name: string }>(
    `SELECT id, company_name FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  if (!existingCompany) return apiError('not_found', 'Company not found.', { status: 404 });

  const id = generateId();
  await execute(
    `INSERT INTO crm_retainer_topups
       (id, company_id, matter_id, amount_eur, topup_date, reference, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id, companyId,
      body.matter_id ?? null,
      amount, topupDate,
      body.reference ?? null,
      body.notes ?? null,
      body.created_by ?? 'founder',
    ],
  );

  await logAudit({
    action: amount > 0 ? 'retainer_topup' : 'retainer_adjustment',
    targetType: 'crm_company',
    targetId: companyId,
    field: 'retainer_balance',
    newValue: String(amount),
    reason: `Retainer ${amount > 0 ? 'top-up' : 'adjustment'}: €${amount.toFixed(2)}${body.reference ? ` · ref ${body.reference}` : ''}`,
  });

  return NextResponse.json({ id, amount_eur: amount }, { status: 201 });
}
