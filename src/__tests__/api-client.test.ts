import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiRequest, apiGet, apiPost } from '@/lib/api-client';

const origFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
  // Force "online" by default so the offline short-circuit doesn't trip.
  Object.defineProperty(globalThis.navigator, 'onLine', {
    value: true, writable: true, configurable: true,
  });
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('apiRequest — success paths', () => {
  it('returns data + ok=true on 200', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ hello: 'world' }),
    );
    const r = await apiRequest<{ hello: string }>('/api/x');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.hello).toBe('world');
  });

  it('parses non-JSON body as text when content-type is not json', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('plain text payload', { status: 200, headers: { 'content-type': 'text/plain' } }),
    );
    const r = await apiRequest<string>('/api/x');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBe('plain text payload');
  });

  it('sets JSON Content-Type and stringifies body on POST', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse({ ok: true }));
    await apiPost('/api/x', { a: 1 });
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ a: 1 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('apiGet issues a GET with no body', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(jsonResponse([]));
    await apiGet('/api/x');
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('GET');
    expect(init.body).toBe(undefined);
  });
});

describe('apiRequest — error paths', () => {
  it('parses a 400 error envelope', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: { code: 'bad_id', message: 'id required', hint: 'provide it' } }, { status: 400 }),
    );
    const r = await apiRequest('/api/x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error.code).toBe('bad_id');
      expect(r.error.message).toBe('id required');
      expect(r.error.hint).toBe('provide it');
      expect(r.transient).toBe(false); // 400s are not retryable
    }
  });

  it('does NOT retry on 4xx', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse({ error: { code: 'x' } }, { status: 400 }),
    );
    await apiRequest('/api/x', { maxRetries: 3, backoffMs: 10 });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 and eventually succeeds', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(new Response('down', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const r = await apiRequest('/api/x', { maxRetries: 2, backoffMs: 1 });
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxRetries', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response('', { status: 502 }));
    const r = await apiRequest('/api/x', { maxRetries: 2, backoffMs: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.transient).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does NOT retry on 501 schema_missing (our own "non-retryable 5xx")', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: 'schema_missing' } }, { status: 501 }),
    );
    await apiRequest('/api/x', { maxRetries: 3, backoffMs: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('short-circuits when navigator is offline', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: false, writable: true, configurable: true,
    });
    const r = await apiRequest('/api/x');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('offline');
      expect(r.status).toBe(0);
      expect(r.transient).toBe(true);
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('wraps network errors', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new TypeError('Failed to fetch'),
    );
    const r = await apiRequest('/api/x', { maxRetries: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('network_error');
      expect(r.status).toBe(0);
      expect(r.transient).toBe(true);
    }
  });

  it('honours Retry-After header on 429', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce(new Response('rate limited', {
        status: 429,
        headers: { 'Retry-After': '1' }, // 1 second
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const start = Date.now();
    const r = await apiRequest('/api/x', { maxRetries: 1, backoffMs: 50 });
    const elapsed = Date.now() - start;

    expect(r.ok).toBe(true);
    // Retry-After = 1s should win over backoff of 50ms.
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  it('parses a non-envelope plain-text error body', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response('<html>gateway timeout</html>', { status: 504, headers: { 'content-type': 'text/html' } }),
    );
    const r = await apiRequest('/api/x', { maxRetries: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(504);
      // Short HTML blobs get surfaced as the message
      expect(r.error.message.length).toBeLessThan(300);
    }
  });
});
