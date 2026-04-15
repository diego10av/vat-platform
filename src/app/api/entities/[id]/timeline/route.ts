import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';

// GET /api/entities/[id]/timeline — full history page payload
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entity = await queryOne(
    `SELECT * FROM entities WHERE id = $1`,
    [id]
  );
  if (!entity) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  // Declarations history with computed totals
  const declarations = await query<{
    id: string; year: number; period: string; status: string;
    filing_ref: string | null; filed_at: string | null;
    payment_confirmed_at: string | null; created_at: string;
    line_count: number; total_ex_vat: number; vat_payable: number;
  }>(
    `SELECT d.id, d.year, d.period, d.status,
            d.filing_ref, d.filed_at, d.payment_confirmed_at, d.created_at,
            COALESCE((SELECT COUNT(*)::int FROM invoice_lines il
                       WHERE il.declaration_id = d.id AND il.state != 'deleted'), 0) AS line_count,
            COALESCE((SELECT SUM(il.amount_eur)::float FROM invoice_lines il
                       JOIN invoices i ON il.invoice_id = i.id
                      WHERE il.declaration_id = d.id
                        AND il.state != 'deleted'
                        AND i.direction = 'incoming'), 0) AS total_ex_vat,
            COALESCE((SELECT SUM(il.rc_amount)::float FROM invoice_lines il
                      WHERE il.declaration_id = d.id
                        AND il.state != 'deleted'
                        AND il.treatment LIKE 'RC_%'), 0)
            +
            COALESCE((SELECT SUM(il.amount_eur * 0.17)::float FROM invoice_lines il
                      WHERE il.declaration_id = d.id
                        AND il.state != 'deleted'
                        AND il.treatment = 'IC_ACQ'), 0) AS vat_payable
       FROM declarations d
      WHERE d.entity_id = $1
      ORDER BY d.year DESC, d.period DESC`,
    [id]
  );

  // Top providers across all declarations
  const topProviders = await query<{ provider: string; total: number; invoice_count: number }>(
    `SELECT i.provider,
            SUM(il.amount_eur)::float AS total,
            COUNT(DISTINCT i.id)::int AS invoice_count
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE i.declaration_id IN (SELECT id FROM declarations WHERE entity_id = $1)
        AND il.state != 'deleted'
        AND i.provider IS NOT NULL
        AND i.direction = 'incoming'
      GROUP BY i.provider
      ORDER BY total DESC NULLS LAST
      LIMIT 10`,
    [id]
  );

  // Precedents for this entity
  const precedents = await query(
    `SELECT id, provider, country, treatment, last_amount, last_used, times_used
       FROM precedents WHERE entity_id = $1 ORDER BY times_used DESC, last_used DESC LIMIT 50`,
    [id]
  );

  // AED letters
  const aedLetters = await query(
    `SELECT id, filename, type, urgency, status, summary, deadline_date, uploaded_at
       FROM aed_communications WHERE entity_id = $1 ORDER BY uploaded_at DESC LIMIT 20`,
    [id]
  );

  // Recent audit events
  const recentAudit = await query(
    `SELECT a.id, a.action, a.target_type, a.field, a.old_value, a.new_value, a.created_at,
            d.year, d.period
       FROM audit_log a
       LEFT JOIN declarations d ON a.declaration_id = d.id
      WHERE a.entity_id = $1
      ORDER BY a.created_at DESC
      LIMIT 25`,
    [id]
  );

  return NextResponse.json({
    entity,
    declarations,
    top_providers: topProviders,
    precedents,
    aed_letters: aedLetters,
    recent_audit: recentAudit,
  });
}
