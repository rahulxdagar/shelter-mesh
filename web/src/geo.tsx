import { useEffect, useState } from 'react';

export type LatLng = { lat: number; lng: number };

// For demos on laptops (no GPS) and indoors. Chosen per browser tab.
export const DEMO_LOCATIONS: { id: string; label: string; pos: LatLng }[] = [
  { id: 'parliament', label: 'Parliament Hill', pos: { lat: 45.4236, lng: -75.7009 } },
  { id: 'rideau', label: 'Rideau Centre', pos: { lat: 45.4255, lng: -75.6919 } },
  { id: 'market', label: 'ByWard Market', pos: { lat: 45.4284, lng: -75.6925 } },
  { id: 'confederation', label: 'Confederation Park', pos: { lat: 45.4222, lng: -75.6937 } },
  { id: 'vanier', label: 'Vanier', pos: { lat: 45.4372, lng: -75.6640 } },
];

const KEY = 'coldgrid:location-source';

function loadSource(): string {
  try {
    return sessionStorage.getItem(KEY) ?? 'gps';
  } catch {
    return 'gps';
  }
}

export function useLocation() {
  const [source, setSourceState] = useState<string>(loadSource);
  const [gps, setGps] = useState<LatLng | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  useEffect(() => {
    if (source !== 'gps') return;
    if (!('geolocation' in navigator)) return setGpsError('unsupported');
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setGps({ lat: p.coords.latitude, lng: p.coords.longitude });
        setGpsError(null);
      },
      (e) => setGpsError(e.message || 'denied'),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [source]);

  const setSource = (s: string) => {
    try {
      sessionStorage.setItem(KEY, s);
    } catch {
      // ignore
    }
    setSourceState(s);
  };

  const demo = DEMO_LOCATIONS.find((d) => d.id === source);
  const pos = demo ? demo.pos : gps;
  return { pos, source, setSource, gpsError: demo ? null : gpsError };
}

export function LocationPicker({ loc }: { loc: ReturnType<typeof useLocation> }) {
  return (
    <label className="location-picker">
      <span aria-hidden>📍</span>
      <select value={loc.source} onChange={(e) => loc.setSource(e.target.value)} aria-label="Location source">
        <option value="gps">GPS{loc.source === 'gps' && !loc.pos ? ' (waiting…)' : ''}</option>
        {DEMO_LOCATIONS.map((d) => (
          <option key={d.id} value={d.id}>
            Demo: {d.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function formatMin(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}
