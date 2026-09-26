// Needs a real TimescaleDB. Skipped unless TEST_TIGER_URL is set, e.g.
//   TEST_TIGER_URL=postgres://postgres:coldgrid@localhost:5433/postgres npm test
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { closeDb, col, connectDb } from '../src/db.ts';
import { resetDemo } from '../src/seed.ts';
import {
  backfillSimulated,
  cityHistory,
  clearSimulated,
  historyStatus,
  incidentHistory,
  recordIncidentEvent,
  sampleNow,
  shelterHistory,
  startHistory,
  stopHistory,
} from '../src/services/history.ts';

const ADMIN_URL = process.env.TEST_TIGER_URL;
const TEST_DB = 'coldgrid_history_test';
const skip = !ADMIN_URL && 'set TEST_TIGER_URL to run TimescaleDB tests';

function testDbUrl() {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

async function query(sql: string) {
  const c = new pg.Client({ connectionString: testDbUrl() });
  await c.connect();
  try {
    return (await c.query(sql)).rows;
  } finally {
    await c.end();
  }
}

async function waitFor(check: () => Promise<boolean>, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
}

describe('Tiger Data history', { skip }, () => {
  before(async () => {
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    await admin.end();
    await connectDb(null, 'coldgrid-history-test');
    await resetDemo();
  });

  after(async () => {
    await stopHistory();
    await closeDb();
  });

  it('fails soft when the database is unreachable', async () => {
    await startHistory('postgres://nobody:nothing@127.0.0.1:1/none', 0);
    assert.equal(historyStatus().ready, false);
    assert.ok(historyStatus().lastError);
    await sampleNow(); // must not throw
    assert.equal(await cityHistory('24h'), null);
    await stopHistory();
  });

  it('migrates idempotently', async () => {
    await startHistory(testDbUrl(), 0);
    assert.equal(historyStatus().ready, true, historyStatus().lastError ?? '');
    await stopHistory();
    await startHistory(testDbUrl(), 0);
    assert.equal(historyStatus().ready, true, historyStatus().lastError ?? '');
    const hypertables = (await query(`SELECT hypertable_name FROM timescaledb_information.hypertables ORDER BY 1`)).map((r) => r.hypertable_name);
    assert.deepEqual(hypertables, ['city_samples', 'incident_events', 'shelter_samples']);
    const caggs = (await query(`SELECT view_name FROM timescaledb_information.continuous_aggregates ORDER BY 1`)).map((r) => r.view_name);
    assert.deepEqual(caggs, ['city_15m', 'shelter_1h']);
  });

  it('samples the live city and every active shelter', async () => {
    await sampleNow();
    const [city] = await query(`SELECT * FROM city_samples WHERE source = 'live'`);
    assert.equal(city.capacity, 455);
    assert.equal(city.available, 38);
    assert.equal(city.available_pct, 8.35);
    const shelters = await query(`SELECT shelter_id, available FROM shelter_samples WHERE source = 'live'`);
    assert.equal(shelters.length, 9);
    assert.equal(shelters.find((s) => s.shelter_id === 'somerset-mens').available, 0);
  });

  it('reads trends from the continuous aggregates', async () => {
    const city = await cityHistory('24h');
    assert.ok(city && city.points.length >= 1);
    assert.equal(city.points.at(-1)!.avgPct, 8.35);
    assert.equal(city.simulated, false);

    const shelters = await shelterHistory('24h');
    assert.equal(shelters!.find((s) => s.shelterId === 'somerset-mens')!.shareFull, 1);
    assert.equal(shelters!.find((s) => s.shelterId === 'hintonburg-respite')!.shareFull, 0);
  });

  it('summarizes overdose response times', async () => {
    const now = new Date();
    recordIncidentEvent({ at: now, incidentId: 'a', event: 'alert', alertedCount: 2, dispatchMs: 5 });
    recordIncidentEvent({ at: now, incidentId: 'b', event: 'alert', alertedCount: 1, dispatchMs: 10 });
    recordIncidentEvent({ at: now, incidentId: 'c', event: 'alert', alertedCount: 0, dispatchMs: 20 });
    recordIncidentEvent({ at: now, incidentId: 'a', event: 'claimed', secondsToClaim: 4 });
    await waitFor(async () => (await query(`SELECT count(*)::int AS n FROM incident_events`))[0].n === 4);
    const s = await incidentHistory('24h');
    assert.deepEqual(s, { alerts: 3, noResponder: 1, claimed: 1, p50DispatchMs: 10, p90DispatchMs: 18, p50ClaimS: 4 });
  });

  it('records incidents raised through the app', async () => {
    const { createIncident } = await import('../src/services/incidents.ts');
    await col.presence().insertOne({ _id: 'resp-1', name: 'R', location: { type: 'Point', coordinates: [-75.6972, 45.424] }, lastSeen: new Date() });
    const inc = await createIncident('reporter-1', 45.4215, -75.6972, 'app');
    await waitFor(async () => (await query(`SELECT count(*)::int AS n FROM incident_events WHERE incident_id = '${inc._id.toHexString()}'`))[0].n === 1);
    const [row] = await query(`SELECT * FROM incident_events WHERE incident_id = '${inc._id.toHexString()}'`);
    assert.equal(row.event, 'alert');
    assert.equal(row.alerted_count, 1);
  });

  it('backfills labelled simulated history and clears it without touching live data', async () => {
    const n = await backfillSimulated(7, 10);
    assert.ok(n > 1000);
    const week = await cityHistory('7d');
    assert.equal(week!.simulated, true);
    assert.ok(week!.points.length >= 80, `only ${week!.points.length} points`);
    assert.ok(week!.points.some((p) => p.minTemp !== null && p.minTemp < -25), 'expected a cold snap');

    await clearSimulated();
    const [{ n: simulated }] = await query(`SELECT count(*)::int AS n FROM city_samples WHERE source = 'simulated'`);
    const [{ n: live }] = await query(`SELECT count(*)::int AS n FROM city_samples WHERE source = 'live'`);
    assert.equal(simulated, 0);
    assert.equal(live, 1);
    assert.equal((await cityHistory('7d'))!.simulated, false);
  });
});
