import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { col } from '../src/db.ts';
import { recordAudit, verifyAudit } from '../src/services/audit.ts';
import { shouldTrigger } from '../src/services/codefrost.ts';
import { effectiveTemperature } from '../src/services/weather.ts';
import { auth, tokens, useTestApp } from './helpers.ts';

const ctx = useTestApp();

const sms = (From: string, Body: string) =>
  ctx.request.post('/api/twilio/sms').type('form').send({ From, Body });

describe('wind chill', () => {
  it('matches Environment Canada reference values', () => {
    assert.equal(Math.round(effectiveTemperature(-20, 30)), -33);
    assert.equal(Math.round(effectiveTemperature(-10, 20)), -18);
    assert.equal(Math.round(effectiveTemperature(-30, 50)), -49);
  });

  it('uses air temperature when warm or calm', () => {
    assert.equal(effectiveTemperature(13, 17), 13);
    assert.equal(effectiveTemperature(-20, 2), -20);
  });
});

describe('Code Frost', () => {
  it('needs both conditions', () => {
    assert.equal(shouldTrigger(0.5, -16), true);
    assert.equal(shouldTrigger(0.5, -15), false);
    assert.equal(shouldTrigger(1, -30), false);
    assert.equal(shouldTrigger(5, -30), false);
  });

  it('does not trigger on cold alone', async () => {
    const res = await ctx.request.post('/api/codefrost/override').set(auth(tokens.ops)).send({ tempC: -25, windKmh: 30 });
    assert.equal(res.body.triggered, false);
  });

  it('triggers once, notifies on-call by SMS and voice, and opens overflow on AUTHORIZE', async () => {
    await ctx.request.post('/api/demo/surge').set(auth(tokens.ops)).expect(200);
    const res = await ctx.request.post('/api/codefrost/override').set(auth(tokens.ops)).send({ tempC: -22, windKmh: 30 });
    assert.equal(res.body.triggered, true);

    const again = await ctx.request.post('/api/codefrost/evaluate').set(auth(tokens.ops));
    assert.equal(again.body.triggered, false);
    assert.equal(await col.codeFrost().countDocuments({}), 1);

    const out = await col.outbox().find({ direction: 'out' }).toArray();
    assert.deepEqual(out.map((o) => o.channel).sort(), ['sms', 'voice']);
    assert.ok(out.every((o) => o.status === 'simulated' && o.to === '+15550000001'));

    // An unknown number cannot authorize.
    const bad = await sms('+15559999999', 'AUTHORIZE');
    assert.match(bad.text, /not on the Code Frost on-call list/);
    assert.equal(await col.shelters().countDocuments({ kind: 'overflow', active: true }), 0);

    const ok = await sms('+15550000001', 'authorize');
    assert.match(ok.text, /3 overflow sites are now open/);
    const overflow = await col.shelters().find({ kind: 'overflow' }).toArray();
    assert.ok(overflow.every((s) => s.active && s.capacity === 100));

    const snap = await ctx.request.get('/api/snapshot').set(auth(tokens.outreach));
    assert.equal(snap.body.totals.overflowActive, 3);
    assert.equal(snap.body.totals.overflowAvailable, 300);

    const end = await ctx.request.post('/api/codefrost/end').set(auth(tokens.ops));
    assert.equal(end.status, 200);
    assert.equal(await col.shelters().countDocuments({ kind: 'overflow', active: true }), 0);

    const types = (await col.audit().find({}).toArray()).map((a) => a.type);
    for (const t of ['code_frost_triggered', 'code_frost_authorized', 'code_frost_ended']) assert.ok(types.includes(t as never), t);
  });

  it('dashboard authorize requires execute:code_frost', async () => {
    const res = await ctx.request.post('/api/codefrost/authorize').set(auth(tokens.outreach));
    assert.equal(res.status, 403);
  });
});

describe('SMS overdose fallback', () => {
  it('rejects unregistered phones', async () => {
    const res = await sms('+15551234567', 'OD 45.4215,-75.6972');
    assert.match(res.text, /not registered/);
    assert.equal(await col.incidents().countDocuments({}), 0);
  });
});

describe('audit trail', () => {
  it('hashes deterministically, chains events and detects tampering', async () => {
    const a = await recordAudit('shelter_full', { shelterId: 'x', capacity: 10 });
    const b = await recordAudit('shelter_full', { shelterId: 'y', capacity: 20 });
    assert.equal(b.prevHash, a.hash);
    assert.equal(a.ledger.mode, 'local');

    const ok = await verifyAudit(b._id.toHexString());
    assert.equal(ok!.hashMatches, true);
    assert.equal(ok!.chainMatches, true);

    await col.audit().updateOne({ _id: b._id }, { $set: { 'data.capacity': 999 } });
    const tampered = await verifyAudit(b._id.toHexString());
    assert.equal(tampered!.hashMatches, false);
  });

  it('is only readable with read:audit', async () => {
    assert.equal((await ctx.request.get('/api/audit').set(auth(tokens.outreach))).status, 403);
    assert.equal((await ctx.request.get('/api/audit').set(auth(tokens.ops))).status, 200);
  });
});

describe('permissions', () => {
  it('requires a token', async () => {
    assert.equal((await ctx.request.get('/api/snapshot')).status, 401);
    assert.equal((await ctx.request.get('/api/snapshot').set(auth('garbage'))).status, 401);
  });

  it('enforces scopes per role', async () => {
    const cases: [string, string, string, number][] = [
      ['patch', '/api/shelters/hintonburg-respite', tokens.outreach, 403],
      ['post', '/api/holds', tokens.responderA, 403],
      ['post', '/api/incidents', tokens.shelterAdmin, 403],
      ['post', '/api/codefrost/evaluate', tokens.shelterAdmin, 403],
      ['post', '/api/demo/reset', tokens.outreach, 403],
      ['patch', '/api/shelters/market-mens', tokens.shelterAdmin, 403],
    ];
    for (const [method, path, t, status] of cases) {
      const res = await (ctx.request as any)[method](path).set(auth(t)).send({ occupied: 1, shelterId: 'x', lat: 45, lng: -75 });
      assert.equal(res.status, status, `${method} ${path}`);
    }
  });
});
