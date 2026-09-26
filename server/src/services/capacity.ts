import { col } from '../db.ts';
import type { ShelterDoc } from '../types.ts';
import { recordAudit } from './audit.ts';

export type ShelterView = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: ShelterDoc['kind'];
  capacity: number;
  occupied: number;
  held: number;
  available: number;
  status: 'green' | 'yellow' | 'red';
  eligibility: ShelterDoc['eligibility'];
  updatedAt: string;
};

export type Snapshot = {
  at: string;
  shelters: ShelterView[];
  totals: {
    capacity: number; // regular shelters only
    available: number;
    availablePct: number;
    overflowActive: number;
    overflowAvailable: number;
  };
};

export function availableBeds(s: Pick<ShelterDoc, 'capacity' | 'occupied'>, held: number): number {
  return Math.max(0, s.capacity - s.occupied - held);
}

// SRS FR 1.5: green >= 10, yellow 1-9, red 0.
export function statusFor(available: number): ShelterView['status'] {
  if (available >= 10) return 'green';
  if (available >= 1) return 'yellow';
  return 'red';
}

// Active holds (expireAt in the future) per shelter. Expired holds stop counting immediately,
// even before the TTL monitor deletes them.
export async function activeHoldCounts(now = new Date(), shelterIds?: string[]): Promise<Map<string, number>> {
  const match: Record<string, unknown> = { expireAt: { $gt: now } };
  if (shelterIds) match.shelterId = { $in: shelterIds };
  const rows = await col
    .holds()
    .aggregate<{ _id: string; n: number }>([{ $match: match }, { $group: { _id: '$shelterId', n: { $sum: 1 } } }])
    .toArray();
  return new Map(rows.map((r) => [r._id, r.n]));
}

export function toView(s: ShelterDoc, held: number): ShelterView {
  const available = availableBeds(s, held);
  return {
    id: s._id,
    name: s.name,
    address: s.address,
    lat: s.location.coordinates[1],
    lng: s.location.coordinates[0],
    kind: s.kind,
    capacity: s.capacity,
    occupied: s.occupied,
    held,
    available,
    status: statusFor(available),
    eligibility: s.eligibility,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export async function computeSnapshot(now = new Date()): Promise<Snapshot> {
  const [shelters, held] = await Promise.all([
    col.shelters().find({ active: true }).sort({ name: 1 }).toArray(),
    activeHoldCounts(now),
  ]);
  const views = shelters.map((s) => toView(s, held.get(s._id) ?? 0));
  const regular = views.filter((v) => v.kind === 'shelter');
  const overflow = views.filter((v) => v.kind === 'overflow');
  const capacity = regular.reduce((a, v) => a + v.capacity, 0);
  const available = regular.reduce((a, v) => a + v.available, 0);
  return {
    at: now.toISOString(),
    shelters: views,
    totals: {
      capacity,
      available,
      availablePct: capacity ? Math.round((available / capacity) * 10000) / 100 : 0,
      overflowActive: overflow.length,
      overflowAvailable: overflow.reduce((a, v) => a + v.available, 0),
    },
  };
}

// SRS FR 1.6: log a shelter_full audit event when a shelter goes from >0 to 0 available.
// The conditional update makes the transition fire exactly once, even with several API instances.
export async function recordFullTransitions(snapshot: Snapshot): Promise<void> {
  for (const s of snapshot.shelters) {
    if (s.available === 0) {
      const res = await col.shelters().updateOne({ _id: s.id, isFull: { $ne: true } }, { $set: { isFull: true } });
      if (res.modifiedCount === 1) {
        await recordAudit('shelter_full', { shelterId: s.id, shelterName: s.name, capacity: s.capacity });
      }
    } else {
      await col.shelters().updateOne({ _id: s.id, isFull: true }, { $set: { isFull: false } });
    }
  }
}
