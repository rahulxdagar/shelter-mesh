"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlarmClockOff, RotateCcw, Route } from "lucide-react";
import { Button } from "@/components/ui";
import type { BedHold, Shelter } from "@/lib/types";

/** Urgent full-screen prompt shown when a hold lapses while the client is still in transit. */
export function ExpiredPrompt({
  hold,
  shelter,
  onRehold,
  onReroute,
  onDismiss,
}: {
  hold: BedHold | null;
  shelter: Shelter | null;
  onRehold: (h: BedHold) => Promise<void>;
  onReroute: (h: BedHold) => void;
  onDismiss: (h: BedHold) => void;
}) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hold) return;
    try {
      navigator.vibrate?.([300, 120, 300, 120, 300]);
    } catch {
      /* unsupported */
    }
  }, [hold]);

  const noBeds = shelter != null && (shelter.available_beds <= 0 || !shelter.is_active);

  return (
    <AnimatePresence>
      {hold && (
        <motion.div
          key={hold.id}
          className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-3 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="alertdialog"
          aria-labelledby="expired-title"
        >
          <motion.div
            initial={{ y: 40, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
            className="w-full max-w-md overflow-hidden rounded-3xl border border-alarm/50 bg-panel shadow-[var(--shadow-glow-alarm)]"
          >
            <div className="bg-alarm-dim px-5 py-4">
              <div className="flex items-center gap-3">
                <motion.span
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ repeat: Infinity, duration: 1.1 }}
                  className="flex size-11 items-center justify-center rounded-2xl bg-alarm text-white"
                >
                  <AlarmClockOff className="size-6" />
                </motion.span>
                <div>
                  <h2 id="expired-title" className="text-lg font-bold text-white">
                    Reservation Expired
                  </h2>
                  <p className="text-sm text-[#ffb3ba]">Tap to Re-Hold or Re-Route</p>
                </div>
              </div>
            </div>
            <div className="space-y-4 p-5">
              <p className="text-sm text-ink-2">
                The hold for <span className="font-semibold text-ink">{hold.client_label}</span> at{" "}
                <span className="font-semibold text-ink">{shelter?.name ?? "the shelter"}</span> reached 00:00 without an
                intake check-in. The bed was released to prevent a phantom hold.
              </p>
              {shelter && (
                <div className="flex items-center justify-between rounded-xl border border-line bg-deep px-3 py-2.5 text-sm">
                  <span className="text-muted">Beds open there now</span>
                  <span className={noBeds ? "font-mono font-semibold text-alarm" : "font-mono font-semibold text-go"}>
                    {shelter.is_active ? shelter.available_beds : "closed"}
                  </span>
                </div>
              )}
              <div className="grid gap-2">
                <Button
                  tone="go"
                  size="xl"
                  loading={busy}
                  disabled={noBeds}
                  icon={<RotateCcw className="size-5" />}
                  onClick={async () => {
                    setBusy(true);
                    await onRehold(hold);
                    setBusy(false);
                  }}
                >
                  {noBeds ? "No beds left to re-hold" : "Re-Hold · 10 more minutes"}
                </Button>
                <Button tone={noBeds ? "primary" : "neutral"} size="xl" icon={<Route className="size-5" />} onClick={() => onReroute(hold)}>
                  Re-Route to next nearest
                </Button>
                <Button tone="ghost" size="md" onClick={() => onDismiss(hold)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
