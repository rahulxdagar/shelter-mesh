"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Armchair, BedDouble, Building, Clock, Info, Radio, Siren, Snowflake, TriangleAlert } from "lucide-react";
import { useRequireRole } from "@/components/auth-provider";
import { FullscreenLoader, TopBar } from "@/components/app-shell";
import { TacticalMap } from "@/components/tactical-map";
import { Badge, EmptyState, Meter, Panel, PanelHeader } from "@/components/ui";
import { KindBadge } from "@/components/shelter-bits";
import { useAlerts, useHolds, useIncidents, useNow, useShelters, useSystemState } from "@/hooks/use-live";
import { supabase } from "@/lib/supabase";
import { cn, pct, timeAgo } from "@/lib/format";
import { INCIDENT_LABEL, type AppRole, type Shelter } from "@/lib/types";
import { CodeFrostBanner } from "./code-frost-banner";

const ROLES: AppRole[] = ["city_ops"];
const CLOSED = new Set(["RESOLVED", "FALSE_ALARM"]);

export default function OpsPage() {
  const profile = useRequireRole(ROLES);
  if (!profile) return <FullscreenLoader />;
  return <Command />;
}

function Command() {
  const now = useNow();
  const shelters = useShelters("ops-shelters");
  const { state } = useSystemState();
  const alerts = useAlerts("ops-alerts", 40);
  const holds = useHolds({
    channel: "ops-holds",
    load: () => supabase().from("bed_holds").select("*").eq("status", "HELD"),
    keep: (h) => h.status === "HELD",
  });
  const incidents = useIncidents({ channel: "ops-incidents", keep: (i) => !CLOSED.has(i.status) });
  const [selected, setSelected] = useState<string | null>(null);

  const network = useMemo(() => shelters.rows.filter((s) => s.is_active && s.kind !== "warming_hub"), [shelters.rows]);
  const hubs = useMemo(() => shelters.rows.filter((s) => s.kind === "warming_hub"), [shelters.rows]);
  const totals = useMemo(() => {
    const t = { beds: 0, open: 0, chairs: 0, chairsOpen: 0 };
    for (const s of network) {
      t.beds += s.total_beds;
      t.open += s.available_beds;
      t.chairs += s.total_chairs;
      t.chairsOpen += s.available_chairs;
    }
    return t;
  }, [network]);
  const occupancy = pct(totals.beds - totals.open, totals.beds);
  const hubOpen = hubs.filter((h) => h.is_active).reduce((n, h) => n + h.available_beds, 0);

  const byOperator = useMemo(() => {
    const m = new Map<string, { beds: number; open: number; sites: number }>();
    for (const s of network) {
      const g = m.get(s.operator) ?? { beds: 0, open: 0, sites: 0 };
      g.beds += s.total_beds;
      g.open += s.available_beds;
      g.sites += 1;
      m.set(s.operator, g);
    }
    return [...m.entries()].map(([name, g]) => ({ name, ...g, occ: pct(g.beds - g.open, g.beds) })).sort((a, b) => b.occ - a.occ);
  }, [network]);

  const sel = shelters.rows.find((s) => s.id === selected) ?? null;

  return (
    <div className="min-h-dvh bg-void">
      <TopBar />
      <main className="mx-auto max-w-[1600px] space-y-4 p-4">
        <CodeFrostBanner state={state} hubCount={hubs.length} now={now} />

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Network occupancy" value={`${occupancy.toFixed(1)}%`} tone={occupancy >= 99 ? "alarm" : occupancy >= 95 ? "caution" : "ink"} meter={occupancy} />
          <Stat label="Open beds" value={totals.open} sub={`of ${totals.beds} across ${network.length} sites`} icon={<BedDouble className="size-4" />} />
          <Stat label="Warming chairs" value={totals.chairsOpen} sub={`of ${totals.chairs}`} icon={<Armchair className="size-4" />} />
          <Stat label="Holds in transit" value={holds.rows.length} sub="20-min soft locks" icon={<Clock className="size-4" />} />
          <Stat
            label="Overdose pins"
            value={incidents.rows.length}
            sub={`${incidents.rows.filter((i) => i.status === "ACTIVE").length} awaiting EMS`}
            tone={incidents.rows.some((i) => i.status === "ACTIVE") ? "alarm" : "ink"}
            icon={<Siren className="size-4" />}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Panel className="overflow-hidden">
            <PanelHeader
              title="Municipal capacity map"
              meta={
                <span className="flex items-center gap-3">
                  <Legend className="bg-go" label="Open" />
                  <Legend className="bg-caution" label="≤3 beds" />
                  <Legend className="bg-alarm" label="Full" />
                  <Legend className="bg-frost" label="Hub" />
                </span>
              }
            />
            <div className="relative h-[520px]">
              <TacticalMap
                className="absolute inset-0"
                shelters={shelters.rows}
                incidents={incidents.rows}
                selectedShelterId={selected}
                onShelterClick={(s) => setSelected(s.id)}
                showSizes
                zoom={11.6}
                fit={shelters.rows.length ? { points: shelters.rows, key: `all-${shelters.rows.length}` } : null}
              />
              {sel && <ShelterCard s={sel} onClose={() => setSelected(null)} now={now} />}
            </div>
          </Panel>

          <div className="space-y-4">
            <Panel>
              <PanelHeader title="Capacity by organization" meta="0–100%" icon={<Building className="size-4" />} />
              <div className="space-y-3 p-4">
                {byOperator.map((o) => (
                  <div key={o.name}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-semibold">{o.name}</span>
                      <span className="shrink-0 font-mono text-xs text-ink-2">
                        {o.occ.toFixed(1)}% · <span className="text-muted">{o.open} open</span>
                      </span>
                    </div>
                    <Meter value={o.occ} />
                  </div>
                ))}
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                title="Emergency warming hubs"
                icon={<Snowflake className="size-4" />}
                meta={state?.warming_hubs_authorized ? <Badge tone="frost">Open · {hubOpen} cots</Badge> : <Badge>Standby</Badge>}
              />
              <div className="divide-y divide-line">
                {hubs.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={cn("size-2 rounded-full", h.is_active ? "bg-frost shadow-[0_0_8px_var(--color-frost)]" : "bg-faint")} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{h.name.replace(" Warming Hub", "")}</div>
                      <div className="truncate text-xs text-muted">{h.address}</div>
                    </div>
                    <span className="font-mono text-xs text-ink-2">
                      {h.is_active ? `${h.available_beds}/${h.total_beds}` : `${h.total_beds} cots`}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <Panel>
            <PanelHeader title="Facility telemetry" meta="Live" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                    <th className="px-4 py-2.5 font-semibold">Facility</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Beds open</th>
                    <th className="w-[30%] px-4 py-2.5 font-semibold">Occupancy</th>
                    <th className="px-4 py-2.5 text-right font-semibold">In transit</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Chairs</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {shelters.rows
                    .filter((s) => s.kind !== "warming_hub" || s.is_active)
                    .map((s) => {
                      const occ = pct(s.total_beds - s.available_beds, s.total_beds);
                      const transit = holds.rows.filter((h) => h.shelter_id === s.id).length;
                      return (
                        <tr
                          key={s.id}
                          onClick={() => setSelected(s.id)}
                          className={cn("cursor-pointer border-b border-line last:border-0 hover:bg-raised/50", selected === s.id && "bg-ice-dim/20")}
                        >
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold">{s.name}</span>
                              <KindBadge kind={s.kind} />
                            </div>
                            <div className="text-xs text-muted">{s.operator}</div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className={cn("font-mono font-semibold", s.available_beds === 0 ? "text-alarm" : s.available_beds <= 3 ? "text-caution" : "text-go")}>
                              {s.available_beds}
                            </span>
                            <span className="font-mono text-xs text-muted"> / {s.total_beds}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <Meter value={occ} className="flex-1" />
                              <span className="w-12 text-right font-mono text-xs">{occ.toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">{transit || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-2">
                            {s.total_chairs ? `${s.available_chairs}/${s.total_chairs}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-muted">{now ? timeAgo(s.updated_at, now) : ""}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Command feed" icon={<Radio className="size-4" />} />
            <div className="scrollbar-thin max-h-[420px] divide-y divide-line overflow-y-auto">
              {incidents.rows.map((i) => (
                <div key={i.id} className="flex items-center gap-3 px-4 py-3">
                  <Siren className={cn("size-4 shrink-0", i.status === "ACTIVE" ? "text-alarm" : "text-caution")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">Overdose pin · {i.address ?? `${i.lat.toFixed(4)}, ${i.lng.toFixed(4)}`}</div>
                    <div className="text-xs text-muted">{now ? timeAgo(i.created_at, now) : ""}</div>
                  </div>
                  <Badge tone={i.status === "ACTIVE" ? "alarm" : "caution"}>{INCIDENT_LABEL[i.status]}</Badge>
                </div>
              ))}
              {alerts.rows.map((a) => (
                <div key={a.id} className="flex gap-3 px-4 py-3">
                  {a.severity === "critical" ? (
                    <Snowflake className="mt-0.5 size-4 shrink-0 text-frost" />
                  ) : a.severity === "warning" ? (
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-caution" />
                  ) : (
                    <Info className="mt-0.5 size-4 shrink-0 text-ink-2" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{a.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{now ? timeAgo(a.created_at, now) : ""}</span>
                    </div>
                    <p className="text-xs text-ink-2">{a.body}</p>
                  </div>
                </div>
              ))}
              {incidents.rows.length === 0 && alerts.rows.length === 0 && (
                <EmptyState icon={<Radio className="size-5" />} title="No activity" />
              )}
            </div>
          </Panel>
        </div>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  icon,
  tone = "ink",
  meter,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  tone?: "ink" | "alarm" | "caution";
  meter?: number;
}) {
  return (
    <Panel className="p-4">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label} {icon}
      </div>
      <motion.div
        key={String(value)}
        initial={{ opacity: 0.4, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "mt-2 font-mono text-3xl font-semibold tabular",
          tone === "alarm" ? "text-alarm" : tone === "caution" ? "text-caution" : "text-ink",
        )}
      >
        {value}
      </motion.div>
      {meter !== undefined ? <Meter value={meter} className="mt-3" /> : sub ? <div className="mt-1 text-xs text-muted">{sub}</div> : null}
    </Panel>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} /> {label}
    </span>
  );
}

function ShelterCard({ s, onClose, now }: { s: Shelter; onClose: () => void; now: number }) {
  const occ = pct(s.total_beds - s.available_beds, s.total_beds);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute bottom-3 left-3 w-[320px] rounded-2xl border border-line-strong bg-panel/95 p-4 backdrop-blur"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold">{s.name}</h3>
            <KindBadge kind={s.kind} />
          </div>
          <p className="text-xs text-muted">{s.address}</p>
        </div>
        <button onClick={onClose} className="text-xs text-muted hover:text-ink">
          Close
        </button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg bg-deep p-2">
          <div className="font-mono text-lg font-semibold">{s.is_active ? s.available_beds : "—"}</div>
          <div className="text-[10px] uppercase text-muted">Open</div>
        </div>
        <div className="rounded-lg bg-deep p-2">
          <div className="font-mono text-lg font-semibold">{s.total_beds}</div>
          <div className="text-[10px] uppercase text-muted">Capacity</div>
        </div>
        <div className="rounded-lg bg-deep p-2">
          <div className="font-mono text-lg font-semibold">{s.is_active ? `${occ.toFixed(0)}%` : "—"}</div>
          <div className="text-[10px] uppercase text-muted">Occupied</div>
        </div>
      </div>
      <div className="mt-2 text-[11px] text-muted">
        {s.phone} · updated {now ? timeAgo(s.updated_at, now) : ""}
      </div>
    </motion.div>
  );
}
