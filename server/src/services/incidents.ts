import { performance } from 'node:perf_hooks';
import { ObjectId } from 'mongodb';
import type { User } from '../auth.ts';
import { config } from '../config.ts';
import { col } from '../db.ts';
import { conflict, forbidden, notFound } from '../errors.ts';
import { rt } from '../realtime.ts';
import type { IncidentDoc, PresenceDoc } from '../types.ts';
import { recordAudit } from './audit.ts';
import { recordIncidentEvent } from './history.ts';
import { estimateWalkS, navigationUrl } from './routes.ts';

export function serializeIncident(i: IncidentDoc) {
  return {
    id: i._id.toHexString(),
    status: i.status,
    source: i.source,
    lat: i.location.coordinates[1],
    lng: i.location.coordinates[0],
    reporterId: i.reporterId,
    alertedCount: i.alerted.length,
    alerted: i.alerted,
    claimedBy: i.claimedBy,
    claimedByName: i.claimedByName ?? null,
    createdAt: i.createdAt.toISOString(),
    claimedAt: i.claimedAt?.toISOString() ?? null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    dispatchMs: i.dispatchMs,
  };
}

// SRS FR 4.3: on-duty responders (heartbeat in the last 5 minutes) within the radius, nearest first.
export async function nearbyResponders(lat: number, lng: number, excludeSub: string) {
  return col
    .presence()
    .aggregate<PresenceDoc & { distanceM: number }>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [lng, lat] },
          distanceField: 'distanceM',
          maxDistance: config.responderRadiusM,
          spherical: true,
          query: { lastSeen: { $gt: new Date(Date.now() - config.presenceTtlS * 1000) }, _id: { $ne: excludeSub } },
        },
      },
      { $limit: 25 },
    ])
    .toArray();
}

export async function createIncident(reporterId: string, lat: number, lng: number, source: IncidentDoc['source']) {
  const t0 = performance.now();
  const responders = await nearbyResponders(lat, lng, reporterId);
  const incident: IncidentDoc = {
    _id: new ObjectId(),
    status: 'open',
    source,
    location: { type: 'Point', coordinates: [lng, lat] },
    reporterId,
    alerted: responders.map((r) => ({ userId: r._id, distanceM: Math.round(r.distanceM) })),
    claimedBy: null,
    createdAt: new Date(),
    claimedAt: null,
    resolvedAt: null,
    dispatchMs: null,
  };
  await col.incidents().insertOne(incident);

  const alert = { ...serializeIncident(incident), alerted: undefined, navigationUrl: navigationUrl({ lat, lng }) };
  for (const r of incident.alerted) {
    rt.toUser(r.userId, 'incident:alert', { ...alert, distanceM: r.distanceM, walkS: estimateWalkS(r.distanceM) });
  }
  incident.dispatchMs = Math.round((performance.now() - t0) * 10) / 10;
  await col.incidents().updateOne({ _id: incident._id }, { $set: { dispatchMs: incident.dispatchMs } });

  rt.toPermission('read:audit', 'incident', serializeIncident(incident));
  void recordAudit('overdose_alert', {
    incidentId: incident._id.toHexString(),
    source,
    reporterId,
    lat,
    lng,
    alertedCount: incident.alerted.length,
    dispatchMs: incident.dispatchMs,
    alertAt: incident.createdAt,
  });
  recordIncidentEvent({
    at: incident.createdAt,
    incidentId: incident._id.toHexString(),
    event: 'alert',
    source,
    alertedCount: incident.alerted.length,
    dispatchMs: incident.dispatchMs,
  });
  return incident;
}

