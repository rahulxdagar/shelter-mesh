// Tiger Data (TimescaleDB) holds time-series history: city and per-shelter bed availability,
// weather, and overdose response times. MongoDB stays the live operational store.
// Everything here fails soft: if Tiger Data is unreachable, the live system is unaffected.
import pg from 'pg';
import { config } from '../config.ts';
import { computeSnapshot, type Snapshot } from './capacity.ts';
import { currentWeather, effectiveTemperature, type EffectiveWeather } from './weather.ts';
import { SEED } from '../seed.ts';

let pool: pg.Pool | null = null;
let migrated = false;
let lastError: string | null = null;
let sampler: NodeJS.Timeout | null = null;

export function historyStatus() {
  return { enabled: pool !== null, ready: migrated, lastError };
}

const MIGRATION = [
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,

  // One row per sample tick for the whole city, including the weather at that moment.
  `CREATE TABLE IF NOT EXISTS city_samples (
     time timestamptz NOT NULL,
     capacity integer NOT NULL,
     available integer NOT NULL,
     available_pct double precision NOT NULL,
     overflow_available integer NOT NULL,
     temp_c double precision,
     wind_kmh double precision,
     effective_temp_c double precision,
     weather_overridden boolean NOT NULL DEFAULT false,
     source text NOT NULL DEFAULT 'live'
   )`,
  `SELECT create_hypertable('city_samples', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE)`,

  `CREATE TABLE IF NOT EXISTS shelter_samples (
     time timestamptz NOT NULL,
     shelter_id text NOT NULL,
     kind text NOT NULL,
     capacity integer NOT NULL,
     occupied integer NOT NULL,
     held integer NOT NULL,
     available integer NOT NULL,
     source text NOT NULL DEFAULT 'live'
   )`,
  `SELECT create_hypertable('shelter_samples', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE)`,
  `CREATE INDEX IF NOT EXISTS shelter_samples_shelter_time ON shelter_samples (shelter_id, time DESC)`,

  // One row per overdose event (alert, claimed, resolved).
  `CREATE TABLE IF NOT EXISTS incident_events (
     time timestamptz NOT NULL,
     incident_id text NOT NULL,
     event text NOT NULL,
     source text,
     alerted_count integer,
     dispatch_ms double precision,
     seconds_to_claim double precision
   )`,
  `SELECT create_hypertable('incident_events', by_range('time', INTERVAL '7 days'), if_not_exists => TRUE)`,

  // Continuous aggregates: pre-computed rollups that stay current (materialized_only = false
  // adds the newest raw rows at query time).
  `CREATE MATERIALIZED VIEW IF NOT EXISTS city_15m
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
     SELECT time_bucket('15 minutes', time) AS bucket,
            avg(available_pct) AS avg_pct,
            min(available_pct) AS min_pct,
            avg(effective_temp_c) AS avg_temp,
            min(effective_temp_c) AS min_temp,
            bool_or(source = 'simulated') AS simulated,
            bool_or(weather_overridden) AS overridden
     FROM city_samples GROUP BY bucket WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('city_15m', start_offset => INTERVAL '30 days',
     end_offset => INTERVAL '15 minutes', schedule_interval => INTERVAL '5 minutes', if_not_exists => TRUE)`,

  `CREATE MATERIALIZED VIEW IF NOT EXISTS shelter_1h
     WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
     SELECT time_bucket('1 hour', time) AS bucket, shelter_id,
            avg(available) AS avg_available,
            min(available) AS min_available,
            sum(CASE WHEN available = 0 THEN 1 ELSE 0 END) AS full_samples,
            count(*) AS samples,
            bool_or(source = 'simulated') AS simulated
     FROM shelter_samples GROUP BY bucket, shelter_id WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('shelter_1h', start_offset => INTERVAL '30 days',
     end_offset => INTERVAL '1 hour', schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE)`,

  // Raw samples are kept 90 days; incidents 1 year.
  `SELECT add_retention_policy('city_samples', INTERVAL '90 days', if_not_exists => TRUE)`,
  `SELECT add_retention_policy('shelter_samples', INTERVAL '90 days', if_not_exists => TRUE)`,
  `SELECT add_retention_policy('incident_events', INTERVAL '365 days', if_not_exists => TRUE)`,
];

