"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BedDouble, CloudOff, Crosshair, Navigation, Phone, RotateCcw, Search, TriangleAlert } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { Directions } from "@/components/directions";
import { BedCount, KindBadge, TagList } from "@/components/shelter-bits";
import { TriageForm, draftComplete, type TriageDraft } from "@/components/triage-form";
import { clockTime, cn } from "@/lib/format";
import { formatDistance, type LatLng } from "@/lib/geo";
import type { ShelterMatch, Triage } from "@/lib/types";

export type Results =
  | { status: "idle" }
  | { status: "searching" }
  | {
      status: "live" | "none";
      matches: ShelterMatch[];
      origin: LatLng;
      triage: Triage;
      label: string;
      highlight?: string;
    }
  | {
      status: "provisional";
      matches: ShelterMatch[];
      origin: LatLng;
      triage: Triage;
      label: string;
      snapshotAt: string | null;
      pendingId: string;
    };

export function TriageTab({
  draft,
  onDraft,
  results,
  onSearch,
  onReset,
  onHold,
  holdingId,
  me,
  geoError,
  snapshotAt,
}: {
  draft: TriageDraft;
  onDraft: (d: TriageDraft) => void;
  results: Results;
  onSearch: () => void;
  onReset: () => void;
  onHold: (m: ShelterMatch, t: Triage, label: string) => void;
  holdingId: string | null;
  me: (LatLng & { accuracy: number | null }) | null;
  geoError: string | null;
  snapshotAt: string | null;
}) {
  const ready = draftComplete(draft);
  const searching = results.status === "searching";
  const hasResults = results.status === "live" || results.status === "none" || results.status === "provisional";

  return (
    <div className="mx-auto max-w-xl px-4 pt-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Client intake</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Crosshair className={cn("size-3.5", me ? "text-go" : geoError ? "text-alarm" : "text-caution")} />
            {me
              ? `GPS locked · ±${Math.round(me.accuracy ?? 0)} m`
              : geoError ?? "Acquiring GPS…"}
          </p>
        </div>
        <Button tone="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={onReset}>
          New client
        </Button>
      </div>

      {snapshotAt && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-caution/30 bg-caution-dim px-3 py-2 text-xs text-caution">
          <CloudOff className="size-4 shrink-0" /> Showing cached capacity from {clockTime(snapshotAt)}.
        </div>
      )}

      <TriageForm value={draft} onChange={onDraft} />

      {/* Solid bar so the CTA never floats translucently over form fields while scrolling. */}
      <div className="sticky bottom-[6.5rem] z-10 -mx-4 mt-6 bg-gradient-to-t from-void via-void/95 to-transparent px-4 pb-2 pt-6">
        <Button
          tone={ready ? "primary" : "neutral"}
          size="xl"
          className="w-full shadow-[0_12px_40px_rgb(0_0_0/0.6)] disabled:opacity-100 disabled:text-muted"
          disabled={!ready}
          loading={searching}
          icon={<Search className="size-5" />}
          onClick={onSearch}
        >
          {searching ? "Querying the mesh…" : ready ? "Find nearest beds" : "Complete age, gender & sobriety"}
        </Button>
      </div>

      <AnimatePresence>
        {hasResults && (
          <motion.section
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-8"
            id="results"
          >
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                Compatible beds · nearest first
              </h2>
              {results.status !== "provisional" && results.matches.length > 0 && (
                <span className="text-xs text-muted">{results.matches.length} matches</span>
              )}
            </div>

            {results.status === "provisional" && (
              <div className="mb-3 rounded-xl border border-caution/40 bg-caution-dim p-3 text-sm text-caution">
                <div className="flex items-center gap-2 font-semibold">
                  <CloudOff className="size-4" /> Offline — provisional matches
                </div>
                <p className="mt-1 text-xs text-caution/80">
                  Ranked from the cached capacity snapshot
                  {results.snapshotAt ? ` (${clockTime(results.snapshotAt)})` : ""}. This triage is queued and
                  re-runs against live inventory the moment signal returns. Holding a bed needs a connection.
                </p>
              </div>
            )}

            {results.matches.length === 0 ? (
              <div className="rounded-2xl border border-line bg-panel">
                <EmptyState
                  icon={<TriangleAlert className="size-5" />}
                  title="No compatible beds open right now"
                  body="Every matching facility is at capacity. Check the Feed for Code Frost warming hubs, or call 3-1-1."
                />
              </div>
            ) : (
              <div className="space-y-3">
                {results.matches.map((m, i) => (
                  <MatchCard
                    key={m.id}
                    rank={i + 1}
                    match={m}
                    origin={results.origin}
                    highlight={results.status === "live" && results.highlight === m.id}
                    provisional={results.status === "provisional"}
                    holding={holdingId === m.id}
                    disabled={holdingId !== null}
                    onHold={() => onHold(m, results.triage, results.label)}
                  />
                ))}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );
}

function MatchCard({
  rank,
  match,
  origin,
  highlight,
  provisional,
  holding,
  disabled,
  onHold,
}: {
  rank: number;
  match: ShelterMatch;
  origin: LatLng;
  highlight: boolean;
  provisional: boolean;
  holding: boolean;
  disabled: boolean;
  onHold: () => void;
}) {
  const [showRoute, setShowRoute] = useState(false);
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.04 }}
      className={cn(
        "rounded-2xl border bg-panel p-4",
        highlight ? "border-ice shadow-[var(--shadow-glow-ice)]" : "border-line",
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-lg font-mono text-sm font-bold",
            rank === 1 ? "bg-ice text-void" : "bg-raised text-ink-2",
          )}
        >
          {rank}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-[16px] font-semibold leading-tight">{match.name}</h3>
            <KindBadge kind={match.kind} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">{match.address}</p>
          <div className="mt-2 flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1 font-mono font-semibold text-ink">
              <Navigation className="size-3.5 text-ice" />
              {formatDistance(match.distance_m)}
            </span>
            {match.phone && (
              <a href={`tel:${match.phone.replace(/[^\d]/g, "")}`} className="flex items-center gap-1 text-xs text-ink-2 hover:text-ice">
                <Phone className="size-3" /> {match.phone}
              </a>
            )}
          </div>
        </div>
        <BedCount available={match.available_beds} total={match.total_beds} />
      </div>

      <TagList tags={match.demographics_supported} className="mt-3" />

      <AnimatePresence>{showRoute && <Directions from={origin} to={match} />}</AnimatePresence>

      <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
        <Button size="lg" tone="neutral" onClick={() => setShowRoute((v) => !v)} icon={<Navigation className="size-4" />}>
          {showRoute ? "Hide" : "Route"}
        </Button>
        <Button
          size="lg"
          tone={provisional ? "neutral" : "go"}
          disabled={provisional || disabled}
          loading={holding}
          onClick={onHold}
          icon={!holding ? <BedDouble className="size-5" /> : undefined}
        >
          {provisional ? "Hold needs signal" : holding ? "Locking bed…" : "Hold Bed · 20 min"}
        </Button>
      </div>
    </motion.article>
  );
}
