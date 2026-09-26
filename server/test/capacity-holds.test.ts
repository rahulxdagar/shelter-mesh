import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { col } from '../src/db.ts';
import { computeSnapshot, recordFullTransitions, statusFor } from '../src/services/capacity.ts';
import { auth, token, tokens, useTestApp } from './helpers.ts';

const ctx = useTestApp();

async function setShelter(id: string, capacity: number, occupied: number) {
  await col.shelters().updateOne({ _id: id }, { $set: { capacity, occupied } });
}

describe('capacity', () => {
  it('colours markers green >= 10, yellow 1-9, red 0', () => {
    assert.equal(statusFor(10), 'green');
    assert.equal(statusFor(9), 'yellow');
    assert.equal(statusFor(1), 'yellow');
    assert.equal(statusFor(0), 'red');
  });

  it('excludes inactive overflow sites from the snapshot', async () => {
    const snap = await computeSnapshot();
    assert.equal(snap.shelters.some((s) => s.kind === 'overflow'), false);
    assert.equal(snap.totals.capacity, 455);
    assert.equal(snap.totals.available, 38);
  });

  it('records shelter_full exactly once per transition', async () => {
    await setShelter('hintonburg-respite', 25, 25);
    await recordFullTransitions(await computeSnapshot());
    await recordFullTransitions(await computeSnapshot());
    const events = await col.audit().find({ type: 'shelter_full', 'data.shelterId': 'hintonburg-respite' }).toArray();
    assert.equal(events.length, 1);

    await setShelter('hintonburg-respite', 25, 24);
    await recordFullTransitions(await computeSnapshot());
    await setShelter('hintonburg-respite', 25, 25);
    await recordFullTransitions(await computeSnapshot());
    assert.equal(await col.audit().countDocuments({ type: 'shelter_full', 'data.shelterId': 'hintonburg-respite' }), 2);
  });
});

describe('bed holds', () => {
  it('lets exactly one of 10 concurrent holds take the last bed', async () => {
    await setShelter('hintonburg-respite', 25, 24);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        ctx.request.post('/api/holds').set(auth(token('outreach', `worker-${i}`))).send({ shelterId: 'hintonburg-respite' }),
      ),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409, 409, 409, 409, 409]);
    const snap = await computeSnapshot();
    assert.equal(snap.shelters.find((s) => s.id === 'hintonburg-respite')!.available, 0);
  });

  it('stops counting an expired hold immediately and refuses to confirm it', async () => {
    const res = await ctx.request.post('/api/holds').set(auth(tokens.outreach)).send({ shelterId: 'hintonburg-respite' });
    assert.equal(res.status, 201);
    assert.match(res.body.code, /^FROST-\d{4}$/);
    let snap = await computeSnapshot();
    assert.equal(snap.shelters.find((s) => s.id === 'hintonburg-respite')!.available, 11);

    // Expire it without waiting for the TTL monitor.
    await col.holds().updateMany({}, { $set: { expireAt: new Date(Date.now() - 1000) } });
    snap = await computeSnapshot();
    assert.equal(snap.shelters.find((s) => s.id === 'hintonburg-respite')!.available, 12);

    const confirm = await ctx.request.post(`/api/holds/${res.body.id}/confirm`).set(auth(tokens.shelterAdmin));
    assert.equal(confirm.status, 404);
  });

  it('turns a confirmed hold into an occupied bed', async () => {
    const hold = await ctx.request.post('/api/holds').set(auth(tokens.outreach)).send({ shelterId: 'hintonburg-respite' });
    const list = await ctx.request.get('/api/shelters/hintonburg-respite/holds').set(auth(tokens.shelterAdmin));
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].code, hold.body.code);

    const confirm = await ctx.request.post(`/api/holds/${hold.body.id}/confirm`).set(auth(tokens.shelterAdmin));
    assert.equal(confirm.status, 200);
    const s = await col.shelters().findOne({ _id: 'hintonburg-respite' });
    assert.equal(s!.occupied, 14);
    assert.equal(await col.holds().countDocuments({}), 0);
  });

  it('only lets the shelter admin of that shelter confirm, and only the creator cancel', async () => {
    const hold = await ctx.request.post('/api/holds').set(auth(tokens.outreach)).send({ shelterId: 'hintonburg-respite' });
    const otherAdmin = token('shelter_admin', 'admin-other', 'market-mens');
    assert.equal((await ctx.request.post(`/api/holds/${hold.body.id}/confirm`).set(auth(otherAdmin))).status, 403);
    assert.equal((await ctx.request.delete(`/api/holds/${hold.body.id}`).set(auth(tokens.outreach2))).status, 403);
    assert.equal((await ctx.request.delete(`/api/holds/${hold.body.id}`).set(auth(tokens.outreach))).status, 204);
  });

  it('rejects a hold on a full shelter', async () => {
    const res = await ctx.request.post('/api/holds').set(auth(tokens.outreach)).send({ shelterId: 'somerset-mens' });
    assert.equal(res.status, 409);
  });
});

describe('shelter updates', () => {
  it('increments occupancy atomically and stops at capacity', async () => {
    await setShelter('hintonburg-respite', 25, 24);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        ctx.request.post('/api/shelters/hintonburg-respite/occupancy').set(auth(tokens.shelterAdmin)).send({ delta: 1 }),
      ),
    );
    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal((await col.shelters().findOne({ _id: 'hintonburg-respite' }))!.occupied, 25);
  });

  it('rejects occupied greater than capacity', async () => {
    const res = await ctx.request
      .patch('/api/shelters/hintonburg-respite')
      .set(auth(tokens.shelterAdmin))
      .send({ capacity: 10, occupied: 11 });
    assert.equal(res.status, 400);
  });
});
