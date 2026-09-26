"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BedDouble, ClipboardList, Map as MapIcon, Radio } from "lucide-react";
import { toast } from "sonner";
import { useRequireRole } from "@/components/auth-provider";
import { FullscreenLoader, TopBar } from "@/components/app-shell";
import { DropPinButton } from "@/components/drop-pin";
import { EMPTY_DRAFT, fromTriage, toTriage, type TriageDraft } from "@/components/triage-form";
import { useAlerts, useHolds, useIncidents, useNow, useShelters } from "@/hooks/use-live";
import { useGeolocation } from "@/hooks/use-geolocation";
import {
  cancelHold, expireHolds, holdBed, matchShelters, reholdBed, TRIAGE_SYNCED, type TriageSyncedDetail,
} from "@/lib/actions";
import { RpcError } from "@/lib/errors";
import { enqueue, loadSnapshot, matchLocally } from "@/lib/offline";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/format";
import type { LatLng } from "@/lib/geo";
import { INCIDENT_LABEL, type AppRole, type BedHold, type Profile, type ShelterMatch, type Triage } from "@/lib/types";
import { TriageTab, type Results } from "./triage-tab";
import { HoldsTab } from "./holds-tab";
import { FeedTab } from "./feed-tab";
import { MapTab } from "./map-tab";
import { ExpiredPrompt } from "./expired-prompt";

const ROLES: AppRole[] = ["outreach"];
type Tab = "triage" | "holds" | "map" | "feed";

export default function OutreachPage() {
  const profile = useRequireRole(ROLES);
  if (!profile) return <FullscreenLoader />;
  return <Outreach profile={profile} />;
}

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* unsupported */
  }
}

