"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MLMap, Marker as MLMarker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { OTTAWA_CENTER, type LatLng } from "@/lib/geo";
import type { Incident, Shelter } from "@/lib/types";
import { cn } from "@/lib/format";

// Free, keyless dark vector basemap (© OpenStreetMap contributors, © CARTO).
const STYLE_URL = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

type MapLib = typeof import("maplibre-gl");
let libPromise: Promise<MapLib> | null = null;
function loadLib() {
  libPromise ??= import("maplibre-gl").then((m) => {
    m.setWorkerUrl("/vendor/maplibre/maplibre-gl-worker.mjs");
    return m;
  });
  return libPromise;
}

export type MapFocus = { point: LatLng; zoom?: number; key: string | number };

type Props = {
  className?: string;
  shelters?: Shelter[];
  incidents?: Incident[];
  me?: LatLng | null;
  route?: [number, number][] | null;
  selectedShelterId?: string | null;
  selectedIncidentId?: string | null;
  focus?: MapFocus | null;
  /** Fit these points once per distinct key. */
  fit?: { points: LatLng[]; key: string } | null;
  zoom?: number;
  interactive?: boolean;
  showSizes?: boolean;
  onShelterClick?: (s: Shelter) => void;
  onIncidentClick?: (i: Incident) => void;
};

function shelterTone(s: Shelter) {
  if (!s.is_active) return "border-dashed border-faint bg-deep/90 text-faint";
  if (s.kind === "warming_hub") return "border-frost/70 bg-[#0d2230] text-frost";
  if (s.available_beds === 0) return "border-alarm/80 bg-alarm-dim text-alarm";
  if (s.available_beds <= 3) return "border-caution/80 bg-caution-dim text-caution";
  return "border-go/80 bg-go-dim text-go";
}

/** Marker roots carry MapLibre's own positioning classes, so all styling goes on a child. */
function markerRoot(tag: "button" | "div") {
  const root = document.createElement("div");
  root.appendChild(document.createElement(tag));
  return root;
}

function renderShelter(root: HTMLElement, s: Shelter, selected: boolean, showSizes: boolean) {
  const el = root.firstElementChild as HTMLElement;
  el.className = cn(
    "group flex cursor-pointer items-center gap-1 rounded-full border-2 px-2 py-0.5 font-mono text-[12px] font-bold shadow-lg transition-transform duration-150 hover:scale-110",
    shelterTone(s),
    selected && "scale-125 ring-2 ring-ice ring-offset-2 ring-offset-void",
  );
  const size = showSizes ? Math.round(Math.max(0, Math.min(1, s.total_beds / 240)) * 10) : 0;
  el.style.padding = showSizes ? `${2 + size / 3}px ${8 + size / 2}px` : "";
  el.textContent = s.is_active ? String(s.available_beds) : "HUB";
  el.title = `${s.name} — ${s.is_active ? `${s.available_beds}/${s.total_beds} beds` : "standby warming hub"}`;
}

function renderIncident(root: HTMLElement, i: Incident, selected: boolean) {
  const el = root.firstElementChild as HTMLElement;
  const color = i.status === "ACTIVE" ? "bg-alarm" : i.status === "EN_ROUTE" ? "bg-caution" : "bg-ice";
  el.className = "relative flex size-6 cursor-pointer items-center justify-center";
  el.innerHTML = `
    <span class="absolute inset-0 rounded-full ${color} opacity-60 ${i.status === "ACTIVE" ? "animate-ping" : ""}"></span>
    <span class="absolute -inset-2 rounded-full border ${selected ? "border-white" : "border-transparent"}"></span>
    <span class="relative size-4 rounded-full ${color} border-2 border-white shadow-[0_0_16px_rgba(255,59,78,0.8)]"></span>`;
  el.title = `Overdose pin · ${i.status}`;
}

