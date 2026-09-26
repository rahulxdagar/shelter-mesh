import { z } from 'zod';
import { config } from '../config.ts';
import { col } from '../db.ts';
import type { ShelterDoc } from '../types.ts';
import { activeHoldCounts, toView, type ShelterView } from './capacity.ts';
import { bestTimeS, travelTimes, type TravelTime } from './routes.ts';

export const triageSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  age: z.number().int().min(0).max(120),
  gender: z.enum(['woman', 'man', 'nonbinary']),
  family: z.boolean(),
  accessibility: z.boolean(),
  substanceUse: z.boolean(),
});
export type Triage = z.infer<typeof triageSchema>;

export type Match = ShelterView & { distanceM: number; travel: TravelTime; bestTimeS: number };

// SRS FR 2.2: hard constraints are an exact filter inside the geo query.
export function eligibilityFilter(t: Triage): Record<string, unknown> {
  const q: Record<string, unknown> = {
    active: true,
    'eligibility.minAge': { $lte: t.age },
    'eligibility.maxAge': { $gte: t.age },
    'eligibility.acceptsGenders': t.gender,
  };
  if (t.family) q['eligibility.acceptsFamilies'] = true;
  if (t.accessibility) q['eligibility.accessible'] = true;
  if (t.substanceUse) q['eligibility.allowsActiveUse'] = true;
  return q;
}

// SRS FR 2.4: the triage answers are only used here and never stored or logged.
export async function findMatches(t: Triage): Promise<Match[]> {
  const nearby = await col
    .shelters()
    .aggregate<ShelterDoc & { distanceM: number }>([
      {
        $geoNear: {
          near: { type: 'Point', coordinates: [t.lng, t.lat] },
          distanceField: 'distanceM',
          maxDistance: config.matchMaxDistanceM,
          spherical: true,
          query: eligibilityFilter(t),
        },
      },
      { $limit: 50 },
    ])
    .toArray();

  const held = await activeHoldCounts(new Date(), nearby.map((s) => s._id));
  const withBeds = nearby
    .map((s) => ({ view: toView(s, held.get(s._id) ?? 0), distanceM: Math.round(s.distanceM) }))
    .filter((s) => s.view.available > 0)
    .slice(0, config.matchRouteLimit);

  const times = await travelTimes(
    { lat: t.lat, lng: t.lng },
    withBeds.map((s) => ({ lat: s.view.lat, lng: s.view.lng })),
  );
  return withBeds
    .map((s, i) => ({ ...s.view, distanceM: s.distanceM, travel: times[i], bestTimeS: bestTimeS(times[i]) }))
    .sort((a, b) => a.bestTimeS - b.bestTimeS);
}
