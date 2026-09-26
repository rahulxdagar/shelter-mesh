import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { io as connect, type Socket } from 'socket.io-client';
import { createApp } from '../src/app.ts';
import { closeDb, col, connectDb } from '../src/db.ts';
import { startRealtime, stopRealtime } from '../src/realtime.ts';
import { resetDemo } from '../src/seed.ts';
import { tokens } from './helpers.ts';

let server: Server;
let base = '';
const sockets: Socket[] = [];

// Downtown point, a responder 300 m away, one 250 m away, one 3 km away.
const scene = { lat: 45.4215, lng: -75.6972 };
const near = { lat: 45.4242, lng: -75.6972 };
const near2 = { lat: 45.4215, lng: -75.7004 };
const far = { lat: 45.4485, lng: -75.6972 };

before(async () => {
  await connectDb(null, 'coldgrid-test');
  server = createServer(createApp());
  startRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDemo();
  await col.presence().deleteMany({});
});

after(async () => {
  sockets.forEach((s) => s.close());
  await stopRealtime();
  await new Promise((r) => server.close(r));
  await closeDb();
});

function open(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(base, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

function next<T = any>(s: Socket, event: string, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    s.once(event, (p: T) => {
      clearTimeout(t);
      resolve(p);
    });
  });
}

async function onDuty(token: string, at: { lat: number; lng: number }) {
  const s = await open(token);
  const ack = await s.emitWithAck('presence:update', at);
  assert.deepEqual(ack, { ok: true });
  return s;
}

async function api(method: string, path: string, token: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

describe('realtime', () => {
  it('rejects sockets without a valid token', async () => {
    await assert.rejects(open('nope'));
  });

  it('pushes a new snapshot after a capacity change (change stream)', async () => {
    const ops = await open(tokens.ops);
    await next(ops, 'snapshot');
    const pushed = next<{ shelters: { id: string; available: number }[] }>(ops, 'snapshot');
    const t0 = Date.now();
    await api('POST', '/api/shelters/hintonburg-respite/occupancy', tokens.shelterAdmin, { delta: 1 });
    const snap = await pushed;
    assert.equal(snap.shelters.find((s) => s.id === 'hintonburg-respite')!.available, 11);
    assert.ok(Date.now() - t0 < 1000, 'capacity update took over 1 s');
  });
});

describe('overdose mesh', () => {
  it('alerts only on-duty responders within 1 km, and the first accept wins', async () => {
    const a = await onDuty(tokens.responderA, near);
    const b = await onDuty(tokens.responderB, near2);
    const f = await onDuty(tokens.responderFar, far);
    const reporter = await open(tokens.outreach);

    let farAlerted = false;
    f.on('incident:alert', () => (farAlerted = true));
    const alertA = next(a, 'incident:alert');
    const alertB = next(b, 'incident:alert');

    const created = await api('POST', '/api/incidents', tokens.outreach, scene);
    assert.equal(created.status, 201);
    assert.equal(created.body.alertedCount, 2);
    assert.ok(created.body.dispatchMs < 500, `dispatch took ${created.body.dispatchMs} ms`);

    const [pa, pb] = await Promise.all([alertA, alertB]);
    assert.equal(pa.id, created.body.id);
    assert.ok(pa.distanceM > 200 && pa.distanceM < 400);
    assert.match(pa.navigationUrl, /google\.com\/maps\/dir/);
    assert.equal(pb.id, created.body.id);

    const claimedByReporter = next(reporter, 'incident:claimed');
    const standdownA = next(a, 'incident:standdown', 800).catch(() => null);
    const standdownB = next(b, 'incident:standdown', 800).catch(() => null);
    const [ra, rb] = await Promise.all([
      api('POST', `/api/incidents/${created.body.id}/accept`, tokens.responderA),
      api('POST', `/api/incidents/${created.body.id}/accept`, tokens.responderB),
    ]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 409]);
    const winner = ra.status === 200 ? 'a' : 'b';
    const [sa, sb] = await Promise.all([standdownA, standdownB]);
    assert.equal(winner === 'a' ? sb !== null : sa !== null, true, 'loser did not get stand-down');
    assert.equal(winner === 'a' ? sa : sb, null, 'winner got a stand-down');
    const claimed = await claimedByReporter;
    assert.ok(claimed.etaS > 0);
    assert.equal(farAlerted, false);

    const winnerToken = winner === 'a' ? tokens.responderA : tokens.responderB;
    const loserToken = winner === 'a' ? tokens.responderB : tokens.responderA;
    assert.equal((await api('POST', `/api/incidents/${created.body.id}/resolve`, loserToken)).status, 409);
    assert.equal((await api('POST', `/api/incidents/${created.body.id}/resolve`, winnerToken)).status, 200);

    await new Promise((r) => setTimeout(r, 100)); // audit writes are async
    const types = (await col.audit().find({ 'data.incidentId': created.body.id }).toArray()).map((d) => d.type).sort();
    assert.deepEqual(types, ['overdose_alert', 'overdose_claimed', 'overdose_resolved']);
  });

  it('ignores responders whose last heartbeat is stale', async () => {
    await onDuty(tokens.responderA, near);
    await col.presence().updateOne({ _id: 'responder-a' }, { $set: { lastSeen: new Date(Date.now() - 6 * 60_000) } });
    const created = await api('POST', '/api/incidents', tokens.outreach, scene);
    assert.equal(created.body.alertedCount, 0);
  });

  it('does not alert the reporter to their own incident', async () => {
    await onDuty(tokens.responderA, near);
    const created = await api('POST', '/api/incidents', tokens.responderA, scene);
    assert.equal(created.body.alertedCount, 0);
  });

  it('refuses accept from a responder who was not alerted', async () => {
    await onDuty(tokens.responderA, near);
    const created = await api('POST', '/api/incidents', tokens.outreach, scene);
    const res = await api('POST', `/api/incidents/${created.body.id}/accept`, tokens.responderFar);
    assert.equal(res.status, 403);
  });

  it('does not let non-responders go on duty', async () => {
    const s = await open(tokens.outreach);
    const ack = await s.emitWithAck('presence:update', near);
    assert.equal(ack.ok, false);
  });
});
