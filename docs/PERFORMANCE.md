# Performance — audit + fix backlog

> Snapshot of DB query hotspots and rendering bottlenecks, with what's
> fixed and what's queued. Revisit after every 10× user growth or
> whenever Vercel function duration p95 climbs past 2s.
>
> Last audit: **2026-04-18**

---

## ✅ Fixed in this pass

### Indexes — `migrations/004_performance_indexes.sql`

14 indexes on hot-path WHERE columns. Zero code change; safe to re-run.
Expected impact: order-of-magnitude speedup on every page that touches
invoice_lines, declarations, invoices, audit_log, aed_letters,
api_calls. Apply in Supabase SQL Editor same as migrations 001-003.

### Audit filter dropdown caching

`GET /api/audit` used to run two full-table aggregations
(`SELECT DISTINCT action`, `GROUP BY action`) on every page load to
populate the filter dropdown. Now cached in-process with a 30-second
TTL so repeated loads share the scan. Tradeoff: admin sees a stale
filter list for up to 30s after a new `action` value appears in
audit_log. Acceptable for an ops dashboard.

---

## 🚧 Known-but-deferred (code changes required)

These need query rewrites, which carry more risk than an index add.
Queued for a follow-up with the synthetic-corpus tests + seed data
protecting against regression.

### 1. Precedents upsert N+1 — `src/lib/precedents.ts`

On approval, we loop over every classified line and issue one
`queryOne()` per line to check for an existing precedent, then insert
or update. For a 200-line declaration that's 400+ round-trips.

**Fix recipe:**
- Batch the lookup: `SELECT * FROM precedents WHERE (entity_id,
  provider, country) IN ((?, ?, ?), ...)` with one query.
- Group existing vs. missing in memory.
- Batch-insert missing with a single multi-row INSERT.
- Batch-update existing with `UPDATE ... FROM (VALUES ...) AS t(id, treatment)`.
- Audit rows can stay single-query per treatment-change (they're
  rare).

**Risk:** medium. The current logic does differential auditing only
when treatment changes. Batching has to preserve that semantics
exactly. Mitigation: 9 existing tests in `precedents.test.ts`.

### 2. Deadlines route N+1 — `src/app/api/deadlines/route.ts`

Per-entity loop fires one query each for the latest declaration.
With 50 entities → 50 queries.

**Fix recipe:** window function —
```sql
SELECT DISTINCT ON (entity_id) entity_id, year, period, status, ...
  FROM declarations
 ORDER BY entity_id, year DESC, period DESC;
```
Single query, preserves ordering.

**Risk:** low. Pure read, no writes involved.

### 3. Fill-FX route N+1 — `src/app/api/declarations/[id]/fill-fx/route.ts`

Nested loop over invoices → lines, with a separate SELECT per invoice
to fetch its lines, then an UPDATE per line.

**Fix recipe:**
- One SELECT up front joining invoices + lines for the whole declaration.
- Group in memory by invoice.
- Batch update with `UPDATE invoice_lines SET amount_eur = v.amount_eur
  FROM (VALUES (?,?), ...) AS v(id, amount_eur) WHERE invoice_lines.id = v.id`.

**Risk:** medium. Touches money fields + audit log. Needs tests.

### 4. Entity timeline correlated subqueries — `src/app/api/entities/[id]/timeline/route.ts`

`line_count`, `total_ex_vat`, `vat_payable` computed as three
correlated subqueries per declaration row. 10 declarations → 30
subqueries in one statement.

**Fix recipe:** LEFT JOIN a derived aggregation —
```sql
SELECT d.*, agg.line_count, agg.total_ex_vat, agg.vat_payable
  FROM declarations d
  LEFT JOIN (
    SELECT declaration_id,
           COUNT(*)::int AS line_count,
           SUM(amount_eur)::float AS total_ex_vat,
           SUM(vat_applied)::float AS vat_payable
      FROM invoice_lines
     WHERE state != 'deleted'
     GROUP BY declaration_id
  ) agg USING (id)
 WHERE d.entity_id = $1
 ORDER BY d.year DESC, d.period DESC;
```

**Risk:** low. Same numbers, one scan instead of many.

### 5. Top providers GROUP BY — `src/app/api/entities/[id]/timeline/route.ts`

Aggregates all invoice_lines across all declarations for an entity
without a time limit. Fine with current data volumes but unbounded
growth means eventual slowness.

**Fix recipe:** add a `LIMIT 12 months` filter (`WHERE d.updated_at
> NOW() - INTERVAL '12 months'`) and/or materialise a per-entity
top-providers view refreshed weekly.

**Risk:** low-medium — changes the meaning (all-time → last 12mo).
Might want a UI toggle.

### 6. Declarations list pagination — `src/app/declarations/page.tsx`

`GET /api/declarations` returns all declarations every call, client
renders them. Fine for the current <100 row scale. At 1000+
declarations the list page becomes a full-DB-scan ritual.

**Fix recipe:**
- Add `?limit=50&offset=0` to the API.
- Switch the client to infinite-scroll (intersection observer) or
  classic pagination.
- Add a WHERE-filter for status (already shipped as UI chips but
  applied client-side).

**Risk:** low. Standard pagination.

---

## 🧪 Benchmarks (to revisit)

Currently none. If we start chasing latency, add:
- A `scripts/bench.ts` that runs each of the top-10 queries 100× and
  reports p50/p95/p99 milliseconds.
- A CI step that fails if p95 regresses >20% vs. the previous
  baseline committed to `docs/perf-baseline.json`.

---

## Prioritisation heuristic

Fix hotspots when any of these trip:
1. Vercel function duration p95 > 2s on a user-facing endpoint.
2. A specific query shows up >3× in the top-10 slow queries on the
   Supabase dashboard.
3. A customer reports "X page is slow" with reproducible steps.
4. We passed the 10,000-line or 100-entity mark.

Until then: indexes are enough.
