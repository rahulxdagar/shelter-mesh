"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Armchair, BedDouble, CircleCheck, Inbox, Minus, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useRequireRole } from "@/components/auth-provider";
import { FullscreenLoader, TopBar } from "@/components/app-shell";
import { FrostNotice } from "@/components/frost-notice";
import { Countdown } from "@/components/countdown";
import { Badge, Button, EmptyState, Meter, Panel, PanelHeader, Skeleton } from "@/components/ui";
import { KindBadge } from "@/components/shelter-bits";
import { useHolds, useNow, useShelters } from "@/hooks/use-live";
import { adjustInventory, cancelHold, checkInHold, expireHolds } from "@/lib/actions";
import { supabase } from "@/lib/supabase";
import { clockTime, cn, pct, timeAgo } from "@/lib/format";
import { GENDER_LABEL, NEED_LABEL, SOBRIETY_LABEL, type AppRole, type BedHold, type Shelter } from "@/lib/types";
import { WalkInReroute } from "./walk-in-reroute";

const ROLES: AppRole[] = ["shelter_staff"];

export default function ShelterPage() {
  const profile = useRequireRole(ROLES);
  if (!profile?.shelter_id) return <FullscreenLoader />;
  return <ShelterDesk shelterId={profile.shelter_id} />;
}

