"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRightLeft, Navigation, Phone, Undo2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Badge, Button, Panel, PanelHeader } from "@/components/ui";
import { Countdown } from "@/components/countdown";
import { Directions } from "@/components/directions";
import { EMPTY_DRAFT, TriageForm, draftComplete, toTriage, type TriageDraft } from "@/components/triage-form";
import { cancelHold, rerouteWalkIn } from "@/lib/actions";
import { RpcError } from "@/lib/errors";
import { cn } from "@/lib/format";
import { formatDistance, haversineMeters } from "@/lib/geo";
import type { BedHold, Shelter } from "@/lib/types";

/** 1-click walk-in overflow: rank partners from this desk's location and soft-lock the nearest compatible bed. */
export function WalkInReroute({
  home,
  holds,
  shelters,
  atCapacity,
  onZero,
}: {
  home: Shelter;
  holds: BedHold[];
  shelters: Shelter[];
  atCapacity: boolean;
  onZero: () => void;
}) {
  const [draft, setDraft] = useState<TriageDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);
  const [openRoute, setOpenRoute] = useState<string | null>(null);
  const byId = new Map(shelters.map((s) => [s.id, s]));
  const outbound = holds
    .filter((h) => h.origin_shelter_id === home.id && h.status === "HELD")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function reroute() {
    setBusy(true);
    try {
      const h = await rerouteWalkIn(draft.label || "Walk-in", toTriage(draft));
      const partner = byId.get(h.shelter_id);
      toast.success(`Bed soft-locked at ${partner?.name ?? "partner facility"}`, {
        description: partner ? `${formatDistance(haversineMeters(home, partner))} away · 20-minute hold started.` : undefined,
      });
      setOpenRoute(h.id);
      setDraft(EMPTY_DRAFT);
    } catch (err) {
      if (err instanceof RpcError && err.code === "NO_MATCH") {
        toast.error("No compatible partner bed available", {
          description: "Every matching facility is full. Escalate to City Ops (3-1-1) for warming hub capacity.",
        });
      } else {
        toast.error("Reroute failed", { description: (err as Error).message });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={cn("h-fit xl:sticky xl:top-[4.5rem]", atCapacity && "border-caution/50 shadow-[0_0_0_1px_rgb(251_191_36/0.2)]")}>
      <PanelHeader
        icon={<ArrowRightLeft className="size-4" />}
        title="Walk-in overflow reroute"
        meta={atCapacity ? <Badge tone="caution">You&apos;re full</Badge> : null}
      />
      <div className="p-4">
        <p className="mb-4 text-[13px] text-muted">
          Enter the walk-in&apos;s flags. Cold-Grid finds the nearest compatible partner and soft-locks a bed there with a
          20-minute hold.
        </p>
        <TriageForm value={draft} onChange={setDraft} dense />
        <Button
          tone={atCapacity ? "caution" : "primary"}
          size="lg"
          className="mt-5 w-full"
          disabled={!draftComplete(draft)}
          loading={busy}
          icon={<Zap className="size-4" />}
          onClick={() => void reroute()}
        >
          Reroute &amp; soft-lock nearest bed
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {outbound.length > 0 && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden border-t border-line">
            <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Outbound holds</div>
            <div className="space-y-2 p-3 pt-1">
              {outbound.map((h) => {
                const partner = byId.get(h.shelter_id);
                return (
                  <motion.div
                    key={h.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("rounded-xl border bg-deep p-3", openRoute === h.id ? "border-ice/40" : "border-line")}
                  >
                    <div className="flex items-center gap-3">
                      <Countdown expiresAt={h.expires_at} onZero={onZero} className="text-lg" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{partner?.name ?? "Partner"}</div>
                        <div className="truncate text-xs text-muted">
                          {h.client_label}
                          {partner ? ` · ${formatDistance(haversineMeters(home, partner))}` : ""}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2.5 flex gap-2">
                      <Button size="sm" tone="neutral" icon={<Navigation className="size-3.5" />} onClick={() => setOpenRoute((v) => (v === h.id ? null : h.id))}>
                        {openRoute === h.id ? "Hide route" : "Route"}
                      </Button>
                      {partner?.phone && partner.phone !== "3-1-1" && (
                        <a
                          href={`tel:${partner.phone.replace(/[^\d]/g, "")}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong bg-raised px-3 text-[13px] font-semibold"
                        >
                          <Phone className="size-3.5" /> Call
                        </a>
                      )}
                      <Button
                        size="sm"
                        tone="ghost"
                        className="ml-auto"
                        icon={<Undo2 className="size-3.5" />}
                        onClick={async () => {
                          try {
                            await cancelHold(h.id);
                            toast.success("Soft-lock released");
                          } catch (err) {
                            toast.error("Could not release", { description: (err as Error).message });
                          }
                        }}
                      >
                        Undo
                      </Button>
                    </div>
                    <AnimatePresence>{openRoute === h.id && partner && <Directions from={home} to={partner} />}</AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}
