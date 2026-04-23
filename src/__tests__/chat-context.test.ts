import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  queryOne: vi.fn(),
  query: vi.fn(),
}));

import { queryOne, query } from '@/lib/db';
import { buildSystemPrompt } from '@/lib/chat-context';

const mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
const mockQuery = query as unknown as ReturnType<typeof vi.fn>;

describe('buildSystemPrompt', () => {
  beforeEach(() => {
    mockQueryOne.mockReset();
    mockQuery.mockReset();
  });

  it('includes the cifra role and guardrails', async () => {
    const prompt = await buildSystemPrompt({});
    expect(prompt).toContain("cifra's in-product assistant");
    expect(prompt).toMatch(/Luxembourg/i);
    expect(prompt).toMatch(/cite/i);
  });

  it('includes the compact legal index with at least LTVA', async () => {
    const prompt = await buildSystemPrompt({});
    expect(prompt).toContain('Luxembourg law');
    expect(prompt).toContain('LTVA');
  });

  it('embeds entity snapshot when entity_id is provided', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'ent-1',
      name: 'TestCo SARL',
      vat_number: 'LU12345678',
      regime: 'quarterly',
      country: 'LU',
      activity: 'Holding',
      vat_status: 'registered',
    });

    const prompt = await buildSystemPrompt({ entity_id: 'ent-1' });
    expect(prompt).toContain('TestCo SARL');
    expect(prompt).toContain('LU12345678');
    expect(prompt).toContain('Holding');
  });

  it('embeds declaration snapshot when declaration_id is provided', async () => {
    mockQueryOne.mockResolvedValueOnce({
      id: 'd-1',
      year: 2026,
      period: 'Q1',
      status: 'review',
      matricule: '20232456346',
      total_vat_due: 1234.56,
    });
    mockQuery.mockResolvedValueOnce([{ count: '15' }]);

    const prompt = await buildSystemPrompt({ declaration_id: 'd-1' });
    expect(prompt).toContain('2026 Q1');
    expect(prompt).toContain('review');
    expect(prompt).toContain('line count: 15');
    expect(prompt).toContain('€1234.56');
  });

  it('states no context when nothing in focus', async () => {
    const prompt = await buildSystemPrompt({});
    expect(prompt).toMatch(/no specific entity[,\s]/i);
  });

  it('tolerates a missing entity row without crashing', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    const prompt = await buildSystemPrompt({ entity_id: 'does-not-exist' });
    // Falls back to the no-context message
    expect(prompt).toMatch(/no specific entity[,\s]/i);
  });

  it('tolerates a DB error while loading entity', async () => {
    mockQueryOne.mockRejectedValueOnce(new Error('DB unavailable'));
    const prompt = await buildSystemPrompt({ entity_id: 'x' });
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });
});
