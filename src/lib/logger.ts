// ════════════════════════════════════════════════════════════════════════
// Structured logger.
//
// What it does:
// - JSON line logging to stdout/stderr (single line per event, easy to
//   grep in Vercel's log drawer, pipe to any log aggregator later).
// - Four levels: debug · info · warn · error. `debug` is silent unless
//   LOG_LEVEL=debug.
// - Bound loggers: `const log = logger.bind('agents/extract')` tags
//   every message with the module name. Clean call-sites: `log.info('…')`.
// - Structured fields: `log.info('extraction done', { doc_id, lines, ms })`
//   — fields are preserved as a JSON object in the output, not stringified
//   into the message.
// - Pretty output in development (human-readable columns); machine output
//   in production (one JSON object per line).
//
// What it does NOT do (yet, by design):
// - Persist logs to a database. An `app_logs` table in Supabase is a
//   future plug-in hook; today we rely on Vercel's log retention. Adding
//   a write here is cheap but defers the decision to when Diego picks
//   Sentry / Logtail / Datadog.
// - Capture request-scoped context (tenant_id, user_id, trace_id) — that
//   requires AsyncLocalStorage, deferred until multi-tenant.
// - Log sampling or rate-limiting — add it if we flood logs; not a
//   problem today.
//
// Why not just console.log?
// - Unstructured: can't filter by level or module; every grep is a
//   regex crime scene.
// - Different formats per method (log vs warn vs error) makes pipes
//   brittle. Structured output normalises.
// - Naive stringification of Error objects loses the stack. The logger
//   unwraps err_message + err_stack properly.
// ════════════════════════════════════════════════════════════════════════

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_MIN_LEVEL: Level = 'info';

function currentMinLevel(): Level {
  const raw = (process.env.LOG_LEVEL || '').toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  return DEFAULT_MIN_LEVEL;
}

function shouldLog(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentMinLevel()];
}

function isDev(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export interface LogRecord {
  level: Level;
  ts: string;
  module?: string;
  msg: string;
  [key: string]: unknown;
}

// ──────────────────────────── serialisation ────────────────────────────

function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      err_name: err.name,
      err_message: err.message,
      err_stack: err.stack?.split('\n').slice(0, 8).join('\n'),
    };
  }
  if (typeof err === 'object' && err !== null) {
    return { err: err as Record<string, unknown> };
  }
  return { err: String(err) };
}

// ─────────────────────────── test-capture hook ──────────────────────────

// When a test sets this, every emitted record is pushed here instead of
// (or in addition to) stdout. Use `__captureLogsForTests()` in tests.
let testCapture: LogRecord[] | null = null;

export function __captureLogsForTests(): { records: LogRecord[]; restore: () => void } {
  const records: LogRecord[] = [];
  testCapture = records;
  return {
    records,
    restore: () => {
      testCapture = null;
    },
  };
}

// ──────────────────────────────── emit ──────────────────────────────────

function emit(record: LogRecord): void {
  if (!shouldLog(record.level)) return;

  if (testCapture) {
    testCapture.push(record);
    return;
  }

  const stream = record.level === 'error' || record.level === 'warn'
    ? (msg: string) => console.error(msg)
    : (msg: string) => console.log(msg);

  if (isDev()) {
    const { level, ts, module: mod, msg, ...rest } = record;
    const header = `[${ts}] ${level.toUpperCase().padEnd(5)} ${mod ?? '-'} — ${msg}`;
    const tail = Object.keys(rest).length > 0 ? ' ' + JSON.stringify(rest) : '';
    stream(header + tail);
  } else {
    stream(JSON.stringify(record));
  }
}

function log(level: Level, module: string | undefined, msg: string, fields?: Record<string, unknown>): void {
  const record: LogRecord = {
    level,
    ts: new Date().toISOString(),
    ...(module ? { module } : {}),
    msg,
    ...(fields || {}),
  };
  emit(record);
}

// ──────────────────────────────── API ───────────────────────────────────

export interface BoundLogger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, err?: unknown, fields?: Record<string, unknown>): void;
  /** Start a timer; returns a function that logs `msg` with elapsed_ms. */
  time(msg: string): (fields?: Record<string, unknown>) => void;
}

function makeBound(module: string | undefined): BoundLogger {
  return {
    debug(msg, fields) { log('debug', module, msg, fields); },
    info(msg, fields)  { log('info',  module, msg, fields); },
    warn(msg, fields)  { log('warn',  module, msg, fields); },
    error(msg, err, fields) {
      const payload = {
        ...(err !== undefined ? serialiseError(err) : {}),
        ...(fields || {}),
      };
      log('error', module, msg, payload);
    },
    time(msg) {
      const start = Date.now();
      return (fields?: Record<string, unknown>) => {
        const elapsed_ms = Date.now() - start;
        log('info', module, msg, { elapsed_ms, ...(fields || {}) });
      };
    },
  };
}

export const logger = {
  /** Return a logger bound to a module name. One per file, declared at top. */
  bind(module: string): BoundLogger {
    return makeBound(module);
  },
  // Module-less shortcuts for scripts / tests:
  debug(msg: string, fields?: Record<string, unknown>): void { log('debug', undefined, msg, fields); },
  info(msg: string, fields?: Record<string, unknown>): void  { log('info',  undefined, msg, fields); },
  warn(msg: string, fields?: Record<string, unknown>): void  { log('warn',  undefined, msg, fields); },
  error(msg: string, err?: unknown, fields?: Record<string, unknown>): void {
    const payload = {
      ...(err !== undefined ? serialiseError(err) : {}),
      ...(fields || {}),
    };
    log('error', undefined, msg, payload);
  },
};
