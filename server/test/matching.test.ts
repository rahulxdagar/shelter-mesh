import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { col } from '../src/db.ts';
import { auth, tokens, useTestApp } from './helpers.ts';

const ctx = useTestApp();

// Parliament Hill, downtown Ottawa.
const here = { lat: 45.4236, lng: -75.7009 };
const adult = { ...here, age: 34, gender: 'man', family: false, accessibility: false, substanceUse: false };

async function match(body: Record<string, unknown>) {
  const res = await ctx.request.post('/api/match').set(auth(tokens.outreach)).send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body as { id: string; available: number; bestTimeS: number; travel: { source: string } }[];
}

describe('intake matching', () => {
  it('filters by gender and drops full shelters', async () => {
    const ids = (await match(adult)).map((m) => m.id);
    assert.ok(ids.includes('market-mens'));
    assert.ok(!ids.includes('centretown-womens'), 'women-only shelter offered to a man');
    assert.ok(!ids.includes('somerset-mens'), 'full shelter offered');
    assert.ok(!ids.includes('sandyhill-youth'), 'youth shelter offered to a 34-year-old');
  });

  it('applies age, family, accessibility and substance-use constraints', async () => {
    const youth = (await match({ ...adult, age: 19, gender: 'nonbinary' })).map((m) => m.id);
    assert.ok(youth.includes('sandyhill-youth'));
    assert.ok(youth.includes('centretown-womens'));

    const family = (await match({ ...adult, gender: 'woman', family: true })).map((m) => m.id);
    assert.deepEqual(family.sort(), ['overbrook-women', 'vanier-family']);

    const access = (await match({ ...adult, accessibility: true })).map((m) => m.id);
    assert.ok(access.every((id) => ['vanier-family', 'lowertown-harm', 'hintonburg-respite', 'bank-2slgbtq'].includes(id)));

    const use = (await match({ ...adult, gender: 'woman', substanceUse: true })).map((m) => m.id);
    assert.deepEqual(use.sort(), ['hintonburg-respite', 'lowertown-harm']);
  });

  it('sorts by travel time and labels estimates', async () => {
    const results = await match(adult);
    for (let i = 1; i < results.length; i++) assert.ok(results[i - 1].bestTimeS <= results[i].bestTimeS);
    assert.ok(results.every((r) => r.travel.source === 'estimate'));
  });

  it('counts active holds against availability', async () => {
    await col.shelters().updateOne({ _id: 'lowertown-harm' }, { $set: { occupied: 39 } }); // 1 free
    await ctx.request.post('/api/holds').set(auth(tokens.outreach2)).send({ shelterId: 'lowertown-harm' });
    const ids = (await match({ ...adult, substanceUse: true })).map((m) => m.id);
    assert.ok(!ids.includes('lowertown-harm'));
  });

  it('stores nothing about the client', async () => {
    const before = await Promise.all(['holds', 'audit', 'incidents', 'outbox'].map((c) => col[c as 'holds']().countDocuments({})));
    await match({ ...adult, substanceUse: true, accessibility: true });
    const after = await Promise.all(['holds', 'audit', 'incidents', 'outbox'].map((c) => col[c as 'holds']().countDocuments({})));
    assert.deepEqual(after, before);
  });

  it('validates input', async () => {
    const res = await ctx.request.post('/api/match').set(auth(tokens.outreach)).send({ ...adult, gender: 'unknown' });
    assert.equal(res.status, 400);
  });
});
