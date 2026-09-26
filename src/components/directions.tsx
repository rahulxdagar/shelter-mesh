"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpLeft, ArrowUpRight, CornerDownLeft, CornerDownRight, ExternalLink, Flag,
  Footprints, LoaderCircle, RotateCw, TriangleAlert,
} from "lucide-react";
import { TacticalMap } from "./tactical-map";
import { fetchRoute, type RouteResult, type RouteStep } from "@/lib/routing";
import { formatDistance, formatDuration, type LatLng } from "@/lib/geo";

function StepIcon({ step }: { step: RouteStep }) {
  const cls = "size-4";
  if (step.type === "arrive") return <Flag className={cls} />;
  if (step.type === "roundabout" || step.type === "rotary") return <RotateCw className={cls} />;
  switch (step.modifier) {
    case "left": return <ArrowLeft className={cls} />;
    case "right": return <ArrowRight className={cls} />;
    case "slight left": return <ArrowUpLeft className={cls} />;
    case "slight right": return <ArrowUpRight className={cls} />;
    case "sharp left": return <CornerDownLeft className={cls} />;
    case "sharp right": return <CornerDownRight className={cls} />;
    default: return <ArrowUp className={cls} />;
  }
}

export function osmDirectionsUrl(from: LatLng, to: LatLng, profile: "foot" | "car" = "foot") {
  const engine = profile === "foot" ? "fossgis_osrm_foot" : "fossgis_osrm_car";
  return `https://www.openstreetmap.org/directions?engine=${engine}&route=${from.lat},${from.lng};${to.lat},${to.lng}`;
}

/** Turn-by-turn walking directions with a route preview map. */
export function Directions({ from, to, profile = "foot" }: { from: LatLng; to: LatLng; profile?: "foot" | "car" }) {
  const requestKey = `${profile}:${from.lat},${from.lng}->${to.lat},${to.lng}`;
  const [result, setResult] = useState<{ key: string; route: RouteResult | null; error: string | null } | null>(null);
  // Results for a previous origin/destination are ignored until the new request lands.
  const route = result?.key === requestKey ? result.route : null;
  const error = result?.key === requestKey ? result.error : null;

  useEffect(() => {
    let active = true;
    fetchRoute(from, to, profile)
      .then((r) => active && setResult({ key: requestKey, route: r, error: null }))
      .catch((e: Error) => active && setResult({ key: requestKey, route: null, error: e.message }));
    return () => {
      active = false;
    };
  }, [requestKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="mt-3 overflow-hidden rounded-xl border border-line bg-deep">
        <TacticalMap
          className="h-44"
          me={from}
          route={route?.geometry ?? [[from.lng, from.lat], [to.lng, to.lat]]}
          fit={{ points: [from, to], key: `${from.lat},${from.lng}->${to.lat},${to.lng}` }}
          interactive={false}
        />
        <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <Footprints className="size-4 text-ice" />
            {route ? (
              <span className="font-semibold tabular">
                {formatDuration(route.duration_s)} · {formatDistance(route.distance_m)}
              </span>
            ) : error ? (
              <span className="text-muted">Route unavailable</span>
            ) : (
              <span className="flex items-center gap-2 text-muted">
                <LoaderCircle className="size-3.5 animate-spin" /> Routing…
              </span>
            )}
          </div>
          <a
            href={osmDirectionsUrl(from, to, profile)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1 text-xs font-semibold text-ice hover:underline"
          >
            Open in maps <ExternalLink className="size-3" />
          </a>
        </div>
        {error && (
          <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-caution">
            <TriangleAlert className="size-3.5" /> {error}. Straight-line shown.
          </div>
        )}
        {route && route.steps.length > 0 && (
          <ol className="scrollbar-thin max-h-56 divide-y divide-line overflow-y-auto border-t border-line">
            {route.steps.map((s, i) => (
              <li key={i} className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-raised text-ink-2">
                  <StepIcon step={s} />
                </span>
                <span className="min-w-0 flex-1 text-sm text-ink">{s.text}</span>
                {s.distance_m > 0 && (
                  <span className="shrink-0 font-mono text-xs text-muted">{formatDistance(s.distance_m)}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </motion.div>
  );
}
