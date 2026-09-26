"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Crosshair, Radar, Siren } from "lucide-react";
import { toast } from "sonner";
import { useRequireRole } from "@/components/auth-provider";
import { FullscreenLoader, TopBar } from "@/components/app-shell";
import { FrostNotice } from "@/components/frost-notice";
import { TacticalMap, type MapFocus } from "@/components/tactical-map";
import { Badge } from "@/components/ui";
import { useIncidents, useNow } from "@/hooks/use-live";
import { useGeolocation } from "@/hooks/use-geolocation";
import { cn, timeAgo } from "@/lib/format";
import { formatDistance, formatDuration, haversineMeters } from "@/lib/geo";
import { INCIDENT_LABEL, type AppRole, type Incident, type Profile } from "@/lib/types";
import { IncidentDrawer } from "./incident-drawer";

const ROLES: AppRole[] = ["ems"];
const CLOSED = new Set(["RESOLVED", "FALSE_ALARM"]);
/** Urban response speed used for list ETAs until a road route is computed. */
const EST_KMH = 40;

export default function EmsPage() {
  const profile = useRequireRole(ROLES);
  if (!profile) return <FullscreenLoader />;
  return <Console profile={profile} />;
}

function alarmTone() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "square";
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    [0, 0.22, 0.44].forEach((d) => {
      o.frequency.setValueAtTime(880, t + d);
      o.frequency.setValueAtTime(660, t + d + 0.11);
    });
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    o.start(t);
    o.stop(t + 0.72);
    o.onended = () => void ctx.close();
  } catch {
    /* audio blocked until the user interacts — vibration and toast still fire */
  }
}

