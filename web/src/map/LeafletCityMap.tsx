import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapContainer, Marker, Popup, TileLayer } from 'react-leaflet';
import { useI18n } from '../i18n';
import { OTTAWA, pinLabel, type CityMapProps } from './CityMap';

const icon = (className: string, html: string) =>
  L.divIcon({ className: '', html: `<div class="${className}">${html}</div>`, iconSize: [40, 40], iconAnchor: [20, 20] });

export default function LeafletCityMap({ shelters, incidents = [], me, center }: CityMapProps) {
  const { t } = useI18n();
  const c = center ?? me ?? OTTAWA;
  return (
    <MapContainer center={[c.lat, c.lng]} zoom={13} style={{ width: '100%', height: '100%' }} zoomControl={false}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="tiles-dark"
      />
      {shelters.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lng]}
          icon={icon(`pin pin-${s.status} ${s.kind === 'overflow' ? 'pin-overflow' : ''}`, pinLabel(s))}
          title={s.name}
        >
          <Popup>
            <strong>{s.name}</strong>
            <br />
            {s.available} / {s.capacity} {t.free}
          </Popup>
        </Marker>
      ))}
      {incidents.map((i) => (
        <Marker key={i.id} position={[i.lat, i.lng]} icon={icon('pin pin-incident', '!')} zIndexOffset={1000} />
      ))}
      {me && <Marker position={[me.lat, me.lng]} icon={icon('pin-me', '')} zIndexOffset={900} />}
    </MapContainer>
  );
}
