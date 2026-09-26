"use client";

import { useCallback, useEffect, useState } from "react";
import { describeGeoError, getPosition, type LatLng } from "@/lib/geo";

export type Fix = LatLng & { accuracy: number | null; at: number };

/** Continuous GPS watch with a manual one-shot `locate()` for when a fresh fix matters. */
export function useGeolocation(watch = true) {
  const [fix, setFix] = useState<Fix | null>(null);
  const [error, setError] = useState<string | null>(() =>
    typeof navigator !== "undefined" && !("geolocation" in navigator) ? "This device has no geolocation support." : null,
  );

  useEffect(() => {
    if (!watch || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, at: p.timestamp });
        setError(null);
      },
      (e) => setError(describeGeoError(e)),
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watch]);

  const locate = useCallback(async (): Promise<Fix> => {
    try {
      const p = await getPosition();
      const f = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null, at: p.timestamp };
      setFix(f);
      setError(null);
      return f;
    } catch (e) {
      const msg = describeGeoError(e);
      setError(msg);
      throw new Error(msg);
    }
  }, []);

  return { fix, error, locate };
}
