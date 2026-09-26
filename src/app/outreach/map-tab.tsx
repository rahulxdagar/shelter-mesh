"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Phone, X } from "lucide-react";
import { TacticalMap } from "@/components/tactical-map";
import { BedCount, KindBadge, TagList } from "@/components/shelter-bits";
import { IconButton } from "@/components/ui";
import { formatDistance, haversineMeters, type LatLng } from "@/lib/geo";
import type { Shelter } from "@/lib/types";

export function MapTab({ shelters, me }: { shelters: Shelter[]; me: LatLng | null }) {
  const [selected, setSelected] = useState<string | null>(null);
  const s = shelters.find((x) => x.id === selected) ?? null;
  const open = shelters.filter((x) => x.is_active).reduce((n, x) => n + x.available_beds, 0);

  return (
    <div className="relative h-[calc(100dvh-3.5rem-6.5rem)]">
      <TacticalMap
        className="absolute inset-0"
        shelters={shelters}
        me={me}
        selectedShelterId={selected}
        onShelterClick={(x) => setSelected(x.id)}
        fit={me ? { points: [me], key: "me" } : null}
      />
      <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-line bg-void/85 px-3 py-2 backdrop-blur">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Open beds · network</div>
        <div className="font-mono text-xl font-semibold text-ink">{open}</div>
      </div>
      <AnimatePresence>
        {s && (
          <motion.div
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="absolute inset-x-3 bottom-3 rounded-2xl border border-line-strong bg-panel/95 p-4 backdrop-blur"
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h3 className="font-semibold">{s.name}</h3>
                  <KindBadge kind={s.kind} />
                </div>
                <p className="text-xs text-muted">{s.address}</p>
                {me && <p className="mt-1 font-mono text-xs text-ink-2">{formatDistance(haversineMeters(me, s))} away</p>}
              </div>
              {s.is_active ? <BedCount available={s.available_beds} total={s.total_beds} /> : <span className="text-xs text-muted">Standby</span>}
              <IconButton label="Close" onClick={() => setSelected(null)}>
                <X className="size-4" />
              </IconButton>
            </div>
            <TagList tags={s.demographics_supported} className="mt-3" />
            {s.phone && s.phone !== "3-1-1" && (
              <a href={`tel:${s.phone.replace(/[^\d]/g, "")}`} className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ice">
                <Phone className="size-4" /> {s.phone}
              </a>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
