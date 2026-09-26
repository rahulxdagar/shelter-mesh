"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BedDouble, CircleCheck, Clock, MapPin, Navigation, Phone, Plus, RotateCcw, Route, X } from "lucide-react";
import { Badge, Button, EmptyState, Skeleton } from "@/components/ui";
import { CountdownRing } from "@/components/countdown";
import { Directions } from "@/components/directions";
import { clockTime, cn } from "@/lib/format";
import { formatDistance, haversineMeters, type LatLng } from "@/lib/geo";
import { GENDER_LABEL, type BedHold, type Shelter } from "@/lib/types";

export function HoldsTab({
  holds,
  loading,
  shelters,
  me,
  onZero,
  onRelease,
  onRehold,
  onReroute,
  onNew,
}: {
  holds: BedHold[];
  loading: boolean;
  shelters: Shelter[];
  me: LatLng | null;
  onZero: () => void;
  onRelease: (h: BedHold) => Promise<void>;
  onRehold: (h: BedHold) => Promise<void>;
  onReroute: (h: BedHold) => void;
  onNew: () => void;
}) {
  const byId = new Map(shelters.map((s) => [s.id, s]));
  const active = holds.filter((h) => h.status === "HELD").sort((a, b) => a.expires_at.localeCompare(b.expires_at));
  const history = holds.filter((h) => h.status !== "HELD");
  const reheld = new Set(holds.map((h) => h.parent_hold_id).filter(Boolean));

  return (
    <div className="mx-auto max-w-xl px-4 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Bed holds</h1>
          <p className="mt-0.5 text-xs text-muted">Timers are synced with each shelter&apos;s intake desk</p>
        </div>
        <Button tone="neutral" size="sm" icon={<Plus className="size-3.5" />} onClick={onNew}>
          New triage
        </Button>
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : active.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel">
          <EmptyState
            icon={<BedDouble className="size-5" />}
            title="No clients in transit"
            body="Holds you place from Triage appear here with a live 20-minute countdown."
          />
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {active.map((h) => (
              <ActiveHold key={h.id} hold={h} shelter={byId.get(h.shelter_id)} me={me} onZero={onZero} onRelease={onRelease} />
            ))}
          </AnimatePresence>
        </div>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Last 12 hours</h2>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
            {history.map((h) => {
              const s = byId.get(h.shelter_id);
              const canRetry = h.status === "EXPIRED" && !reheld.has(h.id);
              return (
                <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                  <StatusDot status={h.status} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {h.client_label} <span className="font-normal text-muted">→ {s?.name ?? "Shelter"}</span>
                    </div>
                    <div className="text-xs text-muted">
                      {statusText(h)} · {clockTime(h.resolved_at ?? h.created_at)}
                    </div>
                  </div>
                  {canRetry && (
                    <div className="flex gap-1.5">
                      <Button size="sm" tone="neutral" icon={<RotateCcw className="size-3.5" />} onClick={() => void onRehold(h)}>
                        Re-hold
                      </Button>
                      <Button size="sm" tone="ghost" icon={<Route className="size-3.5" />} onClick={() => onReroute(h)}>
                        Re-route
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function statusText(h: BedHold) {
  if (h.status === "CHECKED_IN") return "Checked in";
  if (h.status === "EXPIRED") return "Expired — bed released";
  if (h.status === "CANCELLED") return "Released";
  return "Held";
}

function StatusDot({ status }: { status: BedHold["status"] }) {
  const cls =
    status === "CHECKED_IN" ? "bg-go" : status === "EXPIRED" ? "bg-alarm" : status === "CANCELLED" ? "bg-faint" : "bg-ice";
  return <span className={cn("size-2.5 shrink-0 rounded-full", cls)} />;
}

function ActiveHold({
  hold,
  shelter,
  me,
  onZero,
  onRelease,
}: {
  hold: BedHold;
  shelter?: Shelter;
  me: LatLng | null;
  onZero: () => void;
  onRelease: (h: BedHold) => Promise<void>;
}) {
  const [route, setRoute] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const t = hold.triage;

  return (
    <motion.article
      layout
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="rounded-2xl border border-ice/30 bg-panel p-4 shadow-[var(--shadow-glow-ice)]"
    >
      <div className="flex items-center gap-4">
        <CountdownRing expiresAt={hold.expires_at} totalMinutes={hold.held_minutes} onZero={onZero} size={116} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="ice">
              <Clock className="size-3" /> Held
            </Badge>
            {hold.parent_hold_id && <Badge tone="caution">Re-hold · 10 min</Badge>}
            {hold.origin === "walk_in_reroute" && <Badge tone="neutral">Walk-in reroute</Badge>}
          </div>
          <h3 className="mt-2 text-[17px] font-semibold leading-tight">{shelter?.name ?? "Shelter"}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted">
            <MapPin className="size-3 shrink-0" /> {shelter?.address}
          </p>
          <p className="mt-2 text-sm">
            <span className="font-semibold">{hold.client_label}</span>
            <span className="text-muted">
              {t.age != null ? ` · ${t.age}` : ""}
              {t.gender ? ` · ${GENDER_LABEL[t.gender]}` : ""}
              {t.family ? " · family" : ""}
            </span>
          </p>
          {me && shelter && (
            <p className="mt-1 font-mono text-xs text-ink-2">{formatDistance(haversineMeters(me, shelter))} away</p>
          )}
        </div>
      </div>

      <AnimatePresence>{route && me && shelter && <Directions from={me} to={shelter} />}</AnimatePresence>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button tone="primary" size="lg" icon={<Navigation className="size-4" />} onClick={() => setRoute((v) => !v)} disabled={!me || !shelter}>
          {route ? "Hide" : "Route"}
        </Button>
        {shelter?.phone ? (
          <a
            href={`tel:${shelter.phone.replace(/[^\d]/g, "")}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised text-[15px] font-semibold hover:bg-[#1a212b]"
          >
            <Phone className="size-4" /> Call
          </a>
        ) : (
          <span />
        )}
        <Button
          tone={confirming ? "danger" : "neutral"}
          size="lg"
          loading={releasing}
          icon={!releasing ? <X className="size-4" /> : undefined}
          onClick={async () => {
            if (!confirming) {
              setConfirming(true);
              setTimeout(() => setConfirming(false), 3000);
              return;
            }
            setReleasing(true);
            await onRelease(hold);
            setReleasing(false);
          }}
        >
          {confirming ? "Confirm" : "Release"}
        </Button>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted">
        <CircleCheck className="size-3" /> Intake staff confirm arrival. Unconfirmed holds release automatically at 00:00.
      </p>
    </motion.article>
  );
}
