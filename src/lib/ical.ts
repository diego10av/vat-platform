// ════════════════════════════════════════════════════════════════════════
// ical.ts — hand-rolled RFC 5545 (iCalendar) serializer (stint 42.C).
//
// No external dependency. Just enough to emit a VCALENDAR with VEVENTs
// for all-day deadlines. Lines are CRLF-terminated and folded at 75
// octets per spec so the feed parses in Google / Apple / Outlook.
// ════════════════════════════════════════════════════════════════════════

export interface ICalEvent {
  /** Stable unique identifier (e.g. "<filing_id>@cifracompliance.com"). */
  uid: string;
  /** Event date in YYYY-MM-DD (all-day). */
  date: string;
  /** Short headline shown in the calendar cell. */
  summary: string;
  /** Longer description (shows in the event detail). */
  description?: string;
  /** Deep link back to cifra. */
  url?: string;
  /** When this entry was last modified (ISO). Used for DTSTAMP +
   *  LAST-MODIFIED so clients know when to refresh. */
  updated?: string;
}

export interface ICalFeed {
  /** PRODID — e.g. "-//cifra//tax-ops deadlines//EN" */
  prodId: string;
  /** X-WR-CALNAME — visible name in the client's calendar picker */
  calendarName: string;
  /** X-WR-CALDESC — longer description */
  calendarDescription?: string;
  events: ICalEvent[];
}

/**
 * Build the iCal string. Output is CRLF-terminated and content lines
 * are folded at 75 octets per RFC 5545 §3.1.
 */
export function buildICal(feed: ICalFeed): string {
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push(`PRODID:${escapeText(feed.prodId)}`);
  lines.push('CALSCALE:GREGORIAN');
  lines.push('METHOD:PUBLISH');
  lines.push(`X-WR-CALNAME:${escapeText(feed.calendarName)}`);
  if (feed.calendarDescription) {
    lines.push(`X-WR-CALDESC:${escapeText(feed.calendarDescription)}`);
  }

  for (const ev of feed.events) {
    const stamp = toIcalTimestamp(ev.updated ?? new Date().toISOString());
    const startYMD = ev.date.replace(/-/g, '');
    const endYMD = nextDayYMD(ev.date);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(ev.uid)}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.updated) lines.push(`LAST-MODIFIED:${toIcalTimestamp(ev.updated)}`);
    lines.push(`DTSTART;VALUE=DATE:${startYMD}`);
    lines.push(`DTEND;VALUE=DATE:${endYMD}`);
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.url) lines.push(`URL:${escapeText(ev.url)}`);
    lines.push('TRANSP:TRANSPARENT');  // doesn't mark Diego as busy
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/** Escape ; , \ and newlines per RFC 5545 §3.3.11. */
function escapeText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** ISO8601 (with TZ) → iCal UTC DTSTAMP format: YYYYMMDDTHHMMSSZ. */
function toIcalTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** YYYY-MM-DD → next-day YYYYMMDD (all-day events are [start, end) in iCal). */
function nextDayYMD(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date.replace(/-/g, '');
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}`;
}

/** Fold a content line at 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  out.push(line.slice(i, i + 75));
  i += 75;
  while (i < line.length) {
    out.push(' ' + line.slice(i, i + 74));  // continuation line starts with SPACE
    i += 74;
  }
  return out.join('\r\n');
}
