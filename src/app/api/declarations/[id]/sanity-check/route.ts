import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { apiError, apiFail } from '@/lib/api-errors';
import { requireSession } from '@/lib/require-role';
import { runSanityCheck, type BoxSnapshot } from '@/lib/ecdf-sanity-check';
import { computeECDF } from '@/lib/ecdf';

// POST /api/declarations/[id]/sanity-check
//
// Runs the Opus 4.7 pre-filing sanity check: compares current eCDF
// box values to the prior period's, inspects treatment histogram and
// direction split, returns findings[] with severity + narrative.
//
// No DB persistence — the result is returned directly to the client
// which renders it as a panel on the declaration detail page. The
// reviewer decides whether the findings warrant a change before
// filing.

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params;

    // admin OR reviewer can run this
    const roleFail = await requireSession(request);
    if (roleFail) return roleFail;

    const decl = await queryOne<{
      entity_id: string;
      year: number;
      period: string;
      entity_name: string;
      entity_type: string | null;
      regime: string;
      frequency: string;
    }>(
      `SELECT d.entity_id, d.year, d.period,
              e.name AS entity_name,
              e.entity_type,
              e.regime,
              e.frequency
         FROM declarations d
         JOIN entities e ON d.entity_id = e.id
        WHERE d.id = $1`,
      [id],
    );
    if (!decl) {
      return apiError('not_found', 'declaration not found', { status: 404 });
    }

    const current = await snapshotForDeclaration(id, `${decl.year} ${decl.period}`);
    if (!current) {
      return apiError(
        'empty_declaration',
        'This declaration has no classified lines yet — sanity check runs after classification.',
        { status: 400 },
      );
    }

    const priorDecl = await queryOne<{ id: string; year: number; period: string }>(
      `SELECT id, year, period
         FROM declarations
        WHERE entity_id = $1
          AND (year < $2 OR (year = $2 AND period < $3))
          AND status IN ('filed', 'paid', 'approved')
        ORDER BY year DESC, period DESC
        LIMIT 1`,
      [decl.entity_id, decl.year, decl.period],
    );

    const prior = priorDecl
      ? await snapshotForDeclaration(priorDecl.id, `${priorDecl.year} ${priorDecl.period}`)
      : null;

    const result = await runSanityCheck(
      {
        entity_name: decl.entity_name,
        entity_type: decl.entity_type,
        regime: decl.regime,
        frequency: decl.frequency,
        current,
        prior,
      },
      { entityId: decl.entity_id, declarationId: id },
    );

    if (!result) {
      return apiError(
        'sanity_check_failed',
        'Opus 4.7 sanity check did not return a usable answer. Retry, or review aggregate numbers manually.',
        { status: 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      declaration_id: id,
      prior_period: priorDecl ? `${priorDecl.year} ${priorDecl.period}` : null,
      ...result,
    });
  } catch (err) {
    return apiFail(err, 'declarations/sanity-check');
  }
}

async function snapshotForDeclaration(
  declId: string,
  periodLabel: string,
): Promise<BoxSnapshot | null> {
  // Compute eCDF box values via the existing pure-TS engine so the
  // snapshot matches what the reviewer sees in the Outputs tab.
  let report;
  try {
    report = await computeECDF(declId);
  } catch {
    return null;
  }
  const boxes = report.box_values;

  // Invoice histogram for the AI prompt.
  const agg = await queryOne<{
    invoice_count: string;
    total_incoming: string;
    total_outgoing: string;
  }>(
    `SELECT COUNT(DISTINCT i.id)::text AS invoice_count,
            COALESCE(SUM(CASE WHEN i.direction='incoming' THEN il.amount_eur ELSE 0 END), 0)::text AS total_incoming,
            COALESCE(SUM(CASE WHEN i.direction='outgoing' THEN il.amount_eur ELSE 0 END), 0)::text AS total_outgoing
       FROM invoice_lines il
       JOIN invoices i ON il.invoice_id = i.id
      WHERE il.declaration_id = $1
        AND il.state != 'deleted'`,
    [declId],
  );

  const histRows = await queryTreatmentHistogram(declId);
  const treatmentHistogram: Record<string, number> = {};
  for (const r of histRows) treatmentHistogram[r.treatment ?? 'UNCLASSIFIED'] = Number(r.n);

  return {
    period_label: periodLabel,
    boxes,
    invoice_count: Number(agg?.invoice_count ?? 0),
    total_incoming_eur: Number(agg?.total_incoming ?? 0),
    total_outgoing_eur: Number(agg?.total_outgoing ?? 0),
    treatment_histogram: treatmentHistogram,
  };
}

async function queryTreatmentHistogram(
  declId: string,
): Promise<Array<{ treatment: string | null; n: string }>> {
  const { query } = await import('@/lib/db');
  return query<{ treatment: string | null; n: string }>(
    `SELECT treatment, COUNT(*)::text AS n
       FROM invoice_lines
      WHERE declaration_id = $1
        AND state != 'deleted'
      GROUP BY treatment
      ORDER BY COUNT(*) DESC`,
    [declId],
  );
}
