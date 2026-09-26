import { AdvancedMarker, APIProvider, InfoWindow, Map } from '@vis.gl/react-google-maps';
import { useState } from 'react';
import { useI18n } from '../i18n';
import { googleKey, OTTAWA, pinLabel, type CityMapProps } from './CityMap';

const mapId = (import.meta.env.VITE_GOOGLE_MAP_ID as string | undefined) || 'DEMO_MAP_ID';

export default function GoogleCityMap({ shelters, incidents = [], me, center }: CityMapProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const sel = shelters.find((s) => s.id === selected);
  return (
    <APIProvider apiKey={googleKey!}>
      <Map
        mapId={mapId}
        defaultCenter={center ?? me ?? OTTAWA}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI
        colorScheme="DARK"
        style={{ width: '100%', height: '100%' }}
      >
        {shelters.map((s) => (
          <AdvancedMarker key={s.id} position={s} onClick={() => setSelected(s.id)} title={s.name}>
            <div className={`pin pin-${s.status} ${s.kind === 'overflow' ? 'pin-overflow' : ''}`}>{pinLabel(s)}</div>
          </AdvancedMarker>
        ))}
        {incidents.map((i) => (
          <AdvancedMarker key={i.id} position={i} zIndex={1000}>
            <div className="pin pin-incident">!</div>
          </AdvancedMarker>
        ))}
        {me && (
          <AdvancedMarker position={me} zIndex={999}>
            <div className="pin-me" />
          </AdvancedMarker>
        )}
        {sel && (
          <InfoWindow position={sel} onCloseClick={() => setSelected(null)} pixelOffset={[0, -20]}>
            <div className="infowindow">
              <strong>{sel.name}</strong>
              <div>
                {sel.available} / {sel.capacity} {t.free}
              </div>
            </div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}
