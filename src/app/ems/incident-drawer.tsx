"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ambulance, CircleCheck, Clock, Copy, ExternalLink, LoaderCircle, MapPin, Navigation, ShieldX, Siren, UserRound, X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge, IconButton } from "@/components/ui";
import { osmDirectionsUrl } from "@/components/directions";
import { useNow } from "@/hooks/use-live";
import { setIncidentAddress, setIncidentStatus } from "@/lib/actions";
import { clockTime, cn, timeAgo } from "@/lib/format";
import { formatCoord, formatDistance, formatDuration, haversineMeters, type LatLng } from "@/lib/geo";
import { fetchRoute, reverseGeocode } from "@/lib/routing";
import { INCIDENT_LABEL, type Incident, type IncidentStatus } from "@/lib/types";

const STATUS_ACTIONS: { status: IncidentStatus; label: string; icon: typeof Siren; tone: string; on: string }[] = [
  { status: "EN_ROUTE", label: "En Route", icon: Ambulance, tone: "hover:border-caution/60", on: "border-caution bg-caution text-void" },
  { status: "ON_SCENE", label: "On Scene", icon: MapPin, tone: "hover:border-ice/60", on: "border-ice bg-ice text-void" },
  { status: "RESOLVED", label: "Resolved", icon: CircleCheck, tone: "hover:border-go/60", on: "border-go bg-go text-void" },
  { status: "FALSE_ALARM", label: "False Alarm", icon: ShieldX, tone: "hover:border-line-strong", on: "border-ink bg-ink text-void" },
];

function subscribeWide(fn: () => void) {
  const mq = window.matchMedia("(min-width: 768px)");
  mq.addEventListener("change", fn);
  return () => mq.removeEventListener("change", fn);
}
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia("(min-width: 768px)").matches, () => true);

