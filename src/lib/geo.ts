export type LatLng = { lat: number; lng: number };

/** Ottawa City Hall — used only to frame maps before a GPS fix exists. */
export const OTTAWA_CENTER: LatLng = { lat: 45.4215, lng: -75.6972 };

export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 9_950 ? 1 : 0)} km`;
}

export function formatDuration(seconds: number): string {
  const mins = Math.max(1, Math.round(seconds / 60));
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

export function formatCoord(p: LatLng): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

export function getPosition(opts: PositionOptions = {}): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This device has no GPS / geolocation support."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 15_000,
      ...opts,
    });
  });
}

export function describeGeoError(err: unknown): string {
  const e = err as GeolocationPositionError;
  if (e?.code === 1) return "Location permission denied. Enable location access for this site.";
  if (e?.code === 2) return "Location unavailable. Move to open sky or check GPS.";
  if (e?.code === 3) return "Timed out waiting for a GPS fix.";
  return (err as Error)?.message ?? "Could not get location.";
}
