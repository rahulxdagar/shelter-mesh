import type { LatLng } from "./geo";

export type RouteStep = { text: string; distance_m: number; type: string; modifier: string | null };
export type RouteResult = { distance_m: number; duration_s: number; geometry: [number, number][]; steps: RouteStep[] };

export async function fetchRoute(from: LatLng, to: LatLng, profile: "foot" | "car"): Promise<RouteResult> {
  const q = new URLSearchParams({
    profile,
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
  });
  const res = await fetch(`/api/route?${q}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Routing unavailable");
  return data as RouteResult;
}

export async function reverseGeocode(p: LatLng): Promise<string> {
  const res = await fetch(`/api/reverse?lat=${p.lat}&lng=${p.lng}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Reverse geocoding unavailable");
  return data.address as string;
}
