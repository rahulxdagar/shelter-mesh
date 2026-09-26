import { config } from '../config.ts';
import { col } from '../db.ts';
import type { WeatherReading } from '../types.ts';

// Environment Canada wind chill index. Valid for T <= 10 C and V >= 4.8 km/h; otherwise the air
// temperature is used. We compute it ourselves because the feed's windChill field is unreliable
// (it reported -2 C at an air temperature of 13 C).
export function effectiveTemperature(tempC: number, windKmh: number): number {
  if (tempC > 10 || windKmh < 4.8) return tempC;
  const v = windKmh ** 0.16;
  const wc = 13.12 + 0.6215 * tempC - 11.37 * v + 0.3965 * tempC * v;
  return Math.round(wc * 10) / 10;
}

type Localized<T> = { en: T; fr: T };
type CityPageFeature = {
  properties: {
    name?: Localized<string>;
    currentConditions?: {
      timestamp?: Localized<string>;
      temperature?: { value?: Localized<number> };
      wind?: { speed?: { value?: Localized<number> } };
      station?: { value?: Localized<string> };
    };
  };
};

// MSC GeoMet OGC API: citypageweather-realtime collection.
export async function fetchWeather(cityId = config.weather.cityId): Promise<WeatherReading> {
  const url = `https://api.weather.gc.ca/collections/citypageweather-realtime/items?f=json&identifier=${encodeURIComponent(cityId)}&limit=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Environment Canada ${res.status}`);
  const body = (await res.json()) as { features?: CityPageFeature[] };
  const props = body.features?.[0]?.properties;
  const cc = props?.currentConditions;
  const tempC = cc?.temperature?.value?.en;
  if (typeof tempC !== 'number') throw new Error(`No current temperature for ${cityId}`);
  const rawWind = cc?.wind?.speed?.value?.en;
  const windKmh = typeof rawWind === 'number' ? rawWind : 0; // calm is reported as a missing or text value
  return {
    tempC,
    windKmh,
    effectiveTempC: effectiveTemperature(tempC, windKmh),
    observedAt: cc?.timestamp?.en ?? new Date().toISOString(),
    station: cc?.station?.value?.en ?? props?.name?.en ?? cityId,
  };
}

export async function pollWeather(): Promise<void> {
  try {
    const latest = await fetchWeather();
    await col
      .settings()
      .updateOne({ _id: 'weather' }, { $set: { latest, lastError: null, fetchedAt: new Date() } }, { upsert: true });
  } catch (err) {
    console.error('[weather] poll failed:', (err as Error).message);
    await col
      .settings()
      .updateOne({ _id: 'weather' }, { $set: { lastError: (err as Error).message, fetchedAt: new Date() } }, { upsert: true });
  }
}

export type EffectiveWeather = {
  reading: WeatherReading | null;
  overridden: boolean;
  lastError: string | null;
  fetchedAt: string | null;
};

// A City Ops demo override (SRS FR 3.7) wins over the live reading and is labelled as such.
export async function currentWeather(): Promise<EffectiveWeather> {
  const s = await col.settings().findOne({ _id: 'weather' });
  if (s?.override) {
    const { tempC, windKmh } = s.override;
    return {
      reading: {
        tempC,
        windKmh,
        effectiveTempC: effectiveTemperature(tempC, windKmh),
        observedAt: new Date().toISOString(),
        station: 'Demo override',
      },
      overridden: true,
      lastError: s.lastError ?? null,
      fetchedAt: s.fetchedAt?.toISOString() ?? null,
    };
  }
  return {
    reading: s?.latest ?? null,
    overridden: false,
    lastError: s?.lastError ?? null,
    fetchedAt: s?.fetchedAt?.toISOString() ?? null,
  };
}

export async function setWeatherOverride(override: { tempC: number; windKmh: number } | null): Promise<void> {
  await col.settings().updateOne({ _id: 'weather' }, { $set: { override } }, { upsert: true });
}
