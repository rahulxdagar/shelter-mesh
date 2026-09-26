import { config } from '../config.ts';

export type LatLng = { lat: number; lng: number };
export type TravelTime = { walkS: number | null; transitS: number | null; distanceM: number; source: 'google' | 'estimate' };

const WALK_KMH = 4.5;
const STREET_FACTOR = 1.3; // streets are longer than a straight line

export function haversineM(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function estimateWalkS(distanceM: number): number {
  return Math.round((distanceM * STREET_FACTOR) / ((WALK_KMH * 1000) / 3600));
}

function estimate(origin: LatLng, destinations: LatLng[]): TravelTime[] {
  return destinations.map((d) => {
    const distanceM = Math.round(haversineM(origin, d));
    return { walkS: estimateWalkS(distanceM), transitS: null, distanceM, source: 'estimate' as const };
  });
}

type MatrixElement = {
  originIndex?: number;
  destinationIndex?: number;
  duration?: string; // e.g. "754s"
  distanceMeters?: number;
  condition?: string;
};

// Google Routes API, computeRouteMatrix (replaces the Legacy Distance Matrix API).
async function routeMatrix(origin: LatLng, destinations: LatLng[], travelMode: 'WALK' | 'TRANSIT') {
  const waypoint = (p: LatLng) => ({ waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } } });
  const res = await fetch('https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix', {
    method: 'POST',
    signal: AbortSignal.timeout(4000),
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': config.googleServerKey!,
      'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,distanceMeters,condition',
    },
    body: JSON.stringify({ origins: [waypoint(origin)], destinations: destinations.map(waypoint), travelMode }),
  });
  if (!res.ok) throw new Error(`Routes API ${travelMode} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const elements = (await res.json()) as MatrixElement[];
  const out: ({ s: number; m: number } | null)[] = destinations.map(() => null);
  for (const e of elements) {
    if (e.condition !== 'ROUTE_EXISTS' || e.destinationIndex === undefined || !e.duration) continue;
    out[e.destinationIndex] = { s: parseInt(e.duration, 10), m: e.distanceMeters ?? 0 };
  }
  return out;
}

export async function travelTimes(origin: LatLng, destinations: LatLng[]): Promise<TravelTime[]> {
  if (!destinations.length) return [];
  if (!config.googleServerKey) return estimate(origin, destinations);
  try {
    const [walk, transit] = await Promise.all([
      routeMatrix(origin, destinations, 'WALK'),
      routeMatrix(origin, destinations, 'TRANSIT').catch(() => destinations.map(() => null)),
    ]);
    const fallback = estimate(origin, destinations);
    return destinations.map((_, i) => ({
      walkS: walk[i]?.s ?? fallback[i].walkS,
      transitS: transit[i]?.s ?? null,
      distanceM: walk[i]?.m ?? fallback[i].distanceM,
      source: 'google' as const,
    }));
  } catch (err) {
    console.error('[routes] falling back to estimates:', (err as Error).message);
    return estimate(origin, destinations);
  }
}

export function bestTimeS(t: TravelTime): number {
  return Math.min(t.walkS ?? Infinity, t.transitS ?? Infinity);
}

// Maps URLs open turn-by-turn navigation in the Google Maps app; no API key needed.
export function navigationUrl(to: LatLng, mode: 'walking' | 'driving' = 'walking'): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=${mode}`;
}
