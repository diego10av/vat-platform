// Server-side ECB exchange rate fetcher (PRD P1, FX automation).
//
// Source: ECB Statistical Data Warehouse — Daily reference rates published at
// 16:00 CET. We use the SDMX 2.1 endpoint, which returns the published rate
// for a given currency on a given date if the ECB published one that day.
// Currencies are quoted PER 1 EUR (e.g. EUR/USD = 1.0900 means 1 EUR = 1.09 USD).
//
// To convert a foreign-currency invoice amount to EUR:
//   amount_eur = currency_amount / rate
//
// In-memory cache keyed by (currency, date) avoids hammering the ECB during
// batch operations. Cache is per-server-instance and ephemeral.

import { logger } from '@/lib/logger';

const log = logger.bind('ecb');

// Cache only SUCCESSFUL fetches. Previously we also cached nulls from
// failed / no-rate-available responses, which meant that a transient ECB
// outage poisoned the cache for the life of the server instance — the
// fill-fx endpoint would then silently skip every line for that currency
// even after the ECB came back online. Null is now treated as "not
// known; retry on next call".
const cache = new Map<string, number>();

const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data/EXR';

export async function fetchECBRate(currency: string, isoDate: string): Promise<number | null> {
  const cur = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(cur)) return null;
  if (cur === 'EUR') return 1;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;

  const key = `${cur}::${isoDate}`;
  const cached = cache.get(key);
  if (cached != null) return cached;

  // ECB publishes only for business days. If the requested date isn't published
  // we widen the window backwards by 7 days and pick the latest available.
  const start = shiftDate(isoDate, -7);
  const url = `${ECB_BASE}/D.${cur}.EUR.SP00.A?startPeriod=${start}&endPeriod=${isoDate}&format=jsondata`;

  let rate: number | null = null;
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      rate = extractLatestRate(data);
    }
  } catch (e) {
    log.error('ECB fetch failed', e, { currency: cur, iso_date: isoDate });
  }

  if (rate != null && rate > 0) cache.set(key, rate);
  return rate;
}

// SDMX-JSON shape: { dataSets: [{ series: { '0:0:0:0:0': { observations: { '0': [1.087], '1': [1.089], … } } } }] }
// Pick the highest-indexed observation (= most recent date in the requested window).
function extractLatestRate(payload: unknown): number | null {
  try {
    const ds = (payload as { dataSets?: Array<{ series?: Record<string, { observations?: Record<string, [number]> }> }> }).dataSets?.[0];
    if (!ds?.series) return null;
    const series = Object.values(ds.series)[0];
    if (!series?.observations) return null;
    const keys = Object.keys(series.observations).map(Number).filter(n => !isNaN(n)).sort((a, b) => a - b);
    for (let i = keys.length - 1; i >= 0; i--) {
      const obs = series.observations[String(keys[i])];
      if (obs && typeof obs[0] === 'number' && isFinite(obs[0])) return obs[0];
    }
    return null;
  } catch {
    return null;
  }
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
