// ─────────────────────────────────────────────────────────────────────
// legal-watch scanner
//
// Fetches candidate jurisprudence / circulars / AED notices from
// public feeds, filters by `LEGAL_WATCH_KEYWORDS`, and inserts new
// hits into `legal_watch_queue` for reviewer triage.
//
// Design notes:
//   - Fetcher is a pluggable interface. Today: a VATupdate RSS fetcher
//     (simple, reliable) + a built-in fallback seed for environments
//     with no network egress (tests, isolated dev).
//   - Deduplication is the responsibility of the DB via the
//     (source, external_id) unique index — `ON CONFLICT DO NOTHING`.
//   - The scanner NEVER auto-escalates into legal-sources.ts. That
//     remains a reviewer decision + a manual code change, so the
//     audit trail of rule changes is always attributable.
// ─────────────────────────────────────────────────────────────────────

import { execute, query } from '@/lib/db';
import { matchKeywords } from '@/config/legal-watch-keywords';
import { triageQueueItem } from '@/lib/legal-watch-triage';

export interface FeedItem {
  source: string;        // 'vatupdate' | 'curia' | 'legilux' | 'aed' | 'sample'
  external_id: string;   // source-specific stable id
  title: string;
  url?: string | null;
  summary?: string | null;
  published_at?: string | null; // ISO
}

export interface ScanReport {
  source: string;
  fetched: number;
  filtered: number;       // kept after keyword match
  inserted: number;       // genuinely new
  skipped_duplicate: number;
  errors: string[];
}

/** VATupdate.com publishes a general WordPress RSS at /feed/ covering
 *  EU VAT judgments + commentary. It's a broad stream — we filter
 *  down with our own keyword list. */
const VATUPDATE_FEED = 'https://www.vatupdate.com/feed/';

/** Minimal XML RSS parser tailored to WordPress feeds. We parse one
 *  shape, we don't aim for general RSS compliance — if the feed ever
 *  changes shape the scanner logs the parse failure and skips,
 *  leaving the queue untouched. */