export function IncidentDrawer({
  incident,
  me,
  onClose,
  onRoute,
}: {
  incident: Incident | null;
  me: LatLng | null;
  onClose: () => void;
  onRoute: (r: [number, number][] | null) => void;
}) {
  const wide = useWide();
  return (
    <AnimatePresence>
      {incident && (
        <motion.aside
          key="drawer"
          initial={wide ? { x: 420, opacity: 0 } : { y: 420, opacity: 0 }}
          animate={{ x: 0, y: 0, opacity: 1 }}
          exit={wide ? { x: 420, opacity: 0 } : { y: 420, opacity: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          className={cn(
            "absolute z-20 flex flex-col overflow-hidden border border-line-strong bg-panel/95 backdrop-blur-xl",
            wide ? "bottom-3 right-3 top-[5.5rem] w-[380px] rounded-2xl" : "safe-bottom inset-x-0 bottom-0 max-h-[72dvh] rounded-t-3xl",
          )}
        >
          {!wide && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-strong" />}
          {/* Keyed so address/ETA state starts fresh for each incident. */}
          <DrawerContent key={incident.id} incident={incident} me={me} onClose={onClose} onRoute={onRoute} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function DrawerContent({
  incident,
  me,
  onClose,
  onRoute,
}: {
  incident: Incident;
  me: LatLng | null;
  onClose: () => void;
  onRoute: (r: [number, number][] | null) => void;
}) {
  const now = useNow();
  const [address, setAddress] = useState<string | null>(incident.address);
  const [eta, setEta] = useState<{ duration_s: number; distance_m: number } | null>(null);
  const [pending, setPending] = useState<IncidentStatus | null>(null);
  const hasFix = me !== null;
  const shownAddress = incident.address ?? address;

  // Reverse-geocode once and persist it so every console shares the address.
  useEffect(() => {
    if (incident.address) return;
    let active = true;
    reverseGeocode(incident)
      .then((a) => {
        if (!active) return;
        setAddress(a);
        void setIncidentAddress(incident.id, a).catch(() => undefined);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Road route + ETA from this unit.
  useEffect(() => {
    if (!me) {
      onRoute(null);
      return;
    }
    let active = true;
    fetchRoute(me, incident, "car")
      .then((r) => {
        if (!active) return;
        setEta({ duration_s: r.duration_s, distance_m: r.distance_m });
        onRoute(r.geometry);
      })
      .catch(() => {
        if (active) onRoute([[me.lng, me.lat], [incident.lng, incident.lat]]);
      });
    return () => {
      active = false;
    };
  }, [hasFix]); // eslint-disable-line react-hooks/exhaustive-deps

  async function change(status: IncidentStatus) {
    if (pending) return;
    setPending(status);
    try {
      navigator.vibrate?.(40);
    } catch {
      /* unsupported */
    }
    try {
      await setIncidentStatus(incident.id, status);
      if (status === "FALSE_ALARM") toast.success("False alarm — pin removed from all tactical maps");
      else if (status === "RESOLVED") toast.success("Incident resolved");
      else toast.success(`Status: ${INCIDENT_LABEL[status]}`);
      if (status === "FALSE_ALARM" || status === "RESOLVED") onClose();
    } catch (err) {
      toast.error("Status update failed", { description: (err as Error).message });
    } finally {
      setPending(null);
    }
  }

  const straight = me ? haversineMeters(me, incident) : null;

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-line p-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={incident.status === "ACTIVE" ? "alarm" : incident.status === "EN_ROUTE" ? "caution" : "ice"}>
              <Siren className="size-3" /> {INCIDENT_LABEL[incident.status]}
            </Badge>
            {incident.queued_offline && <Badge tone="neutral">Sent after reconnect</Badge>}
          </div>
          <h2 className="mt-2 text-lg font-semibold leading-tight">Suspected overdose</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Clock className="size-3" /> Pinned {clockTime(incident.captured_at)}
            {now ? ` · ${timeAgo(incident.captured_at, now)}` : ""}
          </p>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-4" />
        </IconButton>
      </div>

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-line bg-deep p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Distance</div>
            <div className="mt-1 font-mono text-xl font-semibold">
              {eta ? formatDistance(eta.distance_m) : straight !== null ? formatDistance(straight) : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-deep p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">ETA · driving</div>
            <div className="mt-1 flex items-center gap-2 font-mono text-xl font-semibold text-ice">
              {eta ? formatDuration(eta.duration_s) : me ? <LoaderCircle className="size-4 animate-spin text-muted" /> : "—"}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-deep p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted">Location</div>
          <div className="mt-1 text-[15px] font-semibold">
            {shownAddress ?? <span className="text-muted">Resolving address…</span>}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-ink-2">{formatCoord(incident)}</span>
            <button
              onClick={() => {
                void navigator.clipboard?.writeText(formatCoord(incident)).then(() => toast.success("Coordinates copied"));
              }}
              className="flex items-center gap-1 text-xs font-semibold text-ice hover:underline"
            >
              <Copy className="size-3" /> Copy
            </button>
          </div>
          {incident.accuracy_m != null && (
            <div className="mt-1 text-[11px] text-muted">GPS accuracy ±{Math.round(incident.accuracy_m)} m</div>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted">
          <UserRound className="size-3.5" />
          Reported by {incident.reporter_role === "observer" ? "trusted field observer" : incident.reporter_role.replace("_", " ")}
        </div>

        {me && (
          <a
            href={osmDirectionsUrl(me, incident, "car")}
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center justify-center gap-2 rounded-xl border border-line-strong bg-raised text-sm font-semibold hover:bg-[#1a212b]"
          >
            <Navigation className="size-4 text-ice" /> Turn-by-turn navigation <ExternalLink className="size-3 text-muted" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-line p-3">
        {STATUS_ACTIONS.map((a) => {
          const current = incident.status === a.status;
          return (
            <motion.button
              key={a.status}
              whileTap={{ scale: 0.96 }}
              disabled={pending !== null || current}
              onClick={() => void change(a.status)}
              className={cn(
                "flex h-14 items-center justify-center gap-2 rounded-xl border text-[15px] font-semibold transition-colors disabled:cursor-default",
                current ? a.on : cn("border-line-strong bg-raised text-ink", a.tone),
                pending && pending !== a.status && "opacity-50",
              )}
              aria-pressed={current}
            >
              {pending === a.status ? <LoaderCircle className="size-4 animate-spin" /> : <a.icon className="size-4" />}
              {a.label}
            </motion.button>
          );
        })}
      </div>
    </>
  );
}
