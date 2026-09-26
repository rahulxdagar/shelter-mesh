"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, LoaderCircle, RefreshCw, ShieldCheck, Snowflake, Thermometer, TriangleAlert, Users, Wind } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { rpc } from "@/lib/errors";
import { clockTime, cn, timeAgo } from "@/lib/format";
import type { SystemState } from "@/lib/types";

function nextQuarterHour(now: number) {
  const d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15 + 15);
  return d;
}

const MODES: { id: SystemState["frost_mode"]; label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "force_on", label: "Force on" },
  { id: "force_off", label: "Force off" },
];

export function CodeFrostBanner({ state, hubCount, now }: { state: SystemState | null; hubCount: number; now: number }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function call(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast.success(ok);
    } catch (err) {
      toast.error("Action failed", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (!state) return <div className="h-40 animate-pulse rounded-2xl border border-line bg-panel" />;

  const wc = state.windchill_c != null ? Number(state.windchill_c) : null;
  const occ = state.network_occupancy_pct != null ? Number(state.network_occupancy_pct) : null;
  const wcThr = Number(state.windchill_threshold_c);
  const occThr = Number(state.occupancy_threshold_pct);
  const coldMet = wc !== null && wc <= wcThr;
  const fullMet = occ !== null && occ >= occThr;
  const active = state.code_frost;

  return (
    <motion.section
      layout
      className={cn(
        "relative overflow-hidden rounded-2xl border",
        active ? "border-frost/50 bg-gradient-to-br from-[#0f2d42] via-[#0a1d2b] to-[#07131c]" : "border-line bg-panel",
      )}
    >
      <AnimatePresence>
        {active && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0">
            <Snowflake className="absolute -right-10 -top-10 size-64 animate-[spin_40s_linear_infinite] text-frost/[0.07]" />
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-frost to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative grid gap-5 p-5 lg:grid-cols-[1.2fr_1fr_auto] lg:items-center">
        <div>
          <div className={cn("flex items-center gap-2 text-sm font-bold uppercase tracking-[0.14em]", active ? "text-frost" : "text-ink-2")}>
            <Snowflake className={cn("size-5", active && "animate-[spin_8s_linear_infinite]")} />
            {active ? "Code Frost active" : "Code Frost · monitoring"}
            {state.frost_mode !== "auto" && (
              <span className="rounded-md border border-caution/40 bg-caution-dim px-1.5 py-0.5 text-[10px] text-caution">Manual override</span>
            )}
          </div>
          <p className={cn("mt-2 max-w-xl text-sm", active ? "text-ink" : "text-muted")}>
            {active
              ? `Declared ${state.frost_activated_at ? clockTime(state.frost_activated_at) : ""}. Wind chill and shelter saturation have crossed municipal thresholds. Authorize emergency warming hubs to open overflow capacity to outreach teams.`
              : `Evaluated every 15 minutes: activates when Ottawa wind chill ≤ ${wcThr}°C and network occupancy ≥ ${occThr}%.`}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>Last check {state.last_evaluated_at && now ? timeAgo(state.last_evaluated_at, now) : "—"}</span>
            <span>·</span>
            <span>Next {now ? clockTime(nextQuarterHour(now).toISOString()) : "—"}</span>
            {state.last_error && (
              <span className="flex items-center gap-1 text-caution">
                <TriangleAlert className="size-3" /> {state.last_error}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Threshold
            icon={<Thermometer className="size-4" />}
            label="Wind chill"
            value={wc !== null ? `${wc.toFixed(1)}°` : "—"}
            target={`≤ ${wcThr}°C`}
            met={coldMet}
            sub={
              state.temperature_c != null ? (
                <span className="flex items-center gap-1">
                  {Number(state.temperature_c).toFixed(1)}° air · <Wind className="size-3" /> {Number(state.wind_kmh ?? 0).toFixed(0)} km/h
                </span>
              ) : null
            }
          />
          <Threshold
            icon={<Users className="size-4" />}
            label="Network occupancy"
            value={occ !== null ? `${occ.toFixed(1)}%` : "—"}
            target={`≥ ${occThr}%`}
            met={fullMet}
          />
        </div>

        <div className="flex flex-col gap-2 lg:w-[250px]">
          {active ? (
            state.warming_hubs_authorized ? (
              <Button
                tone="neutral"
                size="lg"
                loading={busy === "hubs"}
                icon={<ShieldCheck className="size-4 text-go" />}
                onClick={() => void call("hubs", () => rpc(supabase().rpc("authorize_warming_hubs", { p_authorize: false })), "Warming hubs stood down")}
              >
                Hubs open · stand down
              </Button>
            ) : (
              <Button
                tone="frost"
                size="lg"
                loading={busy === "hubs"}
                icon={<Flame className="size-4" />}
                onClick={() => void call("hubs", () => rpc(supabase().rpc("authorize_warming_hubs", { p_authorize: true })), `${hubCount} warming hubs authorized`)}
              >
                Authorize {hubCount} warming hubs
              </Button>
            )
          ) : (
            <Button tone="neutral" size="lg" disabled icon={<Flame className="size-4" />}>
              Hubs locked until Code Frost
            </Button>
          )}
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-deep p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                disabled={busy !== null}
                onClick={() =>
                  m.id !== state.frost_mode &&
                  void call("mode", () => rpc(supabase().rpc("set_frost_mode", { p_mode: m.id })), `Code Frost mode: ${m.label}`)
                }
                className={cn(
                  "h-8 rounded-lg text-xs font-semibold transition-colors",
                  state.frost_mode === m.id ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "text-muted hover:text-ink",
                )}
              >
                {busy === "mode" && state.frost_mode !== m.id ? <LoaderCircle className="mx-auto size-3 animate-spin" /> : m.label}
              </button>
            ))}
          </div>
          <Button
            tone="ghost"
            size="sm"
            loading={busy === "eval"}
            icon={<RefreshCw className="size-3.5" />}
            onClick={() => void call("eval", () => rpc(supabase().rpc("refresh_code_frost")), "Conditions re-evaluated")}
          >
            Re-evaluate now
          </Button>
        </div>
      </div>
    </motion.section>
  );
}

function Threshold({
  icon,
  label,
  value,
  target,
  met,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  target: string;
  met: boolean;
  sub?: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-xl border p-3", met ? "border-frost/50 bg-frost/10" : "border-line bg-deep/60")}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">
        {icon} {label}
      </div>
      <div className={cn("mt-1 font-mono text-2xl font-semibold tabular", met ? "text-frost" : "text-ink")}>{value}</div>
      <div className="mt-0.5 flex items-center justify-between text-[11px]">
        <span className={met ? "font-semibold text-frost" : "text-muted"}>{met ? "Threshold met" : `Trigger ${target}`}</span>
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}