// SRS FR 4.6: one atomic conditional update decides the winner.
export async function acceptIncident(user: User, id: string) {
  if (!ObjectId.isValid(id)) throw notFound('Incident not found');
  const _id = new ObjectId(id);
  const now = new Date();
  const claimed = await col
    .incidents()
    .findOneAndUpdate(
      { _id, status: 'open', 'alerted.userId': user.sub },
      { $set: { status: 'claimed', claimedBy: user.sub, claimedByName: user.name, claimedAt: now } },
      { returnDocument: 'after' },
    );
  if (!claimed) {
    const existing = await col.incidents().findOne({ _id });
    if (!existing) throw notFound('Incident not found');
    if (!existing.alerted.some((a) => a.userId === user.sub)) throw forbidden('You were not alerted to this incident');
    throw conflict(existing.claimedBy ? 'Another responder already accepted' : 'Incident is no longer open');
  }

  const mine = claimed.alerted.find((a) => a.userId === user.sub)!;
  const payload = serializeIncident(claimed);
  for (const a of claimed.alerted) {
    if (a.userId !== user.sub) rt.toUser(a.userId, 'incident:standdown', { id, claimedBy: user.name });
  }
  rt.toUser(claimed.reporterId, 'incident:claimed', {
    id,
    responderName: user.name,
    distanceM: mine.distanceM,
    etaS: estimateWalkS(mine.distanceM),
  });
  rt.toPermission('read:audit', 'incident', payload);
  const secondsToClaim = Math.round((now.getTime() - claimed.createdAt.getTime()) / 100) / 10;
  void recordAudit('overdose_claimed', {
    incidentId: id,
    responderId: user.sub,
    alertAt: claimed.createdAt,
    claimedAt: now,
    secondsToClaim,
  });
  recordIncidentEvent({ at: now, incidentId: id, event: 'claimed', secondsToClaim });
  const loc = { lat: claimed.location.coordinates[1], lng: claimed.location.coordinates[0] };
  return { incident: payload, navigationUrl: navigationUrl(loc) };
}

export async function resolveIncident(user: User, id: string) {
  if (!ObjectId.isValid(id)) throw notFound('Incident not found');
  const now = new Date();
  const resolved = await col
    .incidents()
    .findOneAndUpdate(
      { _id: new ObjectId(id), status: 'claimed', claimedBy: user.sub },
      { $set: { status: 'resolved', resolvedAt: now } },
      { returnDocument: 'after' },
    );
  if (!resolved) throw conflict('Only the responder who accepted can resolve an open claim');
  const payload = serializeIncident(resolved);
  rt.toUser(resolved.reporterId, 'incident:resolved', { id });
  rt.toPermission('read:audit', 'incident', payload);
  void recordAudit('overdose_resolved', { incidentId: id, responderId: user.sub, claimedAt: resolved.claimedAt, resolvedAt: now });
  recordIncidentEvent({ at: now, incidentId: id, event: 'resolved' });
  return payload;
}

// Open alerts sent to this responder (so a reconnecting app can show them again).
export async function openAlertsFor(sub: string) {
  const list = await col.incidents().find({ 'alerted.userId': sub, status: { $in: ['open', 'claimed'] } }).sort({ createdAt: -1 }).limit(10).toArray();
  return list
    .filter((i) => i.status === 'open' || i.claimedBy === sub)
    .map((i) => {
      const me = i.alerted.find((a) => a.userId === sub)!;
      const loc = { lat: i.location.coordinates[1], lng: i.location.coordinates[0] };
      return { ...serializeIncident(i), alerted: undefined, distanceM: me.distanceM, walkS: estimateWalkS(me.distanceM), navigationUrl: navigationUrl(loc) };
    });
}

export async function getIncidentFor(user: User, id: string) {
  if (!ObjectId.isValid(id)) throw notFound('Incident not found');
  const i = await col.incidents().findOne({ _id: new ObjectId(id) });
  if (!i) throw notFound('Incident not found');
  const allowed =
    i.reporterId === user.sub || i.alerted.some((a) => a.userId === user.sub) || user.permissions.includes('read:audit');
  if (!allowed) throw forbidden();
  return serializeIncident(i);
}

export async function recentIncidents() {
  const list = await col.incidents().find({}).sort({ createdAt: -1 }).limit(20).toArray();
  return list.map(serializeIncident);
}
