import { lazy, Suspense } from 'react';
import type { LatLng } from '../geo';
import type { Shelter } from '../types';

export type MapPoint = { id: string; lat: number; lng: number };
export type CityMapProps = {
  shelters: Shelter[];
  incidents?: MapPoint[];
  me?: LatLng | null;
  center?: LatLng | null;
  height?: number | string;
};

export const OTTAWA: LatLng = { lat: 45.4215, lng: -75.6972 };
export const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

const GoogleCityMap = lazy(() => import('./GoogleCityMap'));
const LeafletCityMap = lazy(() => import('./LeafletCityMap'));

// Google Maps when a browser key is configured, otherwise OpenStreetMap via Leaflet.
export function CityMap(props: CityMapProps) {
  const Impl = googleKey ? GoogleCityMap : LeafletCityMap;
  return (
    <div className="map" style={{ height: props.height ?? 360 }}>
      <Suspense fallback={<div className="map-loading" />}>
        <Impl {...props} />
      </Suspense>
    </div>
  );
}

export function pinLabel(s: Shelter): string {
  return String(s.available);
}