function ShelterDesk({ shelterId }: { shelterId: string }) {
  const shelters = useShelters("desk-shelters");
  const now = useNow();
  const [since] = useState(() => new Date(Date.now() - 12 * 3_600_000).toISOString());
  const mine = shelters.rows.find((s) => s.id === shelterId) ?? null;
  const mineRef = useRef(mine);
  useEffect(() => {
    mineRef.current = mine;
  });

  const holds = useHolds({
    channel: "desk-holds",
    load: () =>
      supabase()
        .from("bed_holds")
        .select("*")
        .or(`shelter_id.eq.${shelterId},origin_shelter_id.eq.${shelterId}`)
        .gte("created_at", since)
        .order("created_at", { ascending: false }),
    keep: (h) => h.shelter_id === shelterId || h.origin_shelter_id === shelterId,
    onChange: (p) => {
      const h = p.new as BedHold;
      if (p.eventType === "INSERT" && h.shelter_id === shelterId) {
        try {
          navigator.vibrate?.(80);
        } catch {
          /* unsupported */
        }
        toast.info(`Incoming referral · ${h.client_label}`, {
          description: `${h.referrer} is sending a client. Hold expires in ${h.held_minutes}:00.`,
        });
      }
    },
  });

  const incoming = holds.rows
    .filter((h) => h.shelter_id === shelterId && h.status === "HELD")
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const recent = holds.rows.filter(
    (h) => h.shelter_id === shelterId && h.status !== "HELD" && h.resolved_at && now - new Date(h.resolved_at).getTime() < 60 * 60_000,
  );

  const refetchHolds = holds.refetch;
  const onZero = useCallback(() => {
    void expireHolds()
      .catch(() => undefined)
      .finally(() => void refetchHolds());
  }, [refetchHolds]);

  const adjust = useCallback(
    async (resource: "beds" | "chairs", delta: number) => {
      const s = mineRef.current;
      if (!s) return;
      const key = resource === "beds" ? "available_beds" : "available_chairs";
      const totalKey = resource === "beds" ? "total_beds" : "total_chairs";
      const next = s[key] + delta;
      if (next < 0 || next > s[totalKey]) return;
      // Optimistic: flip the number instantly, reconcile with the server's row.
      shelters.setRows((rows) => rows.map((r) => (r.id === s.id ? { ...r, [key]: next } : r)));
      try {
        await adjustInventory(s.id, resource, delta);
      } catch (err) {
        toast.error("Update rejected", { description: (err as Error).message });
        void shelters.refetch();
      }
    },
    [shelters],
  );

  if (!mine) {
    return (
      <div className="min-h-dvh bg-void">
        <TopBar />
        <div className="mx-auto grid max-w-[1400px] gap-4 p-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  const partners = shelters.rows.filter((s) => s.kind !== "warming_hub" || s.is_active);

  return (
    <div className="min-h-dvh bg-void">
      <TopBar title={mine.name} />
      <main className="mx-auto max-w-[1400px] space-y-4 p-4">
        <FrostNotice />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="min-w-0 space-y-4">
            {/* Capacity telemetry */}
            <div className="grid gap-4 md:grid-cols-2">
              <CapacityTile
                icon={<BedDouble className="size-5" />}
                label="Beds available"
                available={mine.available_beds}
                total={mine.total_beds}
                held={incoming.length}
                onAdjust={(d) => void adjust("beds", d)}
              />
              <CapacityTile
                icon={<Armchair className="size-5" />}
                label="Warming chairs"
                available={mine.available_chairs}
                total={mine.total_chairs}
                onAdjust={(d) => void adjust("chairs", d)}
              />
            </div>

            {/* Incoming referral queue */}
            <Panel>
              <PanelHeader
                icon={<Inbox className="size-4" />}
                title="Incoming referrals · in transit"
                meta={<span className="font-mono">{incoming.length} active</span>}
              />
              {holds.loading ? (
                <div className="space-y-2 p-4">
                  <Skeleton className="h-14" />
                  <Skeleton className="h-14" />
                </div>
              ) : incoming.length === 0 ? (
                <EmptyState icon={<Inbox className="size-5" />} title="No clients in transit" body="Holds placed by outreach teams appear here instantly with a synced countdown." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                        <th className="px-4 py-2.5 font-semibold">Hold</th>
                        <th className="px-4 py-2.5 font-semibold">Client</th>
                        <th className="px-4 py-2.5 font-semibold">Flags</th>
                        <th className="px-4 py-2.5 font-semibold">Referred by</th>
                        <th className="px-4 py-2.5 text-right font-semibold">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <AnimatePresence initial={false}>
                        {incoming.map((h) => (
                          <ReferralRow key={h.id} hold={h} onZero={onZero} />
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              )}
              {recent.length > 0 && (
                <div className="border-t border-line px-4 py-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Last hour</div>
                  <div className="flex flex-wrap gap-2">
                    {recent.map((h) => (
                      <span
                        key={h.id}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs",
                          h.status === "CHECKED_IN" ? "border-go/30 text-go" : h.status === "EXPIRED" ? "border-alarm/30 text-alarm" : "border-line text-muted",
                        )}
                      >
                        {h.client_label} · {h.status === "CHECKED_IN" ? "checked in" : h.status === "EXPIRED" ? "expired" : "released"}{" "}
                        {clockTime(h.resolved_at!)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Panel>

            {/* Partner network */}
            <Panel>
              <PanelHeader title="Partner network capacity" meta="Live across all agencies" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-muted">
                      <th className="px-4 py-2.5 font-semibold">Facility</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Beds open</th>
                      <th className="w-[28%] px-4 py-2.5 font-semibold">Occupancy</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Chairs</th>
                      <th className="px-4 py-2.5 text-right font-semibold">Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partners.map((s) => (
                      <PartnerRow key={s.id} s={s} mine={s.id === shelterId} now={now} />
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <WalkInReroute home={mine} holds={holds.rows} shelters={shelters.rows} atCapacity={mine.available_beds === 0} onZero={onZero} />
        </div>
      </main>
    </div>
  );
}

function CapacityTile({
  icon,
  label,
  available,
  total,
  held,
  onAdjust,
}: {
  icon: React.ReactNode;
  label: string;
  available: number;
  total: number;
  held?: number;
  onAdjust: (delta: number) => void;
}) {
  const occupancy = pct(total - available, total);
  const full = total > 0 && available === 0;
  return (
    <Panel className={cn("p-5", full && "border-alarm/40")}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-2">
          {icon} {label}
        </div>
        {total === 0 ? <Badge>Not offered</Badge> : full ? <Badge tone="alarm">At capacity</Badge> : <Badge tone="go">Open</Badge>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <StepButton label={`Decrease ${label}`} disabled={available <= 0} onClick={() => onAdjust(-1)}>
          <Minus className="size-7" />
        </StepButton>
        <div className="text-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={available}
              initial={{ y: 12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -12, opacity: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={cn("font-mono text-6xl font-semibold tabular", full ? "text-alarm" : "text-ink")}
            >
              {available}
            </motion.div>
          </AnimatePresence>
          <div className="mt-1 text-xs text-muted">
            of <span className="font-mono">{total}</span>
            {held ? ` · ${held} held in transit` : ""}
          </div>
        </div>
        <StepButton label={`Increase ${label}`} disabled={available >= total} onClick={() => onAdjust(1)}>
          <Plus className="size-7" />
        </StepButton>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Meter value={occupancy} className="flex-1" />
        <span className="w-14 text-right font-mono text-xs text-ink-2">{occupancy.toFixed(0)}%</span>
      </div>
    </Panel>
  );
}

function StepButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      className="flex size-[72px] items-center justify-center rounded-2xl border border-line-strong bg-raised text-ink transition-colors hover:border-ice/50 hover:text-ice disabled:opacity-30"
    >
      {children}
    </motion.button>
  );
}

function ReferralRow({ hold, onZero }: { hold: BedHold; onZero: () => void }) {
  const [busy, setBusy] = useState<"in" | "out" | null>(null);
  const t = hold.triage;
  const flags = [
    t.sobriety ? SOBRIETY_LABEL[t.sobriety] : null,
    ...(t.needs ?? []).map((n) => NEED_LABEL[n]),
    t.family ? "Family" : null,
  ].filter(Boolean) as string[];

  async function run(kind: "in" | "out") {
    setBusy(kind);
    try {
      if (kind === "in") {
        await checkInHold(hold.id);
        toast.success(`${hold.client_label} checked in`);
      } else {
        await cancelHold(hold.id);
        toast.success("Hold released to public inventory");
      }
    } catch (err) {
      toast.error(kind === "in" ? "Check-in failed" : "Release failed", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, backgroundColor: "rgba(111,211,255,0.12)" }}
      animate={{ opacity: 1, backgroundColor: "rgba(0,0,0,0)" }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.6 }}
      className="border-b border-line last:border-0"
    >
      <td className="px-4 py-3">
        <Countdown expiresAt={hold.expires_at} onZero={onZero} className="text-2xl" />
        {hold.parent_hold_id && <div className="text-[10px] font-semibold uppercase text-caution">re-hold</div>}
      </td>
      <td className="px-4 py-3">
        <div className="font-semibold">{hold.client_label}</div>
        <div className="text-xs text-muted">
          {t.age != null ? `${t.age} y` : ""}
          {t.gender ? ` · ${GENDER_LABEL[t.gender]}` : ""}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {flags.map((f) => (
            <span key={f} className="rounded-md border border-line bg-raised px-1.5 py-0.5 text-[11px] text-ink-2">
              {f}
            </span>
          ))}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-xs">{hold.referrer}</div>
        <div className="text-[11px] text-muted">
          {hold.origin === "walk_in_reroute" ? "Walk-in reroute" : "Street outreach"} · {clockTime(hold.created_at)}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          <Button size="md" tone="ghost" loading={busy === "out"} disabled={busy !== null} onClick={() => void run("out")} icon={<X className="size-4" />}>
            Release
          </Button>
          <Button size="md" tone="go" loading={busy === "in"} disabled={busy !== null} onClick={() => void run("in")} icon={<CircleCheck className="size-4" />}>
            Client Checked In
          </Button>
        </div>
      </td>
    </motion.tr>
  );
}

function PartnerRow({ s, mine, now }: { s: Shelter; mine: boolean; now: number }) {
  const occupancy = pct(s.total_beds - s.available_beds, s.total_beds);
  return (
    <tr className={cn("border-b border-line last:border-0", mine && "bg-ice-dim/20")}>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold">{s.name}</span>
          {mine && <Badge tone="ice">You</Badge>}
          <KindBadge kind={s.kind} />
        </div>
        <div className="text-xs text-muted">{s.operator}</div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span className={cn("font-mono text-base font-semibold", s.available_beds === 0 ? "text-alarm" : s.available_beds <= 3 ? "text-caution" : "text-go")}>
          {s.available_beds}
        </span>
        <span className="font-mono text-xs text-muted"> / {s.total_beds}</span>
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Meter value={occupancy} className="flex-1" />
          <span className="w-12 text-right font-mono text-xs text-ink-2">{occupancy.toFixed(0)}%</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-2">
        {s.total_chairs ? `${s.available_chairs}/${s.total_chairs}` : "—"}
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-muted">{now ? timeAgo(s.updated_at, now) : ""}</td>
    </tr>
  );
}

