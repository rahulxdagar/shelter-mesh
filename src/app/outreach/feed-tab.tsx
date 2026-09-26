"use client";

import { motion } from "framer-motion";
import { Info, Radio, Siren, Snowflake, TriangleAlert } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { FrostNotice } from "@/components/frost-notice";
import { useNow } from "@/hooks/use-live";
import { cn, timeAgo } from "@/lib/format";
import { formatCoord } from "@/lib/geo";
import { INCIDENT_LABEL, type Alert, type Incident } from "@/lib/types";

const ALERT_ICON = { critical: Snowflake, warning: TriangleAlert, info: Info } as const;

export function FeedTab({ alerts, pins }: { alerts: Alert[]; pins: Incident[] }) {
  const now = useNow();
  return (
    <div className="mx-auto max-w-xl space-y-6 px-4 pt-4">
      <div>
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Field feed</h1>
        <p className="mt-0.5 text-xs text-muted">Municipal alerts and your emergency pins, live</p>
      </div>

      <FrostNotice />

      {pins.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Your emergency pins</h2>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
            {pins.map((p) => {
              const tone =
                p.status === "ACTIVE" ? "alarm" : p.status === "EN_ROUTE" ? "caution" : p.status === "ON_SCENE" ? "ice" : "neutral";
              return (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3">
                  <Siren className={cn("size-5 shrink-0", p.status === "ACTIVE" ? "text-alarm" : "text-muted")} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-ink-2">{p.address ?? formatCoord(p)}</div>
                    <div className="text-xs text-muted">{now ? timeAgo(p.created_at, now) : ""}{p.queued_offline ? " · sent after reconnect" : ""}</div>
                  </div>
                  <Badge tone={tone}>{INCIDENT_LABEL[p.status]}</Badge>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted">Alerts</h2>
        {alerts.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel">
            <EmptyState icon={<Radio className="size-5" />} title="All quiet" body="Code Frost and warming hub alerts will appear here." />
          </div>
        ) : (
          <div className="space-y-2">
            {alerts.map((a, i) => {
              const Icon = ALERT_ICON[a.severity];
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cn(
                    "flex gap-3 rounded-2xl border p-3.5",
                    a.severity === "critical"
                      ? "border-frost/40 bg-frost/5"
                      : a.severity === "warning"
                        ? "border-caution/30 bg-caution-dim/50"
                        : "border-line bg-panel",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      a.severity === "critical" ? "text-frost" : a.severity === "warning" ? "text-caution" : "text-ink-2",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{a.title}</span>
                      <span className="shrink-0 text-[11px] text-muted">{now ? timeAgo(a.created_at, now) : ""}</span>
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-2">{a.body}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
