import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { buildICal, type ICalEvent } from '@/lib/ical';

// GET /api/tax-ops/calendar.ics?token=<CIFRA_ICAL_TOKEN>
//
// Stint 42.C — iCal feed of upcoming tax-ops deadlines. Intended to
// be subscribed from Google / Apple / Outlook Calendar "Add by URL"
// so Diego sees deadlines alongside his regular agenda.
//
// Scope: filings with a computed deadline in the window
//   [CURRENT_DATE - 30d, CURRENT_DATE + 180d]
// whose status is not yet filed.
//
// Auth: a static token query param matched against CIFRA_ICAL_TOKEN.
// This is a low-sensitivity signal (entity names + tax types + dates,
// no financial figures) so a shared token is sufficient. If the env
// var is unset the endpoint returns 503 so nothing leaks.

interface FeedRow {
  filing_id: string;
  entity_name: string;
  group_name: string | null;
  tax_type: string;
  period_label: string;
  deadline_date: string;
  status: string;
  updated_at: string;
}

function humanTaxType(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export async function GET(request: NextRequest): Promise<Response> {
  const token = process.env.CIFRA_ICAL_TOKEN;
  if (!token) {
    return new Response('iCal feed not configured (missing CIFRA_ICAL_TOKEN)', {
      status: 503,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const url = new URL(request.url);
  const provided = url.searchParams.get('token');
  if (provided !== token) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'content-type': 'text/plain' },
    });
  }

  const rows = await query<FeedRow>(`
    SELECT f.id AS filing_id,
           e.legal_name AS entity_name,
           g.name AS group_name,
           o.tax_type,
           f.period_label,
           f.deadline_date::text AS deadline_date,
           f.status,
           f.updated_at::text AS updated_at
      FROM tax_filings f
      JOIN tax_obligations o ON o.id = f.obligation_id
      JOIN tax_entities e    ON e.id = o.entity_id
      LEFT JOIN tax_client_groups g ON g.id = e.client_group_id
     WHERE f.deadline_date IS NOT NULL
       AND f.deadline_date >= CURRENT_DATE - INTERVAL '30 days'
       AND f.deadline_date <= CURRENT_DATE + INTERVAL '180 days'
       AND f.status <> 'filed'
       AND e.is_active = TRUE
     ORDER BY f.deadline_date ASC
  `);

  const host = request.headers.get('host') ?? 'app.cifracompliance.com';
  const scheme = host.startsWith('localhost') ? 'http' : 'https';
  const origin = `${scheme}://${host}`;

  const events: ICalEvent[] = rows.map(r => {
    const summary = `${humanTaxType(r.tax_type)} ${r.period_label} — ${r.entity_name}`;
    const descLines = [
      `Status: ${r.status.replace(/_/g, ' ')}`,
      r.group_name ? `Family: ${r.group_name}` : null,
      `Open in cifra: ${origin}/tax-ops/filings/${r.filing_id}`,
    ].filter((x): x is string => !!x);
    return {
      uid: `${r.filing_id}@cifracompliance.com`,
      date: r.deadline_date,
      summary,
      description: descLines.join('\n'),
      url: `${origin}/tax-ops/filings/${r.filing_id}`,
      updated: r.updated_at,
    };
  });

  const body = buildICal({
    prodId: '-//cifra//tax-ops deadlines//EN',
    calendarName: 'cifra — tax-ops deadlines',
    calendarDescription: 'Upcoming Luxembourg tax filing deadlines for entities you track in cifra. Read-only feed.',
    events,
  });

  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      // Filename hint for clients that download instead of subscribe.
      'content-disposition': 'inline; filename="cifra-tax-ops.ics"',
      // Cache at the edge for 5 minutes — calendar clients re-fetch
      // on their own schedule (typically every few hours).
      'cache-control': 'public, max-age=300, s-maxage=300',
    },
  });
}
