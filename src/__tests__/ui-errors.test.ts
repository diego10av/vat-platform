import { describe, it, expect } from 'vitest';
import { describeApiError, formatUiError, humaniseError } from '@/lib/ui-errors';

function makeJsonResponse(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('describeApiError', () => {
  it('reads the { error: { code, message, hint } } envelope', async () => {
    const res = makeJsonResponse({
      error: { code: 'not_found', message: 'Entity missing', hint: 'Create one first.' },
    }, 404);
    const ui = await describeApiError(res);
    expect(ui.code).toBe('not_found');
    expect(ui.message).toBe('Entity missing');
    expect(ui.hint).toBe('Create one first.');
  });

  it('supports a string-shaped error field', async () => {
    const res = makeJsonResponse({ error: 'just a plain string' }, 400);
    const ui = await describeApiError(res);
    expect(ui.message).toBe('just a plain string');
    expect(ui.code).toBe('http_400');
  });

  it('falls back to http_{status} when no code is provided', async () => {
    const res = makeJsonResponse({ error: { message: 'Boom' } }, 500);
    const ui = await describeApiError(res);
    expect(ui.code).toBe('http_500');
    expect(ui.message).toBe('Boom');
  });

  it('uses the fallback string when body is not JSON', async () => {
    const res = new Response('<!doctype html><html>…</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    });
    const ui = await describeApiError(res, 'Network flapped');
    expect(ui.code).toBe('http_502');
    expect(ui.message).toBe('Network flapped');
  });

  it('tolerates a response with no error property at all', async () => {
    const res = makeJsonResponse({ data: 'something' }, 200);
    const ui = await describeApiError(res, 'Unknown');
    expect(ui.message).toBe('Unknown');
  });
});

describe('describeApiError (shape B: { error: code, message: text })', () => {
  it('treats body.error as code and body.message as the human text', async () => {
    const res = makeJsonResponse({
      error: 'declaration_locked',
      message: 'This declaration is filed — reopen it first.',
    }, 409);
    const ui = await describeApiError(res);
    expect(ui.code).toBe('declaration_locked');
    expect(ui.message).toBe('This declaration is filed — reopen it first.');
  });
});

describe('humaniseError', () => {
  it('translates known codes to reviewer-friendly messages', () => {
    const h = humaniseError({ code: 'has_entities', message: 'raw server text' });
    expect(h.message).not.toBe('raw server text');
    expect(h.message.toLowerCase()).toContain('entit');
    expect(h.hint).toBeDefined();
  });

  it('leaves unknown codes untouched', () => {
    const h = humaniseError({ code: 'totally_made_up', message: 'Original text' });
    expect(h.message).toBe('Original text');
  });

  it('preserves the server hint when the map has none', () => {
    const h = humaniseError({ code: 'totally_made_up', message: 'Boom', hint: 'Try again.' });
    expect(h.hint).toBe('Try again.');
  });
});

describe('formatUiError', () => {
  it('joins message + hint with a space when hint present', () => {
    expect(formatUiError({ code: 'unknown_code_xyz', message: 'Boom.', hint: 'Retry please.' }))
      .toBe('Boom. Retry please.');
  });

  it('returns message only when hint is absent', () => {
    expect(formatUiError({ code: 'unknown_code_xyz', message: 'Boom.' })).toBe('Boom.');
  });

  it('handles empty hint gracefully', () => {
    expect(formatUiError({ code: 'unknown_code_xyz', message: 'Boom.', hint: '' })).toBe('Boom.');
  });

  it('automatically humanises known codes', () => {
    const text = formatUiError({ code: 'declaration_locked', message: 'raw' });
    expect(text.toLowerCase()).toContain('approved');
    // The hint from the ERROR_MAP should also be appended.
    expect(text.toLowerCase()).toContain('reopen');
  });
});
