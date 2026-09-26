"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CloudOff, LoaderCircle, Siren } from "lucide-react";
import { toast } from "sonner";
import { dropPin, type PinResult } from "@/lib/actions";
import { describeGeoError, getPosition } from "@/lib/geo";
import { cn } from "@/lib/format";

export const HOLD_MS = 2000;

type Phase = "idle" | "arming" | "locating" | "sending" | "sent" | "queued";

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* unsupported */
  }
}

/**
 * Press-and-hold overdose beacon. Holding for 2 continuous seconds captures GPS and broadcasts
 * an incident; releasing early aborts. GPS acquisition starts on press so the fix is ready at 2s.
 */
type Point = { lat: number; lng: number; accuracy: number | null };

export function DropPinButton({
  variant,
  lastFix,
  onResult,
}: {
  variant: "nav" | "hero";
  /** Latest fix from a running GPS watch; used if a fresh reading is slow, so the alert never stalls. */
  lastFix?: (Point & { at: number }) | null;
  onResult?: (r: PinResult & Point) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const started = useRef(0);
  const fix = useRef<Promise<GeolocationPosition> | null>(null);
  const pulse = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const lastFixRef = useRef(lastFix);
  useEffect(() => {
    lastFixRef.current = lastFix;
  }, [lastFix]);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const stopTimers = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    if (pulse.current) clearInterval(pulse.current);
    raf.current = null;
    pulse.current = null;
  };

  useEffect(() => stopTimers, []);

  const fire = useCallback(async () => {
    stopTimers();
    vibrate([80, 60, 220]);
    setPhase("locating");
    const fresh: Promise<Point> = (fix.current ?? getPosition()).then((p) => ({
      lat: p.coords.latitude,
      lng: p.coords.longitude,
      accuracy: p.coords.accuracy ?? null,
    }));
    fresh.catch(() => undefined); // a late failure after the fallback won is irrelevant
    // watchPosition only reports movement, so a stationary device's last fix can be minutes old.
    const recent = lastFixRef.current && Date.now() - lastFixRef.current.at < 120_000 ? lastFixRef.current : null;
    let point: Point;
    try {
      point = recent
        ? await Promise.race([
            fresh,
            new Promise<Point>((resolve) => setTimeout(() => resolve({ lat: recent.lat, lng: recent.lng, accuracy: recent.accuracy }), 1500)),
          ])
        : await fresh;
    } catch (err) {
      if (!recent) {
        toast.error("Pin not sent — no GPS fix", { description: describeGeoError(err) });
        setPhase("idle");
        setProgress(0);
        return;
      }
      point = { lat: recent.lat, lng: recent.lng, accuracy: recent.accuracy };
    }
    setPhase("sending");
    try {
      const result = await dropPin(point);
      setPhase(result.delivered ? "sent" : "queued");
      onResult?.({ ...result, ...point });
      if (result.delivered) {
        toast.success("Emergency pin broadcast to EMS", { description: "All crisis units in range have been alerted." });
      } else {
        toast.warning("No signal — pin queued", { description: "It will transmit automatically the moment you reconnect." });
      }
    } catch (err) {
      toast.error("Pin failed to send", { description: (err as Error).message });
      setPhase("idle");
    }
    setTimeout(() => {
      if (phaseRef.current === "sent" || phaseRef.current === "queued") {
        setPhase("idle");
        setProgress(0);
      }
    }, 4000);
  }, [onResult]);

  const begin = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    setPhase("arming");
    started.current = performance.now();
    fix.current = getPosition({ maximumAge: 5_000 });
    fix.current.catch(() => undefined); // handled when the hold completes
    vibrate(30);
    pulse.current = setInterval(() => vibrate(25), 500);
    const step = (t: number) => {
      const p = Math.min(1, (t - started.current) / HOLD_MS);
      setProgress(p);
      if (p >= 1) void fire();
      else raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  }, [fire]);

  const abort = useCallback(() => {
    if (phaseRef.current !== "arming") return;
    stopTimers();
    fix.current = null;
    setPhase("idle");
    setProgress(0);
  }, []);

  const busy = phase === "locating" || phase === "sending";
  const hero = variant === "hero";
  const size = hero ? 248 : 76;
  const stroke = hero ? 10 : 5;
  const r = size / 2 - stroke;
  const c = 2 * Math.PI * r;

  const label =
    phase === "arming"
      ? "Keep holding…"
      : phase === "locating"
        ? "Getting GPS fix…"
        : phase === "sending"
          ? "Broadcasting…"
          : phase === "sent"
            ? "EMS alerted"
            : phase === "queued"
              ? "Queued — will send"
              : "Hold 2s — overdose";

  return (
    <div className={cn("flex flex-col items-center", hero ? "gap-6" : "gap-1")}>
      <motion.button
        type="button"
        aria-label="Emergency overdose pin. Press and hold for two seconds."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          begin();
        }}
        onPointerUp={abort}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
        onKeyDown={(e) => {
          if ((e.key === " " || e.key === "Enter") && !e.repeat) {
            e.preventDefault();
            begin();
          }
        }}
        onKeyUp={(e) => (e.key === " " || e.key === "Enter") && abort()}
        onContextMenu={(e) => e.preventDefault()}
        animate={{ scale: phase === "arming" ? 0.94 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 22 }}
        className={cn(
          "relative touch-none select-none rounded-full outline-none [-webkit-touch-callout:none]",
          "focus-visible:ring-4 focus-visible:ring-alarm/50",
        )}
        style={{ width: size, height: size }}
        disabled={busy}
      >
        {/* idle beacon glow */}
        {phase === "idle" && (
          <span className="absolute inset-0 animate-ping-slow rounded-full bg-alarm/25" aria-hidden />
        )}
        <span
          className={cn(
            "absolute inset-0 rounded-full border-2 transition-colors",
            phase === "sent" ? "border-go bg-go" : phase === "queued" ? "border-caution bg-caution" : "border-[#ff7a87]/40 bg-alarm",
          )}
          style={{
            boxShadow:
              phase === "sent" || phase === "queued"
                ? "none"
                : `0 0 ${hero ? 80 : 24}px rgb(255 59 78 / ${0.35 + progress * 0.45}), inset 0 -${hero ? 16 : 5}px ${hero ? 40 : 12}px rgb(0 0 0 / 0.25)`,
          }}
        />
        <svg width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - progress)}
            className="fill-none stroke-white"
            style={{ opacity: phase === "arming" || busy ? 1 : 0, transition: "opacity 150ms" }}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center text-white">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={phase === "sent" ? "sent" : phase === "queued" ? "queued" : busy ? "busy" : "icon"}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.15 }}
              className={cn(phase === "sent" || phase === "queued" ? "text-void" : "text-white")}
            >
              {phase === "sent" ? (
                <Check className={hero ? "size-20" : "size-8"} strokeWidth={3} />
              ) : phase === "queued" ? (
                <CloudOff className={hero ? "size-20" : "size-8"} strokeWidth={2.5} />
              ) : busy ? (
                <LoaderCircle className={cn("animate-spin", hero ? "size-20" : "size-8")} />
              ) : (
                <Siren className={hero ? "size-20" : "size-8"} strokeWidth={2.25} />
              )}
            </motion.span>
          </AnimatePresence>
          {hero && (
            <span className="mt-3 text-[13px] font-bold uppercase tracking-[0.14em] text-white/90">
              {phase === "idle" || phase === "arming" ? "Drop pin" : ""}
            </span>
          )}
        </span>
      </motion.button>
      <span
        className={cn(
          "font-semibold uppercase tracking-[0.1em]",
          hero ? "text-sm text-ink-2" : "text-[10px] text-alarm",
          phase === "sent" && "text-go",
          phase === "queued" && "text-caution",
        )}
        aria-live="polite"
      >
        {hero ? label : phase === "idle" ? "Drop pin" : label}
      </span>
    </div>
  );
}