function Console({ profile }: { profile: Profile }) {
  const geo = useGeolocation(true);
  const now = useNow();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [route, setRoute] = useState<[number, number][] | null>(null);
  const [listOpen, setListOpen] = useState(true);
  const selectRef = useRef(setSelectedId);
  const hasSelection = useRef(false);
  useEffect(() => {
    hasSelection.current = selectedId !== null;
  }, [selectedId]);

  const incidents = useIncidents({
    channel: "ems-incidents",
    keep: (i) => !CLOSED.has(i.status),
    onChange: (p) => {
      if (p.eventType !== "INSERT") return;
      const i = p.new as Incident;
      alarmTone();
      try {
        navigator.vibrate?.([200, 100, 200, 100, 400]);
      } catch {
        /* unsupported */
      }
      toast.error("NEW OVERDOSE PIN", {
        description: `${i.reporter_role === "observer" ? "Trusted observer" : "Outreach worker"} · ${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`,
        duration: 10_000,
        action: { label: "View", onClick: () => selectRef.current(i.id) },
      });
      if (!hasSelection.current) {
        selectRef.current(i.id);
        setFocus({ point: i, zoom: 15.5, key: `new-${i.id}` });
      }
    },
  });

  const radiusM = Number(profile.operational_radius_km) * 1000;
  const list = useMemo(() => {
    return incidents.rows
      .map((i) => ({ i, d: geo.fix ? haversineMeters(geo.fix, i) : null }))
      .filter(({ d }) => d === null || d <= radiusM)
      .sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || b.i.created_at.localeCompare(a.i.created_at));
  }, [incidents.rows, geo.fix, radiusM]);

  // A pin closed elsewhere (another unit, or a false alarm) drops out of `rows`, which closes the drawer.
  const selected = incidents.rows.find((i) => i.id === selectedId) ?? null;

  const select = useCallback((i: Incident) => {
    setSelectedId(i.id);
    setFocus({ point: i, zoom: 15.5, key: `${i.id}-${Date.now()}` });
  }, []);

  const activeCount = list.filter(({ i }) => i.status === "ACTIVE").length;

  return (
    <div className="flex h-dvh flex-col bg-void">
      <TopBar title={`EMS · ${profile.callsign ?? "Unit"}`} />
      <div className="relative min-h-0 flex-1">
        <TacticalMap
          className="absolute inset-0"
          incidents={list.map(({ i }) => i)}
          me={geo.fix}
          route={selected ? route : null}
          selectedIncidentId={selected?.id ?? null}
          focus={focus}
          fit={geo.fix ? { points: [geo.fix], key: "me" } : null}
          onIncidentClick={select}
        />

        {/* Radar status */}
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-3 rounded-2xl border border-line bg-void/85 p-2.5 pr-4 backdrop-blur">
          <div className="relative size-12 overflow-hidden rounded-full border border-go/30 bg-go-dim/40">
            <div className="absolute inset-0 animate-[spin_3s_linear_infinite] bg-[conic-gradient(from_0deg,transparent_0deg,rgb(52_211_153/0.45)_40deg,transparent_60deg)]" />
            <div className="absolute inset-[30%] rounded-full border border-go/30" />
            <span className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-go" />
          </div>
          <div>
            <div className="font-mono text-2xl font-semibold leading-none text-ink">{activeCount}</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
              Active · {profile.operational_radius_km} km radius
            </div>
          </div>
        </div>

        {/* Incident list */}
        <div className="absolute left-3 top-3 w-[min(360px,calc(100%-7.5rem))] md:w-[360px]">
          <div className="overflow-hidden rounded-2xl border border-line bg-void/90 backdrop-blur-xl">
            <button
              className="flex w-full items-center justify-between gap-2 border-b border-line px-3.5 py-2.5"
              onClick={() => setListOpen((v) => !v)}
            >
              <span className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-2">
                <Radar className="size-4 text-go" /> Tactical radar
              </span>
              <span className="text-xs text-muted">{listOpen ? "Hide" : `${list.length} open`}</span>
            </button>
            <AnimatePresence initial={false}>
              {listOpen && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                  {!geo.fix && (
                    <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-xs text-caution">
                      <Crosshair className="size-3.5" /> {geo.error ?? "Waiting for unit GPS — showing all pins"}
                    </div>
                  )}
                  <div className="scrollbar-thin max-h-[42dvh] overflow-y-auto">
                    {list.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-muted">No open incidents in range</div>
                    ) : (
                      <AnimatePresence initial={false}>
                        {list.map(({ i, d }) => (
                          <motion.button
                            key={i.id}
                            layout
                            initial={{ opacity: 0, x: -12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -12, height: 0 }}
                            onClick={() => select(i)}
                            className={cn(
                              "flex w-full items-center gap-3 border-b border-line px-3.5 py-3 text-left transition-colors last:border-0",
                              selectedId === i.id ? "bg-alarm-dim/60" : "hover:bg-raised",
                            )}
                          >
                            <span className="relative flex size-9 shrink-0 items-center justify-center">
                              {i.status === "ACTIVE" && <span className="absolute inset-0 animate-ping rounded-full bg-alarm/40" />}
                              <span
                                className={cn(
                                  "relative flex size-9 items-center justify-center rounded-full",
                                  i.status === "ACTIVE" ? "bg-alarm text-white" : i.status === "EN_ROUTE" ? "bg-caution text-void" : "bg-ice text-void",
                                )}
                              >
                                <Siren className="size-4" />
                              </span>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-semibold">{i.address ?? `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`}</span>
                              <span className="block text-xs text-muted">{now ? timeAgo(i.created_at, now) : ""}</span>
                            </span>
                            <span className="shrink-0 text-right">
                              {d !== null ? (
                                <>
                                  <span className="block font-mono text-sm font-semibold">{formatDistance(d)}</span>
                                  <span className="block font-mono text-[11px] text-muted">~{formatDuration((d / 1000 / EST_KMH) * 3600)}</span>
                                </>
                              ) : (
                                <Badge tone={i.status === "ACTIVE" ? "alarm" : "caution"}>{INCIDENT_LABEL[i.status]}</Badge>
                              )}
                            </span>
                          </motion.button>
                        ))}
                      </AnimatePresence>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <FrostNotice className="mt-3 hidden md:block" />
        </div>

        <IncidentDrawer
          incident={selected}
          me={geo.fix}
          onClose={() => {
            setSelectedId(null);
            setRoute(null);
          }}
          onRoute={setRoute}
        />
      </div>
    </div>
  );
}
