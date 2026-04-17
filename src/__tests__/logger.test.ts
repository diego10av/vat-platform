import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { logger, __captureLogsForTests, type LogRecord } from '@/lib/logger';

describe('structured logger', () => {
  let capture: { records: LogRecord[]; restore: () => void };

  beforeEach(() => {
    capture = __captureLogsForTests();
  });

  afterEach(() => {
    capture.restore();
  });

  it('emits info with level + timestamp + message', () => {
    logger.info('hello world');
    expect(capture.records).toHaveLength(1);
    const r = capture.records[0]!;
    expect(r.level).toBe('info');
    expect(r.msg).toBe('hello world');
    expect(new Date(r.ts).toString()).not.toBe('Invalid Date');
  });

  it('bound logger tags every record with the module name', () => {
    const log = logger.bind('agents/extract');
    log.info('batch started');
    log.warn('slow doc');
    expect(capture.records[0]!.module).toBe('agents/extract');
    expect(capture.records[1]!.module).toBe('agents/extract');
  });

  it('merges structured fields without stringifying them', () => {
    logger.info('lines ready', { count: 7, declaration_id: 'd1' });
    const r = capture.records[0]!;
    expect(r.count).toBe(7);
    expect(r.declaration_id).toBe('d1');
    expect(r.msg).toBe('lines ready'); // message unchanged
  });

  it('error() serialises Error objects with name/message/stack', () => {
    const err = new Error('boom');
    logger.error('something failed', err);
    const r = capture.records[0]!;
    expect(r.level).toBe('error');
    expect(r.err_name).toBe('Error');
    expect(r.err_message).toBe('boom');
    expect(typeof r.err_stack).toBe('string');
  });

  it('error() handles non-Error values without crashing', () => {
    logger.error('weird', 'just a string');
    logger.error('weirder', { code: 42 });
    logger.error('null too', null);
    expect(capture.records).toHaveLength(3);
    expect(capture.records[0]!.err).toBe('just a string');
    expect(capture.records[1]!.err).toEqual({ code: 42 });
    // null gets stringified by serialiseError's String() fallback
    expect(capture.records[2]!.err).toBe('null');
  });

  it('time() measures elapsed_ms and logs at info level', async () => {
    const log = logger.bind('mod');
    const done = log.time('slow thing');
    await new Promise((resolve) => setTimeout(resolve, 20));
    done({ extra: 'x' });

    const r = capture.records[0]!;
    expect(r.level).toBe('info');
    expect(r.msg).toBe('slow thing');
    expect(typeof r.elapsed_ms).toBe('number');
    expect(r.elapsed_ms as number).toBeGreaterThanOrEqual(15);
    expect(r.extra).toBe('x');
  });

  it('debug() is suppressed by default', () => {
    logger.debug('this should not appear');
    expect(capture.records).toHaveLength(0);
  });
});