export function TacticalMap({
  className,
  shelters,
  incidents,
  me,
  route,
  selectedShelterId,
  selectedIncidentId,
  focus,
  fit,
  zoom = 13,
  interactive = true,
  showSizes = false,
  onShelterClick,
  onIncidentClick,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const lib = useRef<MapLib | null>(null);
  const shelterMarkers = useRef(new Map<string, MLMarker>());
  const incidentMarkers = useRef(new Map<string, MLMarker>());
  const meMarker = useRef<MLMarker | null>(null);
  const handlers = useRef({ onShelterClick, onIncidentClick });
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    handlers.current = { onShelterClick, onIncidentClick };
  });

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    const markersS = shelterMarkers.current;
    const markersI = incidentMarkers.current;
    loadLib()
      .then((m) => {
        if (cancelled || !container.current) return;
        lib.current = m;
        const instance = new m.Map({
          container: container.current,
          style: STYLE_URL,
          center: [OTTAWA_CENTER.lng, OTTAWA_CENTER.lat],
          zoom,
          attributionControl: { compact: true },
          interactive,
          fadeDuration: 0,
        });
        if (interactive) instance.addControl(new m.NavigationControl({ showCompass: false }), "bottom-right");
        instance.on("load", () => {
          instance.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
          instance.addLayer({
            id: "route-casing",
            type: "line",
            source: "route",
            paint: { "line-color": "#05070a", "line-width": 9, "line-opacity": 0.8 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          instance.addLayer({
            id: "route",
            type: "line",
            source: "route",
            paint: { "line-color": "#6fd3ff", "line-width": 5 },
            layout: { "line-cap": "round", "line-join": "round" },
          });
          setReady(true);
        });
        instance.on("error", (e) => {
          // Tile fetch failures offline are expected; only a missing style is fatal.
          if (!instance.isStyleLoaded() && String(e.error?.message ?? "").includes("style")) setFailed(true);
        });
        map.current = instance;
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      markersS.forEach((mk) => mk.remove());
      markersI.forEach((mk) => mk.remove());
      markersS.clear();
      markersI.clear();
      meMarker.current?.remove();
      meMarker.current = null;
      map.current?.remove();
      map.current = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once
  }, []);

  // Shelter markers
  useEffect(() => {
    const m = lib.current;
    const instance = map.current;
    if (!ready || !m || !instance) return;
    const seen = new Set<string>();
    for (const s of shelters ?? []) {
      seen.add(s.id);
      let marker = shelterMarkers.current.get(s.id);
      if (!marker) {
        const el = markerRoot("button");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const current = shelterMarkers.current.get(s.id) as MLMarker & { __data?: Shelter };
          if (current?.__data) handlers.current.onShelterClick?.(current.__data);
        });
        marker = new m.Marker({ element: el }).setLngLat([s.lng, s.lat]).addTo(instance);
        shelterMarkers.current.set(s.id, marker);
      }
      (marker as MLMarker & { __data?: Shelter }).__data = s;
      marker.setLngLat([s.lng, s.lat]);
      renderShelter(marker.getElement(), s, s.id === selectedShelterId, showSizes);
    }
    for (const [id, marker] of shelterMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        shelterMarkers.current.delete(id);
      }
    }
  }, [ready, shelters, selectedShelterId, showSizes]);

  // Incident markers
  useEffect(() => {
    const m = lib.current;
    const instance = map.current;
    if (!ready || !m || !instance) return;
    const seen = new Set<string>();
    for (const i of incidents ?? []) {
      seen.add(i.id);
      let marker = incidentMarkers.current.get(i.id);
      if (!marker) {
        const el = markerRoot("div");
        el.addEventListener("click", (ev) => {
          ev.stopPropagation();
          const current = incidentMarkers.current.get(i.id) as MLMarker & { __data?: Incident };
          if (current?.__data) handlers.current.onIncidentClick?.(current.__data);
        });
        marker = new m.Marker({ element: el }).setLngLat([i.lng, i.lat]).addTo(instance);
        incidentMarkers.current.set(i.id, marker);
      }
      (marker as MLMarker & { __data?: Incident }).__data = i;
      renderIncident(marker.getElement(), i, i.id === selectedIncidentId);
    }
    for (const [id, marker] of incidentMarkers.current) {
      if (!seen.has(id)) {
        marker.remove();
        incidentMarkers.current.delete(id);
      }
    }
  }, [ready, incidents, selectedIncidentId]);

  // Own position
  useEffect(() => {
    const m = lib.current;
    const instance = map.current;
    if (!ready || !m || !instance) return;
    if (!me) {
      meMarker.current?.remove();
      meMarker.current = null;
      return;
    }
    if (!meMarker.current) {
      const el = markerRoot("div");
      const dot = el.firstElementChild as HTMLElement;
      dot.className = "relative size-5";
      dot.innerHTML =
        '<span class="absolute -inset-3 rounded-full bg-ice/20 animate-ping-slow"></span><span class="absolute inset-0 rounded-full border-[3px] border-white bg-[#3b82f6] shadow-[0_0_14px_rgba(59,130,246,0.9)]"></span>';
      el.title = "You";
      meMarker.current = new m.Marker({ element: el }).setLngLat([me.lng, me.lat]).addTo(instance);
    } else {
      meMarker.current.setLngLat([me.lng, me.lat]);
    }
  }, [ready, me]);

  // Route line
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance) return;
    const src = instance.getSource("route") as { setData?: (d: GeoJSON.GeoJSON) => void } | undefined;
    src?.setData?.({
      type: "FeatureCollection",
      features: route?.length
        ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route } }]
        : [],
    });
  }, [ready, route]);

  // Fly to focus
  useEffect(() => {
    const instance = map.current;
    if (!ready || !instance || !focus) return;
    instance.flyTo({ center: [focus.point.lng, focus.point.lat], zoom: focus.zoom ?? 15, speed: 1.6, essential: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on focus.key
  }, [ready, focus?.key]);

  // Fit bounds
  useEffect(() => {
    const m = lib.current;
    const instance = map.current;
    if (!ready || !m || !instance || !fit || fit.points.length === 0) return;
    if (fit.points.length === 1) {
      instance.flyTo({ center: [fit.points[0].lng, fit.points[0].lat], zoom: 14.5 });
      return;
    }
    const b = new m.LngLatBounds();
    fit.points.forEach((p) => b.extend([p.lng, p.lat]));
    instance.fitBounds(b, { padding: 64, maxZoom: 15.5, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on fit.key
  }, [ready, fit?.key]);

  return (
    // Only default to `relative` when the caller didn't position the map; both classes together
    // resolve by stylesheet order, not class order, and `relative` would collapse an inset map.
    <div className={cn("overflow-hidden bg-deep", !/\b(absolute|fixed)\b/.test(className ?? "") && "relative", className)}>
      {/* Inline style: maplibre-gl.css forces `.maplibregl-map { position: relative }`, which would collapse a class-based inset. */}
      <div ref={container} style={{ position: "absolute", inset: 0 }} />
      {!ready && !failed && <div className="grid-field absolute inset-0 animate-pulse" aria-hidden />}
      {failed && (
        <div className="grid-field absolute inset-0 flex items-center justify-center text-center text-xs text-muted">
          Basemap unavailable offline — positions still update below.
        </div>
      )}
    </div>
  );
}