async function migrate(): Promise<void> {
  if (!pool || migrated) return;
  for (const sql of MIGRATION) await pool.query(sql);
  migrated = true;
  lastError = null;
}

function fail(err: unknown) {
  lastError = (err as Error).message ?? String(err);
  console.error('[history]', lastError);
}

export async function startHistory(url = config.tigerDatabaseUrl, sampleMs = config.historySampleMs): Promise<void> {
  if (!url) return;
  pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 });
  pool.on('error', fail); // idle client errors must not crash the process
  await migrate().catch(fail);
  if (sampleMs > 0) {
    sampler = setInterval(() => void sampleNow(), sampleMs);
    sampler.unref();
    void sampleNow();
  }
}

export async function stopHistory(): Promise<void> {
  if (sampler) clearInterval(sampler);
  sampler = null;
  await pool?.end();
  pool = null;
  migrated = false;
}

async function ready(): Promise<pg.Pool | null> {
  if (!pool) return null;
  if (!migrated) await migrate().catch(fail);
  return migrated ? pool : null;
}

// ---- Writes ---------------------------------------------------------------------------------------

type CityRow = {
  at: Date; capacity: number; available: number; availablePct: number; overflowAvailable: number;
  tempC: number | null; windKmh: number | null; effectiveTempC: number | null; overridden: boolean; source: string;
};
type ShelterRow = {
  at: Date; shelterId: string; kind: string; capacity: number; occupied: number; held: number; available: number; source: string;
};

// Batched inserts via unnest(): one round trip per table regardless of row count.
async function insertRows(db: pg.Pool, city: CityRow[], shelters: ShelterRow[]): Promise<void> {
  if (city.length) {
    const col = <K extends keyof CityRow>(k: K) => city.map((r) => r[k]);
    await db.query(
      `INSERT INTO city_samples (time, capacity, available, available_pct, overflow_available,
         temp_c, wind_kmh, effective_temp_c, weather_overridden, source)
       SELECT * FROM unnest($1::timestamptz[], $2::int[], $3::int[], $4::float8[], $5::int[],
         $6::float8[], $7::float8[], $8::float8[], $9::bool[], $10::text[])`,
      [col('at'), col('capacity'), col('available'), col('availablePct'), col('overflowAvailable'),
       col('tempC'), col('windKmh'), col('effectiveTempC'), col('overridden'), col('source')],
    );
  }
  if (shelters.length) {
    const col = <K extends keyof ShelterRow>(k: K) => shelters.map((r) => r[k]);
    await db.query(
      `INSERT INTO shelter_samples (time, shelter_id, kind, capacity, occupied, held, available, source)
       SELECT * FROM unnest($1::timestamptz[], $2::text[], $3::text[], $4::int[], $5::int[], $6::int[],
         $7::int[], $8::text[])`,
      [col('at'), col('shelterId'), col('kind'), col('capacity'), col('occupied'), col('held'),
       col('available'), col('source')],
    );
  }
}

function rowsFor(snap: Snapshot, weather: EffectiveWeather, at: Date, source: string): [CityRow, ShelterRow[]] {
  const w = weather.reading;
  const t = snap.totals;
  return [
    {
      at, capacity: t.capacity, available: t.available, availablePct: t.availablePct, overflowAvailable: t.overflowAvailable,
      tempC: w?.tempC ?? null, windKmh: w?.windKmh ?? null, effectiveTempC: w?.effectiveTempC ?? null,
      overridden: weather.overridden, source,
    },
    snap.shelters.map((s) => ({
      at, shelterId: s.id, kind: s.kind, capacity: s.capacity, occupied: s.occupied, held: s.held, available: s.available, source,
    })),
  ];
}

export async function writeSample(snap: Snapshot, weather: EffectiveWeather, at = new Date()): Promise<void> {
  const db = await ready();
  if (!db) return;
  const [city, shelters] = rowsFor(snap, weather, at, 'live');
  await insertRows(db, [city], shelters);
}

export async function sampleNow(): Promise<void> {
  try {
    const [snap, weather] = await Promise.all([computeSnapshot(), currentWeather()]);
    await writeSample(snap, weather);
  } catch (err) {
    fail(err);
  }
}

