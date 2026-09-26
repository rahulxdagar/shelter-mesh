// Demo data: fictional shelters at real Ottawa neighbourhood locations.
import { col, connectDb, closeDb } from './db.ts';
import type { Eligibility, Gender, ShelterDoc } from './types.ts';

const ALL: Gender[] = ['woman', 'man', 'nonbinary'];

type Seed = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  capacity: number;
  occupied: number;
  kind?: ShelterDoc['kind'];
  e: Partial<Eligibility>;
};

const base: Eligibility = {
  minAge: 18,
  maxAge: 120,
  acceptsGenders: ALL,
  acceptsFamilies: false,
  accessible: false,
  allowsActiveUse: false,
};

export const SEED: Seed[] = [
  { id: 'market-mens', name: "Market Street Men's Shelter", address: 'ByWard Market', lat: 45.429, lng: -75.692, capacity: 120, occupied: 112, e: { acceptsGenders: ['man'], allowsActiveUse: true } },
  { id: 'centretown-womens', name: "Centretown Women's Refuge", address: 'Centretown', lat: 45.4148, lng: -75.6975, capacity: 45, occupied: 41, e: { minAge: 16, acceptsGenders: ['woman', 'nonbinary'], accessible: true } },
  { id: 'vanier-family', name: 'Vanier Family Centre', address: 'Vanier', lat: 45.4372, lng: -75.6618, capacity: 60, occupied: 58, e: { minAge: 0, acceptsFamilies: true, accessible: true } },
  { id: 'sandyhill-youth', name: 'Sandy Hill Youth Shelter', address: 'Sandy Hill', lat: 45.4238, lng: -75.681, capacity: 30, occupied: 27, e: { minAge: 16, maxAge: 24 } },
  { id: 'lowertown-harm', name: 'Lowertown Harm Reduction Hostel', address: 'Lowertown', lat: 45.4318, lng: -75.688, capacity: 40, occupied: 39, e: { accessible: true, allowsActiveUse: true } },
  { id: 'hintonburg-respite', name: 'Hintonburg Respite Centre', address: 'Hintonburg', lat: 45.402, lng: -75.728, capacity: 25, occupied: 13, e: { accessible: true, allowsActiveUse: true } },
  { id: 'somerset-mens', name: "Somerset West Men's Hostel", address: 'Chinatown', lat: 45.4128, lng: -75.7065, capacity: 80, occupied: 80, e: { acceptsGenders: ['man'] } },
  { id: 'overbrook-women', name: "Overbrook Women & Children's House", address: 'Overbrook', lat: 45.4285, lng: -75.649, capacity: 35, occupied: 30, e: { minAge: 0, acceptsGenders: ['woman', 'nonbinary'], acceptsFamilies: true } },
  { id: 'bank-2slgbtq', name: 'Bank Street 2SLGBTQ+ Shelter', address: 'Glebe', lat: 45.405, lng: -75.69, capacity: 20, occupied: 17, e: { minAge: 16, accessible: true } },
  // Overflow sites: closed until Code Frost is authorized.
  { id: 'overflow-westend', name: 'West End Community Centre (overflow)', address: 'West Centretown', lat: 45.4105, lng: -75.7135, capacity: 0, occupied: 0, kind: 'overflow', e: { minAge: 0, acceptsFamilies: true, accessible: true, allowsActiveUse: true } },
  { id: 'overflow-lowertown', name: 'Lowertown Community Centre (overflow)', address: 'Lowertown', lat: 45.4335, lng: -75.6855, capacity: 0, occupied: 0, kind: 'overflow', e: { minAge: 0, acceptsFamilies: true, accessible: true, allowsActiveUse: true } },
  { id: 'overflow-vanier', name: 'Vanier Community Centre (overflow)', address: 'Vanier', lat: 45.4402, lng: -75.659, capacity: 0, occupied: 0, kind: 'overflow', e: { minAge: 0, acceptsFamilies: true, accessible: true, allowsActiveUse: true } },
];

export function seedDoc(s: Seed): ShelterDoc {
  const kind = s.kind ?? 'shelter';
  return {
    _id: s.id,
    name: s.name,
    address: s.address,
    location: { type: 'Point', coordinates: [s.lng, s.lat] },
    kind,
    active: kind === 'shelter',
    capacity: s.capacity,
    occupied: s.occupied,
    eligibility: { ...base, ...s.e },
    holdSeq: 0,
    isFull: s.occupied >= s.capacity,
    updatedAt: new Date(),
  };
}

// Resets shelters and live state. The audit log is never deleted: it is meant to be append-only.
export async function resetDemo(): Promise<void> {
  await Promise.all([
    col.holds().deleteMany({}),
    col.incidents().deleteMany({}),
    col.codeFrost().deleteMany({}),
    col.settings().updateOne({ _id: 'weather' }, { $set: { override: null } }, { upsert: true }),
  ]);
  for (const s of SEED) await col.shelters().replaceOne({ _id: s.id }, seedDoc(s), { upsert: true });
}

// Fills regular shelters so that under 1% of beds are free, to demo Code Frost.
export async function surgeDemo(): Promise<void> {
  const now = new Date();
  await col.holds().deleteMany({});
  for (const s of SEED.filter((x) => (x.kind ?? 'shelter') === 'shelter')) {
    const occupied = s.id === 'hintonburg-respite' ? s.capacity - 2 : s.capacity;
    await col.shelters().updateOne({ _id: s.id }, { $set: { occupied, updatedAt: now } });
  }
}

export async function seedIfEmpty(): Promise<boolean> {
  if ((await col.shelters().estimatedDocumentCount()) > 0) return false;
  await resetDemo();
  return true;
}

if (import.meta.main) {
  await connectDb();
  await resetDemo();
  console.log(`Seeded ${SEED.length} shelters`);
  await closeDb();
}
