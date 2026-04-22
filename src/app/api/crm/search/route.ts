import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

// GET /api/crm/search?q=acme&limit=8
// Cross-entity fuzzy search over companies / contacts / opportunities /
// matters / invoices. Returns the top N hits per type.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const limitPerType = Math.min(15, Math.max(1, Number(url.searchParams.get('limit') ?? 5) || 5));

  if (q.length < 2) {
    return NextResponse.json({
      companies: [], contacts: [], opportunities: [], matters: [], invoices: [],
    });
  }

  const pattern = `%${q}%`;

  const [companies, contacts, opportunities, matters, invoices] = await Promise.all([
    query(
      `SELECT id, company_name AS label, classification, country
         FROM crm_companies
        WHERE deleted_at IS NULL AND company_name ILIKE $1
        ORDER BY company_name ASC
        LIMIT $2`,
      [pattern, limitPerType],
    ),
    query(
      `SELECT id, full_name AS label, email, job_title
         FROM crm_contacts
        WHERE deleted_at IS NULL
          AND (full_name ILIKE $1 OR email ILIKE $1)
        ORDER BY full_name ASC
        LIMIT $2`,
      [pattern, limitPerType],
    ),
    query(
      `SELECT o.id, o.name AS label, o.stage, c.company_name AS company_name
         FROM crm_opportunities o
         LEFT JOIN crm_companies c ON c.id = o.company_id
        WHERE o.deleted_at IS NULL AND o.name ILIKE $1
        ORDER BY o.name ASC
        LIMIT $2`,
      [pattern, limitPerType],
    ),
    query(
      `SELECT m.id, m.matter_reference || ' — ' || m.title AS label, m.status,
              c.company_name AS client_name
         FROM crm_matters m
         LEFT JOIN crm_companies c ON c.id = m.client_company_id
        WHERE m.deleted_at IS NULL
          AND (m.matter_reference ILIKE $1 OR m.title ILIKE $1)
        ORDER BY m.opening_date DESC NULLS LAST
        LIMIT $2`,
      [pattern, limitPerType],
    ),
    query(
      `SELECT b.id, b.invoice_number AS label, b.status, b.amount_incl_vat,
              c.company_name AS client_name
         FROM crm_billing_invoices b
         LEFT JOIN crm_companies c ON c.id = b.company_id
        WHERE b.invoice_number ILIKE $1
        ORDER BY b.issue_date DESC NULLS LAST
        LIMIT $2`,
      [pattern, limitPerType],
    ),
  ]);

  return NextResponse.json({ companies, contacts, opportunities, matters, invoices });
}