function Outreach({ profile }: { profile: Profile }) {
  const [tab, setTab] = useState<Tab>("triage");
  const [draft, setDraft] = useState<TriageDraft>(EMPTY_DRAFT);
  const [results, setResults] = useState<Results>({ status: "idle" });
  const [holdingId, setHoldingId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [feedSeen, setFeedSeen] = useState(() => new Date().toISOString());
  const geo = useGeolocation(true);
  const shelters = useShelters("outreach-shelters");
  const now = useNow();
  const [since] = useState(() => new Date(Date.now() - 12 * 3_600_000).toISOString());

  const shelterName = useCallback(
    (id: string) => shelters.rows.find((s) => s.id === id)?.name ?? "the shelter",
    [shelters.rows],
  );
  const nameRef = useRef(shelterName);
  useEffect(() => {
    nameRef.current = shelterName;
  });

  const holds = useHolds({
    channel: "outreach-holds",
    load: () =>
      supabase().from("bed_holds").select("*").eq("created_by", profile.id).gte("created_at", since).order("created_at", { ascending: false }),
    keep: (h) => h.created_by === profile.id,
    onChange: (p) => {
      if (p.eventType !== "UPDATE") return;
      const prev = p.old as Partial<BedHold>;
      const h = p.new as BedHold;
      if (h.status === "CHECKED_IN" && prev.status !== "CHECKED_IN") {
        vibrate([40, 40, 40]);
        toast.success(`${h.client_label} checked in`, { description: `Intake confirmed at ${nameRef.current(h.shelter_id)}.` });
      }
      if (h.status === "EXPIRED" && prev.status === "HELD") vibrate([300, 120, 300, 120, 300]);
    },
  });

  const setHoldRows = holds.setRows;

  const alerts = useAlerts("outreach-alerts");
  const pins = useIncidents({
    channel: "outreach-pins",
    keep: (i) => i.reported_by === profile.id,
    onChange: (p) => {
      if (p.eventType !== "UPDATE") return;
      const i = p.new as { status: keyof typeof INCIDENT_LABEL };
      if ((p.old as { status?: string }).status !== i.status) {
        toast.info(`Your emergency pin: ${INCIDENT_LABEL[i.status]}`, {
          description: i.status === "EN_ROUTE" ? "An EMS crew is on the way." : undefined,
        });
      }
    },
  });

  // ─── Matching ───────────────────────────────────────────────────────────────
  const originFor = useCallback(async (): Promise<LatLng> => {
    if (geo.fix && Date.now() - geo.fix.at < 60_000) return geo.fix;
    return geo.locate();
  }, [geo]);

  const runOffline = useCallback(async (triage: Triage, label: string, origin: LatLng) => {
    const snap = await loadSnapshot();
    const matches = snap ? matchLocally(snap.shelters, triage, origin) : [];
    const id = crypto.randomUUID();
    await enqueue({
      id,
      type: "triage",
      payload: { triage, client_label: label, lat: origin.lat, lng: origin.lng },
      created_at: new Date().toISOString(),
    });
    setResults({ status: "provisional", matches, origin, triage, label, snapshotAt: snap?.saved_at ?? null, pendingId: id });
  }, []);

  const search = useCallback(
    async (d: TriageDraft, opts: { highlightFirst?: boolean } = {}): Promise<ShelterMatch[]> => {
      let triage: Triage;
      try {
        triage = toTriage(d);
      } catch {
        toast.error("Complete age, gender identity and sobriety first");
        return [];
      }
      setResults((r) => ({ ...r, status: "searching" }) as Results);
      let origin: LatLng;
      try {
        origin = await originFor();
      } catch (e) {
        toast.error("Location needed to rank shelters by distance", { description: (e as Error).message });
        setResults({ status: "idle" });
        return [];
      }
      if (!navigator.onLine) {
        await runOffline(triage, d.label, origin);
        return [];
      }
      try {
        const matches = await matchShelters(triage, origin);
        setResults({
          status: matches.length ? "live" : "none",
          matches,
          origin,
          triage,
          label: d.label,
          highlight: opts.highlightFirst ? matches[0]?.id : undefined,
        });
        return matches;
      } catch (err) {
        if (err instanceof RpcError && err.code === "NETWORK") {
          await runOffline(triage, d.label, origin);
          return [];
        }
        toast.error("Matching failed", { description: (err as Error).message });
        setResults({ status: "idle" });
        return [];
      }
    },
    [originFor, runOffline],
  );

  // A triage queued in a dead zone re-runs on reconnect; swap in the live results.
  useEffect(() => {
    const onSynced = (e: Event) => {
      const d = (e as CustomEvent<TriageSyncedDetail>).detail;
      setResults((r) => {
        if (r.status !== "provisional" || r.pendingId !== d.id) return r;
        toast.success("Back online — live bed matches loaded", {
          description: d.matches.length ? `${d.matches.length} compatible facilities with open beds.` : "No compatible beds right now.",
        });
        return { status: d.matches.length ? "live" : "none", matches: d.matches, origin: d.origin, triage: d.triage, label: d.client_label };
      });
    };
    window.addEventListener(TRIAGE_SYNCED, onSynced);
    return () => window.removeEventListener(TRIAGE_SYNCED, onSynced);
  }, []);

  // ─── Holds ──────────────────────────────────────────────────────────────────
  const reroute = useCallback(
    async (d: TriageDraft) => {
      setDraft(d);
      setTab("triage");
      const matches = await search(d, { highlightFirst: true });
      if (matches.length) toast.info(`Next nearest: ${matches[0].name}`, { description: "Tap Hold Bed to lock it." });
    },
    [search],
  );

  const hold = useCallback(
    async (m: ShelterMatch, triage: Triage, label: string) => {
      setHoldingId(m.id);
      try {
        const h = await holdBed(m.id, label || "Client", triage);
        vibrate(60);
        setHoldRows((prev) => [h, ...prev.filter((x) => x.id !== h.id)]);
        toast.success(`Bed held at ${m.name}`, { description: "20-minute hold started. The intake desk can see your client in transit." });
        setTab("holds");
      } catch (err) {
        if (err instanceof RpcError && (err.code === "OUT_OF_STOCK" || err.code === "FACILITY_CLOSED")) {
          vibrate([100, 50, 100]);
          toast.warning(`${m.name} just filled`, {
            description: "Another worker claimed the last bed first. Re-routing to the next nearest facility…",
          });
          await search(fromTriage(triage, label), { highlightFirst: true });
        } else {
          toast.error("Could not hold bed", { description: (err as Error).message });
        }
      } finally {
        setHoldingId(null);
      }
    },
    [setHoldRows, search],
  );

  const release = useCallback(
    async (h: BedHold) => {
      try {
        await cancelHold(h.id);
        toast.success("Hold released", { description: "The bed is back in public inventory." });
      } catch (err) {
        toast.error("Could not release", { description: (err as Error).message });
      }
    },
    [],
  );

  const refetchHolds = holds.refetch;
  const onZero = useCallback(() => {
    // Expire server-side the instant the timer hits zero instead of waiting for the cron sweep.
    void expireHolds()
      .catch(() => undefined)
      .finally(() => void refetchHolds());
  }, [refetchHolds]);

  const expired = useMemo(() => {
    const reheld = new Set(holds.rows.map((h) => h.parent_hold_id).filter(Boolean));
    return holds.rows.find(
      (h) =>
        h.status === "EXPIRED" &&
        !reheld.has(h.id) &&
        !dismissed.has(h.id) &&
        h.resolved_at != null &&
        now - new Date(h.resolved_at).getTime() < 30 * 60_000,
    );
  }, [holds.rows, dismissed, now]);

  const rehold = useCallback(
    async (h: BedHold) => {
      try {
        await reholdBed(h.id);
        vibrate(60);
        toast.success("Bed re-locked for 10 minutes", { description: shelterName(h.shelter_id) });
        setTab("holds");
      } catch (err) {
        if (err instanceof RpcError && (err.code === "OUT_OF_STOCK" || err.code === "FACILITY_CLOSED")) {
          toast.warning("That bed is gone", { description: "Re-routing to the next nearest compatible facility…" });
          setDismissed((s) => new Set(s).add(h.id));
          await reroute(fromTriage(h.triage, h.client_label));
          return;
        }
        toast.error("Re-hold failed", { description: (err as Error).message });
      }
    },
    [reroute, shelterName],
  );

  const activeHolds = holds.rows.filter((h) => h.status === "HELD");
  const nextExpiry = activeHolds.reduce<string | null>((min, h) => (min && min < h.expires_at ? min : h.expires_at), null);

  // Fire server-side expiry at the earliest deadline whichever tab is open, so the
  // "Reservation Expired" prompt appears on time rather than on the next cron sweep.
  // Keeps nudging every 5 s while a hold is overdue, which absorbs small device clock skew.
  useEffect(() => {
    if (!nextExpiry) return;
    let retry: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(() => {
      onZero();
      retry = setInterval(onZero, 5_000);
    }, Math.max(0, new Date(nextExpiry).getTime() - Date.now()) + 250);
    return () => {
      clearTimeout(t);
      if (retry) clearInterval(retry);
    };
  }, [nextExpiry, onZero]);
  const unread = alerts.rows.filter((a) => a.created_at > feedSeen).length;

  const tabs: { id: Tab; label: string; icon: typeof ClipboardList; badge?: number }[] = [
    { id: "triage", label: "Triage", icon: ClipboardList },
    { id: "holds", label: "Holds", icon: BedDouble, badge: activeHolds.length },
    { id: "map", label: "Map", icon: MapIcon },
    { id: "feed", label: "Feed", icon: Radio, badge: tab === "feed" ? 0 : unread },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-void">
      <TopBar />
      <main className="flex-1 pb-32">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16 }}
          >
            {tab === "triage" && (
              <TriageTab
                draft={draft}
                onDraft={setDraft}
                results={results}
                onSearch={() => void search(draft)}
                onReset={() => {
                  setDraft(EMPTY_DRAFT);
                  setResults({ status: "idle" });
                }}
                onHold={hold}
                holdingId={holdingId}
                me={geo.fix}
                geoError={geo.error}
                snapshotAt={shelters.snapshotAt}
              />
            )}
            {tab === "holds" && (
              <HoldsTab
                holds={holds.rows}
                loading={holds.loading}
                shelters={shelters.rows}
                me={geo.fix}
                onZero={onZero}
                onRelease={release}
                onRehold={rehold}
                onReroute={(h) => void reroute(fromTriage(h.triage, h.client_label))}
                onNew={() => setTab("triage")}
              />
            )}
            {tab === "map" && <MapTab shelters={shelters.rows} me={geo.fix} />}
            {tab === "feed" && <FeedTab alerts={alerts.rows} pins={pins.rows} />}
          </motion.div>
        </AnimatePresence>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-void/90 backdrop-blur-xl">
        <div className="mx-auto grid max-w-xl grid-cols-5 items-end px-2 pt-1.5">
          {tabs.slice(0, 2).map((t) => (
            <NavButton key={t.id} {...t} active={tab === t.id} onClick={() => setTab(t.id)} />
          ))}
          <div className="-mt-8 flex justify-center">
            <DropPinButton variant="nav" lastFix={geo.fix} />
          </div>
          {tabs.slice(2).map((t) => (
            <NavButton
              key={t.id}
              {...t}
              active={tab === t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "feed") setFeedSeen(new Date().toISOString());
              }}
            />
          ))}
        </div>
      </nav>

      <ExpiredPrompt
        hold={expired ?? null}
        shelter={expired ? shelters.rows.find((s) => s.id === expired.shelter_id) ?? null : null}
        onRehold={rehold}
        onReroute={(h) => {
          setDismissed((s) => new Set(s).add(h.id));
          void reroute(fromTriage(h.triage, h.client_label));
        }}
        onDismiss={(h) => setDismissed((s) => new Set(s).add(h.id))}
      />
    </div>
  );
}

function NavButton({
  label,
  icon: Icon,
  badge,
  active,
  onClick,
}: {
  label: string;
  icon: typeof ClipboardList;
  badge?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex h-16 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-colors",
        active ? "text-ice" : "text-muted hover:text-ink-2",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className="relative">
        <Icon className="size-6" strokeWidth={active ? 2.4 : 2} />
        {badge ? (
          <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-alarm px-1 font-mono text-[10px] text-white">
            {badge}
          </span>
        ) : null}
      </span>
      {label}
      {active && <motion.span layoutId="nav-dot" className="absolute bottom-1 h-0.5 w-6 rounded-full bg-ice" />}
    </button>
  );
}
