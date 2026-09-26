"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Snowflake } from "lucide-react";
import { useSystemState } from "@/hooks/use-live";

/** Field-facing Code Frost notice (outreach, shelter desks, EMS). */
export function FrostNotice({ className }: { className?: string }) {
  const { state } = useSystemState();
  return (
    <AnimatePresence>
      {state?.code_frost && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className={className}
        >
          <div className="relative overflow-hidden rounded-2xl border border-frost/40 bg-gradient-to-br from-[#0c2536] to-[#081620] p-4">
            <Snowflake className="absolute -right-4 -top-4 size-28 text-frost/10" />
            <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.12em] text-frost">
              <Snowflake className="size-4" /> Code Frost in effect
            </div>
            <p className="mt-1.5 text-sm text-ink-2">
              Wind chill{" "}
              <span className="font-mono font-semibold text-ink">
                {state.windchill_c != null ? `${Number(state.windchill_c).toFixed(1)}°C` : "—"}
              </span>{" "}
              · network{" "}
              <span className="font-mono font-semibold text-ink">
                {state.network_occupancy_pct != null ? `${Number(state.network_occupancy_pct).toFixed(1)}%` : "—"}
              </span>{" "}
              full.
            </p>
            <p className="mt-1 text-sm font-semibold text-frost">
              {state.warming_hubs_authorized
                ? "Emergency warming hubs are OPEN and appear in bed matches."
                : "Warming hub authorization pending from City Ops."}
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
