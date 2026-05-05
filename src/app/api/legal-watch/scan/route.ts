import { NextRequest, NextResponse } from 'next/server';
import { runLegalWatchScan } from '@/lib/legal-watch-scan';
import { requireSession } from '@/lib/require-role';

// POST /api/legal-watch/scan
//
// Runs the legal-watch scanner against one or more public feeds and
// inserts new hits into legal_watch_queue for reviewer triage.
//
// Query / body:
//   ?source=vatupdate    (default — live feed)
//   ?source=sample       (seed with the three flagship recent cases)
//   ?fallback=true       (on live fetch failure, use sample as backup)
//
// Admin-only: the scanner writes new queue rows, so junior/reviewer
// roles don't get to run it on demand.
export async function POST(request: NextRequest) {
  const roleFail = await requireSession(request);
  if (roleFail) return roleFail;

  const url = new URL(request.url);
  const sourceParam = (url.searchParams.get('source') || 'vatupdate').toLowerCase();
  const fallback = url.searchParams.get('fallback') === 'true';

  const validSources = new Set(['vatupdate', 'sample']);
  if (!validSources.has(sourceParam)) {
    return NextResponse.json(
      { error: { code: 'invalid_source', message: `Unknown source "${sourceParam}" — expected vatupdate | sample` } },
      { status: 400 },
    );
  }

  try {
    const reports = await runLegalWatchScan({
      sources: [sourceParam as 'vatupdate' | 'sample'],
      useFallback: fallback,
    });
    return NextResponse.json({ ok: true, reports });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'scan failed';
    return NextResponse.json(
      { error: { code: 'scan_failed', message } },
      { status: 500 },
    );
  }
}
