import { MongoServerError, ObjectId } from 'mongodb';
import { config } from '../config.ts';
import { col } from '../db.ts';
import { rt } from '../realtime.ts';
import type { CodeFrostDoc } from '../types.ts';
import { recordAudit } from './audit.ts';
import { computeSnapshot } from './capacity.ts';
import { sendSms, voiceCall } from './twilio.ts';
import { currentWeather, pollWeather } from './weather.ts';

export function serializeCodeFrost(d: CodeFrostDoc | null) {
  if (!d) return null;
  return {
    id: d._id.toHexString(),
    status: d.status,
    triggeredAt: d.triggeredAt.toISOString(),
    reason: d.reason,
    authorizedAt: d.authorizedAt?.toISOString() ?? null,
    authorizedBy: d.authorizedBy,
    authorizedVia: d.authorizedVia,
    endedAt: d.endedAt?.toISOString() ?? null,
  };
}

// SRS FR 3.3: both conditions must hold.
export function shouldTrigger(availablePct: number, effectiveTempC: number): boolean {
  return availablePct < config.codeFrost.availablePctBelow && effectiveTempC < config.codeFrost.effectiveTempBelowC;
}

export async function codeFrostState() {
  const [open, last, weather, snapshot] = await Promise.all([
    col.codeFrost().findOne({ open: true }),
    col.codeFrost().find({}).sort({ triggeredAt: -1 }).limit(1).next(),
    currentWeather(),
    computeSnapshot(),
  ]);
  const temp = weather.reading?.effectiveTempC ?? null;
  return {
    event: serializeCodeFrost(open ?? last),
    weather,
    availablePct: snapshot.totals.availablePct,
    thresholds: config.codeFrost,
    conditions: {
      capacity: snapshot.totals.availablePct < config.codeFrost.availablePctBelow,
      temperature: temp !== null && temp < config.codeFrost.effectiveTempBelowC,
    },
    oncallCount: config.oncallNumbers.length,
  };
}

async function broadcastState() {
  rt.toAll('codefrost', await codeFrostState());
}

export async function evaluateCodeFrost(): Promise<{ triggered: boolean; reason: string }> {
  const [weather, snapshot] = await Promise.all([currentWeather(), computeSnapshot()]);
  if (!weather.reading) return { triggered: false, reason: 'No weather reading yet' };
  const { availablePct } = snapshot.totals;
  const effectiveTempC = weather.reading.effectiveTempC;
  if (!shouldTrigger(availablePct, effectiveTempC)) {
    await broadcastState();
    return { triggered: false, reason: `Conditions not met (${availablePct}% beds, ${effectiveTempC} C)` };
  }

  const doc: CodeFrostDoc = {
    _id: new ObjectId(),
    open: true,
    status: 'pending_authorization',
    triggeredAt: new Date(),
    reason: { availablePct, effectiveTempC, weatherOverridden: weather.overridden },
    authorizedAt: null,
    authorizedBy: null,
    authorizedVia: null,
    endedAt: null,
  };
  try {
    await col.codeFrost().insertOne(doc);
  } catch (err) {
    // Unique partial index on {open: true}: an event is already pending or active.
    if (err instanceof MongoServerError && err.code === 11000) return { triggered: false, reason: 'Code Frost already open' };
    throw err;
  }

  const text =
    `COLD-GRID CODE FROST: ${availablePct}% of shelter beds free, feels like ${effectiveTempC} C` +
    `${weather.overridden ? ' (demo override)' : ''}. Reply AUTHORIZE to open overflow sites.`;
  const voice =
    `Cold Grid Code Frost alert. Only ${availablePct} percent of shelter beds are free and it feels like ` +
    `${Math.round(effectiveTempC)} degrees. Reply AUTHORIZE to the text message to open overflow sites.`;
  await Promise.all(config.oncallNumbers.flatMap((n) => [sendSms(n, text), voiceCall(n, voice)]));
  await recordAudit('code_frost_triggered', { codeFrostId: doc._id.toHexString(), ...doc.reason });
  await broadcastState();
  return { triggered: true, reason: 'Triggered' };
}

// SRS FR 3.5
export async function authorizeCodeFrost(by: string, via: 'sms' | 'dashboard') {
  const now = new Date();
  const event = await col
    .codeFrost()
    .findOneAndUpdate(
      { open: true, status: 'pending_authorization' },
      { $set: { status: 'active', authorizedAt: now, authorizedBy: by, authorizedVia: via } },
      { returnDocument: 'after' },
    );
  if (!event) return null;
  const { modifiedCount } = await col
    .shelters()
    .updateMany(
      { kind: 'overflow', active: false },
      { $set: { active: true, capacity: config.codeFrost.overflowSpaces, occupied: 0, isFull: false, updatedAt: now } },
    );
  await recordAudit('code_frost_authorized', { codeFrostId: event._id.toHexString(), authorizedBy: by, via, overflowSitesOpened: modifiedCount });
  await Promise.all(
    config.oncallNumbers.map((n) => sendSms(n, `COLD-GRID: Code Frost authorized. ${modifiedCount} overflow sites are open.`)),
  );
  await broadcastState();
  return { event: serializeCodeFrost(event), overflowSitesOpened: modifiedCount };
}

// SRS FR 3.6: overflow sites with nobody checked in close; occupied ones stay open until emptied.
export async function endCodeFrost(by: string) {
  const event = await col
    .codeFrost()
    .findOneAndUpdate({ open: true }, { $set: { status: 'ended', endedAt: new Date() }, $unset: { open: '' } }, { returnDocument: 'after' });
  if (!event) return null;
  const { modifiedCount } = await col
    .shelters()
    .updateMany({ kind: 'overflow', active: true, occupied: 0 }, { $set: { active: false, updatedAt: new Date() } });
  await recordAudit('code_frost_ended', { codeFrostId: event._id.toHexString(), endedBy: by, overflowSitesClosed: modifiedCount });
  await broadcastState();
  return serializeCodeFrost(event);
}

export function startCodeFrostPoller() {
  const tick = async () => {
    await pollWeather();
    await evaluateCodeFrost().catch((err) => console.error('[codefrost] evaluate failed', err));
  };
  void tick();
  setInterval(tick, config.weather.pollMs).unref();
}
