"use client";

import { useEffect, useRef } from "react";
import { useNow } from "@/hooks/use-live";
import { cn } from "@/lib/format";

export function remainingMs(expiresAt: string, now: number) {
  return Math.max(0, new Date(expiresAt).getTime() - now);
}

export function formatClock(ms: number) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function toneFor(ms: number) {
  if (ms <= 60_000) return { text: "text-alarm", stroke: "stroke-alarm" };
  if (ms <= 5 * 60_000) return { text: "text-caution", stroke: "stroke-caution" };
  return { text: "text-ice", stroke: "stroke-ice" };
}

/** Fires `onZero` exactly once when the deadline passes (used to trigger server-side expiry). */
function useZero(expiresAt: string, ms: number, onZero?: () => void) {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (ms === 0 && onZero && fired.current !== expiresAt) {
      fired.current = expiresAt;
      onZero();
    }
  }, [ms, expiresAt, onZero]);
}

export function Countdown({
  expiresAt,
  className,
  onZero,
}: {
  expiresAt: string;
  className?: string;
  onZero?: () => void;
}) {
  const now = useNow();
  const ms = now ? remainingMs(expiresAt, now) : 0;
  useZero(expiresAt, now ? ms : -1, onZero);
  const tone = toneFor(ms);
  return (
    <span className={cn("font-mono font-semibold tabular", tone.text, ms <= 60_000 && ms > 0 && "animate-pulse", className)}>
      {now ? formatClock(ms) : "--:--"}
    </span>
  );
}

export function CountdownRing({
  expiresAt,
  totalMinutes,
  size = 132,
  onZero,
}: {
  expiresAt: string;
  totalMinutes: number;
  size?: number;
  onZero?: () => void;
}) {
  const now = useNow();
  const ms = now ? remainingMs(expiresAt, now) : totalMinutes * 60_000;
  useZero(expiresAt, now ? ms : -1, onZero);
  const tone = toneFor(ms);
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, ms / (totalMinutes * 60_000));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={6} className="fill-none stroke-raised" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className={cn("fill-none transition-[stroke-dashoffset] duration-300 ease-linear", tone.stroke)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("font-mono text-[28px] font-semibold leading-none tabular", tone.text)}>
          {formatClock(ms)}
        </span>
        <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">hold left</span>
      </div>
    </div>
  );
}
