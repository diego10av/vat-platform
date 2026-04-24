// Unit tests for src/lib/ical.ts (stint 42.C).

import { describe, it, expect } from 'vitest';
import { buildICal } from '@/lib/ical';

describe('buildICal', () => {
  it('emits a valid-looking VCALENDAR with the required headers', () => {
    const out = buildICal({
      prodId: '-//cifra//test//EN',
      calendarName: 'Test feed',
      events: [],
    });
    expect(out).toMatch(/^BEGIN:VCALENDAR\r\n/);
    expect(out).toMatch(/END:VCALENDAR\r\n$/);
    expect(out).toContain('VERSION:2.0');
    expect(out).toContain('PRODID:-//cifra//test//EN');
    expect(out).toContain('CALSCALE:GREGORIAN');
    expect(out).toContain('X-WR-CALNAME:Test feed');
  });

  it('emits one VEVENT per event with a stable UID and all-day DTSTART/DTEND', () => {
    const out = buildICal({
      prodId: '-//cifra//test//EN',
      calendarName: 'Test',
      events: [{
        uid: 'filing-42@cifracompliance.com',
        date: '2026-10-30',
        summary: 'CIT 2025 — Acme SARL',
        updated: '2026-04-24T10:15:00Z',
      }],
    });
    const eventCount = (out.match(/BEGIN:VEVENT/g) ?? []).length;
    expect(eventCount).toBe(1);
    expect(out).toContain('UID:filing-42@cifracompliance.com');
    expect(out).toContain('DTSTART;VALUE=DATE:20261030');
    expect(out).toContain('DTEND;VALUE=DATE:20261031');
    expect(out).toContain('SUMMARY:CIT 2025 — Acme SARL');
    expect(out).toContain('LAST-MODIFIED:20260424T101500Z');
    expect(out).toContain('TRANSP:TRANSPARENT');
  });

  it('escapes RFC 5545 special characters (; , \\) in SUMMARY + DESCRIPTION', () => {
    const out = buildICal({
      prodId: '-//cifra//test//EN',
      calendarName: 'Test',
      events: [{
        uid: 'x',
        date: '2026-01-01',
        summary: 'Acme, Inc.; a\\b',
        description: 'line 1\nline 2',
      }],
    });
    expect(out).toContain('SUMMARY:Acme\\, Inc.\\; a\\\\b');
    expect(out).toContain('DESCRIPTION:line 1\\nline 2');
  });

  it('folds content lines longer than 75 octets at CRLF+SPACE', () => {
    const longSummary = 'x'.repeat(200);
    const out = buildICal({
      prodId: '-//cifra//test//EN',
      calendarName: 'Test',
      events: [{ uid: 'u', date: '2026-01-01', summary: longSummary }],
    });
    // Summary line prefix is "SUMMARY:" (8 chars) + 200 'x' = 208 chars.
    // Must be folded into chunks of 75 (first) + 74 (subsequent) with
    // CRLF + SPACE as the continuation marker.
    expect(out).toMatch(/SUMMARY:x{67}\r\n x{74}/);
  });

  it('handles events with no description / url / updated gracefully', () => {
    const out = buildICal({
      prodId: '-//cifra//test//EN',
      calendarName: 'Test',
      events: [{ uid: 'u', date: '2026-01-01', summary: 'Bare event' }],
    });
    expect(out).toContain('SUMMARY:Bare event');
    expect(out).not.toContain('DESCRIPTION:');
    expect(out).not.toContain('URL:');
    expect(out).toContain('DTSTAMP:');   // falls back to "now" via new Date()
  });
});
