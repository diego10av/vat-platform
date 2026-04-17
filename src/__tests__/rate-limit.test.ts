import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, __resetRateLimitForTests } from '@/lib/rate-limit';

describe('rateLimit (token bucket)', () => {
  beforeEach(() => {
    __resetRateLimitForTests();
  });

  it('allows up to `max` requests then denies', () => {
    const opts = { max: 3, windowMs: 60_000 };
    const r1 = rateLimit('user:a', opts);
    const r2 = rateLimit('user:a', opts);
    const r3 = rateLimit('user:a', opts);
    const r4 = rateLimit('user:a', opts);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r4.ok).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('keeps buckets independent per key', () => {
    const opts = { max: 2, windowMs: 60_000 };
    rateLimit('user:a', opts);
    rateLimit('user:a', opts);
    const blockedA = rateLimit('user:a', opts);
    const freshB = rateLimit('user:b', opts);

    expect(blockedA.ok).toBe(false);
    expect(freshB.ok).toBe(true);
  });

  it('reports remaining tokens correctly', () => {
    const opts = { max: 5, windowMs: 60_000 };
    const r1 = rateLimit('user:x', opts);
    const r2 = rateLimit('user:x', opts);
    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
  });

  it('reports the correct limit regardless of state', () => {
    const opts = { max: 7, windowMs: 30_000 };
    const r = rateLimit('user:y', opts);
    expect(r.limit).toBe(7);
  });

  it('resetAtMs is in the future when bucket is full', () => {
    const opts = { max: 2, windowMs: 60_000 };
    const r = rateLimit('user:z', opts);
    expect(r.resetAtMs).toBeGreaterThan(Date.now());
  });

  it('refills tokens after the window elapses', async () => {
    const opts = { max: 2, windowMs: 100 }; // 100ms window for fast test
    rateLimit('user:refill', opts);
    rateLimit('user:refill', opts);
    const blocked = rateLimit('user:refill', opts);
    expect(blocked.ok).toBe(false);

    // Wait just past one refill period (windowMs / max = 50ms per token).
    await new Promise((resolve) => setTimeout(resolve, 120));

    const after = rateLimit('user:refill', opts);
    expect(after.ok).toBe(true);
  });

  it('retryAfterSeconds decreases as window elapses', async () => {
    const opts = { max: 1, windowMs: 1_000 };
    rateLimit('user:retry', opts);
    const first = rateLimit('user:retry', opts);
    expect(first.ok).toBe(false);
    const firstRetry = first.retryAfterSeconds;

    // After some time has passed, retry should be shorter or equal
    await new Promise((resolve) => setTimeout(resolve, 200));
    const second = rateLimit('user:retry', opts);
    expect(second.ok).toBe(false);
    expect(second.retryAfterSeconds).toBeLessThanOrEqual(firstRetry);
  });

  it('default limit is 20/min when options are omitted', () => {
    for (let i = 0; i < 20; i++) {
      const r = rateLimit('user:default');
      expect(r.ok).toBe(true);
    }
    const blocked = rateLimit('user:default');
    expect(blocked.ok).toBe(false);
  });
});