function parseRss(xml: string): FeedItem[] {
  const items: FeedItem[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const match = (block: string, tag: string): string | null => {
    // Handle both <tag>value</tag> and <tag><![CDATA[value]]></tag>
    const re = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`);
    const m = block.match(re);
    return m ? m[1].trim() : null;
  };
  let m: RegExpExecArray | null;
  while ((m = itemRegex.exec(xml)) !== null) {
    const block = m[1];
    const title = match(block, 'title') || '';
    const link = match(block, 'link') || '';
    const guid = match(block, 'guid') || link || title;
    const desc = match(block, 'description') || '';
    const pub = match(block, 'pubDate') || '';
    let publishedIso: string | null = null;
    if (pub) {
      const d = new Date(pub);
      if (!Number.isNaN(d.getTime())) publishedIso = d.toISOString();
    }
    // Strip HTML tags from description for a clean summary.
    const summary = desc.replace(/<[^>]*>/g, '').trim().slice(0, 1200);
    items.push({
      source: 'vatupdate',
      external_id: guid,
      title: title.replace(/<[^>]*>/g, '').trim(),
      url: link || null,
      summary: summary || null,
      published_at: publishedIso,
    });
  }
  return items;
}

/** Live fetcher for VATupdate. Times out after 8 s (Vercel serverless
 *  function budget allows 5 minutes but we want snappy failure). */
export async function fetchVatUpdate(): Promise<FeedItem[]> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(VATUPDATE_FEED, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'cifra-legal-watch/1.0 (+https://cifracompliance.com)' },
    });
    if (!res.ok) throw new Error(`VATupdate feed HTTP ${res.status}`);
    const xml = await res.text();
    return parseRss(xml);
  } finally {
    clearTimeout(timeout);
  }
}

/** Built-in sample fetcher. Used when the caller explicitly wants to
 *  seed the queue with known-relevant recent cases (demo mode, tests),
 *  or as a fallback if the network fetch fails and the caller passes
 *  `useFallback`. */
export function sampleFeedItems(): FeedItem[] {
  return [
    {
      source: 'sample',
      external_id: 'T-657/24',
      title: 'GC T-657/24 Versãofast — VAT exemption for credit intermediation widened (26 Nov 2025)',
      url: 'https://curia.europa.eu/juris/documents.jsf?num=T-657/24',
      summary:
        'General Court confirmed that Art. 135(1)(b) Directive 2006/112 exemption for credit intermediation applies to a broker who actively searches for and recruits customers for home-loan agreements. Pre-contractual + administrative tasks qualify. Binding power over the credit institution not required. Already integrated into cifra as RULE 36 — this entry documents the source-of-truth record.',
      published_at: '2025-11-26T00:00:00Z',
    },
    {
      source: 'sample',
      external_id: 'C-184/23',
      title: 'CJEU C-184/23 Finanzamt T II — intra-VAT-group supplies definitively out of scope (11 Jul 2024)',
      url: 'https://curia.europa.eu/juris/documents.jsf?num=C-184/23',
      summary:
        'CJEU confirmed that transactions between members of a VAT group are not within the scope of VAT, even if one of the participants is subject to input-VAT deduction restrictions. Integrated into RULE 20.',
      published_at: '2024-07-11T00:00:00Z',
    },
    {
      source: 'sample',
      external_id: 'C-288/22',
      title: 'CJEU C-288/22 TP — LU directors (natural persons) not taxable persons (21 Dec 2023)',
      url: 'https://curia.europa.eu/juris/documents.jsf?num=C-288/22',
      summary:
        'Natural-person independent directors of a Luxembourg SA are not taxable persons: fees are fixed regardless of company performance, decisions are taken collegially, no independent economic risk. Integrated into cifra as RULE 32a. AED Circ. 781-2 followed.',
      published_at: '2023-12-21T00:00:00Z',
    },
  ];
}

export interface ScanOptions {
  sources?: Array<'vatupdate' | 'sample'>;
  useFallback?: boolean;   // on live fetch failure, fall back to sample
  /** When true (default), genuinely-new items run through the Opus 4.7
   *  auto-triage agent and their severity / affected rules / summary
   *  are persisted on the row. When false, items are inserted raw and
   *  the reviewer triages manually (cheaper, useful for tests). */
  autoTriage?: boolean;
}

export async function runLegalWatchScan(opts: ScanOptions = {}): Promise<ScanReport[]> {
  const sources = opts.sources ?? ['vatupdate'];
  const reports: ScanReport[] = [];

  for (const source of sources) {
    const report: ScanReport = {
      source, fetched: 0, filtered: 0, inserted: 0, skipped_duplicate: 0, errors: [],
    };

    let items: FeedItem[] = [];
    try {
      if (source === 'vatupdate') items = await fetchVatUpdate();
      else if (source === 'sample') items = sampleFeedItems();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      report.errors.push(msg);
      if (opts.useFallback) {
        items = sampleFeedItems();
        report.source = `${source}(fallback=sample)`;
      } else {
        reports.push(report);
        continue;
      }
    }
    report.fetched = items.length;

    const filtered = items
      .map(item => ({
        item,
        hits: matchKeywords(`${item.title}\n${item.summary ?? ''}`),
      }))
      .filter(({ hits }) => hits.length > 0);
    report.filtered = filtered.length;

    const autoTriage = opts.autoTriage !== false; // default true

    for (const { item, hits } of filtered) {
      try {
        const before = await query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM legal_watch_queue WHERE source = $1 AND external_id = $2`,
          [item.source, item.external_id],
        );
        const existed = Number(before[0]?.count ?? 0) > 0;
        await execute(
          `INSERT INTO legal_watch_queue
             (source, external_id, title, url, summary, published_at, matched_keywords)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (source, external_id)
           WHERE external_id IS NOT NULL
           DO NOTHING`,
          [
            item.source,
            item.external_id,
            item.title,
            item.url ?? null,
            item.summary ?? null,
            item.published_at ?? null,
            hits,
          ],
        );
        if (existed) {
          report.skipped_duplicate += 1;
        } else {
          report.inserted += 1;

          // Genuinely-new item → auto-triage with Opus 4.7 so the
          // reviewer opens the queue card to "high · affects RULE 36"
          // instead of "untriaged, read it yourself". Non-fatal: if
          // triage fails (network, parse, budget), the item stays in
          // the queue with ai_triage_at=NULL and the reviewer triages
          // manually — same as before.
          if (autoTriage) {
            const triaged = await triageQueueItem({
              title: item.title,
              summary: item.summary,
              url: item.url,
              matched_keywords: hits,
              published_at: item.published_at,
            });
            if (triaged) {
              await execute(
                `UPDATE legal_watch_queue
                    SET ai_triage_severity = $1,
                        ai_triage_affected_rules = $2,
                        ai_triage_summary = $3,
                        ai_triage_proposed_action = $4,
                        ai_triage_confidence = $5,
                        ai_triage_model = $6,
                        ai_triage_at = NOW(),
                        updated_at = NOW()
                  WHERE source = $7 AND external_id = $8`,
                [
                  triaged.severity,
                  triaged.affected_rules,
                  triaged.summary,
                  triaged.proposed_action,
                  triaged.confidence,
                  triaged.model,
                  item.source,
                  item.external_id,
                ],
              );
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        report.errors.push(`insert "${item.title}": ${msg}`);
      }
    }

    reports.push(report);
  }

  return reports;
}
