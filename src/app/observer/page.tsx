"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, MapPin, Radio, ShieldCheck } from "lucide-react";
import { useRequireRole } from "@/components/auth-provider";
import { FullscreenLoader, TopBar } from "@/components/app-shell";
import { DropPinButton } from "@/components/drop-pin";
import { Badge } from "@/components/ui";
import { useIncidents, useNow } from "@/hooks/use-live";
import { useQueue } from "@/hooks/use-queue";
import { useGeolocation } from "@/hooks/use-geolocation";
import { timeAgo } from "@/lib/format";
import { formatCoord } from "@/lib/geo";
import { INCIDENT_LABEL, type AppRole, type Profile } from "@/lib/types";

const ROLES: AppRole[] = ["observer"];

export default function ObserverPage() {
  const profile = useRequireRole(ROLES);
  if (!profile) return <FullscreenLoader />;
  return <Observer profile={profile} />;
}

type LastPin = { lat: number; lng: number; accuracy: number | null; delivered: boolean; at: number };

function Observer({ profile }: { profile: Profile }) {
  const [last, setLast] = useState<LastPin | null>(null);
  const geo = useGeolocation(true);
  const now = useNow();
  const queue = useQueue();
  const pins = useIncidents({ channel: "observer-pins", keep: (i) => i.reported_by === profile.id, sinceHours: 2 });
  const latest = pins.rows[0];

  return (
    <div className="flex min-h-dvh flex-col bg-void">
      <TopBar title="Emergency beacon" />
      <main className="grid-field relative flex flex-1 flex-col items-center justify-center gap-10 px-6 py-10">
        <div className="pointer-events-none absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-alarm/10 blur-[100px]" />
        <div className="relative text-center">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Suspected overdose?</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm text-ink-2">
            Press and hold the beacon for <span className="font-semibold text-ink">2 seconds</span>. Your GPS location goes
            straight to every EMS crisis unit nearby. No phone queue.
          </p>
        </div>

        <div className="relative">
          <DropPinButton
            variant="hero"
            lastFix={geo.fix}
            onResult={(r) => setLast({ lat: r.lat, lng: r.lng, accuracy: r.accuracy, delivered: r.delivered, at: Date.now() })}
          />
        </div>

        <AnimatePresence mode="wait">
          {last || latest ? (
            <motion.div
              key={latest?.id ?? "local"}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="relative w-full max-w-sm rounded-2xl border border-line bg-panel/90 p-4 backdrop-blur"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Transmission</span>
                {queue.length > 0 ? (
                  <Badge tone="caution">
                    <CloudOff className="size-3" /> Queued · {queue.length}
                  </Badge>
                ) : latest ? (
                  <Badge tone={latest.status === "ACTIVE" ? "alarm" : latest.status === "EN_ROUTE" ? "caution" : "go"}>
                    {latest.status === "ACTIVE" ? "Received by EMS" : INCIDENT_LABEL[latest.status]}
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3 flex items-center gap-2 font-mono text-sm">
                <MapPin className="size-4 text-alarm" />
                {latest ? formatCoord(latest) : last ? formatCoord(last) : ""}
              </div>
              <div className="mt-1 text-xs text-muted">
                {latest?.address ?? (last?.accuracy ? `±${Math.round(last.accuracy)} m accuracy` : "")}
                {latest && now ? ` · ${timeAgo(latest.created_at, now)}` : ""}
              </div>
              {queue.length > 0 && (
                <p className="mt-3 flex items-start gap-2 text-xs text-caution">
                  <Radio className="mt-0.5 size-3.5 shrink-0" />
                  No signal. The pin is stored on this device and transmits automatically on reconnect.
                </p>
              )}
            </motion.div>
          ) : (
            <motion.p
              key="hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="relative flex items-center gap-2 text-xs text-muted"
            >
              <ShieldCheck className="size-4" /> Releasing early cancels. Nothing is sent until the ring completes.
            </motion.p>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