export function recordIncidentEvent(e: {
  at: Date;
  incidentId: string;
  event: 'alert' | 'claimed' | 'resolved';
  source?: string;
  alertedCount?: number;
  dispatchMs?: number | null;
  secondsToClaim?: number;
}): void {
  void (async () => {
    const db = await ready();
    if (!db) return;
    await db.query(
      `INSERT INTO incident_events (time, incident_id, event, source, alerted_count, dispatch_ms, seconds_to_claim)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [e.at, e.incidentId, e.event, e.source ?? null, e.alertedCount ?? null, e.dispatchMs ?? null, e.secondsToClaim ?? null],
    );
  })().catch(fail);
}

// ---- Reads ----------------------------------------------------------------------------------------

export type Range = '24h' | '7d';
const RANGE_SQL: Record<Range, { interval: string; bucket: string }> = {
  '24h': { interval: '24 hours', bucket: '15 minutes' },
  '7d': { interval: '7 days', bucket: '2 hours' },
};

export type HistoryPoint = { t: string; avgPct: number | null; minPct: number | null; avgTemp: number | null; minTemp: number | null };

export async function cityHistory(range: Range) {
  const db = await ready();
  if (!db) return null;
  const r = RANGE_SQL[range];
  const { rows } = await db.query(
    `SELECT time_bucket($2::interval, bucket) AS t,
            avg(avg_pct) AS avg_pct, min(min_pct) AS min_pct,
            avg(avg_temp) AS avg_temp, min(min_temp) AS min_temp,
            bool_or(simulated) AS simulated, bool_or(overridden) AS overridden
     FROM city_15m WHERE bucket > now() - $1::interval
     GROUP BY 1 ORDER BY 1`,
    [r.interval, r.bucket],
  );
  const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);
  return {
    range,
    bucket: r.bucket,
    points: rows.map((row) => ({
      t: new Date(row.t).toISOString(),
      avgPct: num(row.avg_pct),
      minPct: num(row.min_pct),
      avgTemp: num(row.avg_temp),
      minTemp: num(row.min_temp),
    })) as HistoryPoint[],
    simulated: rows.some((row) => row.simulated),
    overridden: rows.some((row) => row.overridden),
  };
}

export async function shelterHistory(range: Range) {
  const db = await ready();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT shelter_id,
            sum(full_samples)::float / nullif(sum(samples), 0) AS share_full,
            avg(avg_available) AS avg_available,
            bool_or(simulated) AS simulated
     FROM shelter_1h WHERE bucket > now() - $1::interval
     GROUP BY shelter_id ORDER BY share_full DESC NULLS LAST`,
    [RANGE_SQL[range].interval],
  );
  return rows.map((row) => ({
    shelterId: row.shelter_id as string,
    shareFull: row.share_full === null ? null : Math.round(Number(row.share_full) * 1000) / 1000,
    avgAvailable: Math.round(Number(row.avg_available) * 10) / 10,
    simulated: Boolean(row.simulated),
  }));
}

export async function incidentHistory(range: Range) {
  const db = await ready();
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT count(*) FILTER (WHERE event = 'alert') AS alerts,
            count(*) FILTER (WHERE event = 'alert' AND alerted_count = 0) AS no_responder,
            count(*) FILTER (WHERE event = 'claimed') AS claimed,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dispatch_ms) FILTER (WHERE event = 'alert') AS p50_dispatch_ms,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY dispatch_ms) FILTER (WHERE event = 'alert') AS p90_dispatch_ms,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY seconds_to_claim) FILTER (WHERE event = 'claimed') AS p50_claim_s
     FROM incident_events WHERE time > now() - $1::interval`,
    [RANGE_SQL[range].interval],
  );
  const r = rows[0];
  const n = (v: unknown) => (v === null ? null : Math.round(Number(v) * 10) / 10);
  return {
    alerts: Number(r.alerts),
    noResponder: Number(r.no_responder),
    claimed: Number(r.claimed),
    p50DispatchMs: n(r.p50_dispatch_ms),
    p90DispatchMs: n(r.p90_dispatch_ms),
    p50ClaimS: n(r.p50_claim_s),
  };
}

// ---- Demo backfill --------------------------------------------------------------------------------
// Seven days of SIMULATED history so the History panel has something to show in a demo.
// Rows are tagged source='simulated' and the UI labels them. Live samples are never touched.

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function backfillSimulated(days = 7, stepMin = 10): Promise<number> {
  const db = await ready();
  if (!db) throw new Error('Tiger Data is not configured');
  await db.query(`DELETE FROM city_samples WHERE source = 'simulated'`);
  await db.query(`DELETE FROM shelter_samples WHERE source = 'simulated'`);

  const rand = mulberry32(1217);
  // Hour of day in Ottawa, so "night" is right whatever timezone the server runs in.
  const ottawaHour = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
  const shelters = SEED.filter((s) => (s.kind ?? 'shelter') === 'shelter');
  const end = Date.now() - 15 * 60_000;
  const start = end - days * 86_400_000;
  const cityRows: CityRow[] = [];
  const shelterRows: ShelterRow[] = [];
  for (let t = start; t <= end; t += stepMin * 60_000) {
    const at = new Date(t);
    const parts = Object.fromEntries(ottawaHour.formatToParts(at).map((p) => [p.type, p.value]));
    const hour = Number(parts.hour) + Number(parts.minute) / 60;
    const day = (t - start) / 86_400_000;
    // A cold snap in the middle of the week; warmest mid-afternoon, coldest before dawn.
    const temp = -9 + 6 * Math.cos(((hour - 15) / 24) * 2 * Math.PI) - 12 * Math.exp(-((day - 4.5) ** 2) / 0.8) + (rand() - 0.5) * 2;
    const wind = 12 + 14 * rand();
    const feels = effectiveTemperature(Math.round(temp * 10) / 10, Math.round(wind));
    // Demand: evening/night peak, pushed up when it is colder.
    const night = Math.max(0, Math.cos(((hour - 1) / 24) * 2 * Math.PI));
    const pressure = Math.min(1, 0.8 + 0.15 * night + Math.max(0, (-feels - 15) / 60));
    const views = shelters.map((s) => {
      const occupied = Math.min(s.capacity, Math.round(s.capacity * (pressure + (rand() - 0.5) * 0.06)));
      return { id: s.id, kind: 'shelter' as const, capacity: s.capacity, occupied, held: 0, available: s.capacity - occupied };
    });
    const capacity = views.reduce((a, v) => a + v.capacity, 0);
    const available = views.reduce((a, v) => a + v.available, 0);
    const snap = {
      at: at.toISOString(),
      shelters: views,
      totals: { capacity, available, availablePct: Math.round((available / capacity) * 10000) / 100, overflowActive: 0, overflowAvailable: 0 },
    } as unknown as Snapshot;
    const weather: EffectiveWeather = {
      reading: { tempC: Math.round(temp * 10) / 10, windKmh: Math.round(wind), effectiveTempC: feels, observedAt: at.toISOString(), station: 'simulated' },
      overridden: false,
      lastError: null,
      fetchedAt: null,
    };
    const [city, rows] = rowsFor(snap, weather, at, 'simulated');
    cityRows.push(city);
    shelterRows.push(...rows);
  }
  for (let i = 0; i < cityRows.length; i += 2000) await insertRows(db, cityRows.slice(i, i + 2000), []);
  for (let i = 0; i < shelterRows.length; i += 5000) await insertRows(db, [], shelterRows.slice(i, i + 5000));
  // Backfilled rows are older than the aggregates' watermark, so refresh them now.
  await refreshAggregates(db);
  return cityRows.length;
}

export async function clearSimulated(): Promise<void> {
  const db = await ready();
  if (!db) return;
  await db.query(`DELETE FROM city_samples WHERE source = 'simulated'`);
  await db.query(`DELETE FROM shelter_samples WHERE source = 'simulated'`);
  await refreshAggregates(db);
}

// The refresh policy's background job can hold the same window (error 55P03); wait and retry.
async function refreshAggregates(db: pg.Pool): Promise<void> {
  for (const view of ['city_15m', 'shelter_1h']) {
    for (let attempt = 1; ; attempt++) {
      try {
        await db.query(`CALL refresh_continuous_aggregate('${view}', NULL, NULL)`);
        break;
      } catch (err) {
        if ((err as { code?: string }).code !== '55P03' || attempt >= 20) throw err;
        await new Promise((r) => setTimeout(r, 250 * attempt));
      }
    }
  }
}
