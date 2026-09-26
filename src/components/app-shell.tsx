"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CloudOff, LogOut, Snowflake, Wifi } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "./auth-provider";
import { IconButton } from "./ui";
import { useOnline, useSystemState } from "@/hooks/use-live";
import { useQueue } from "@/hooks/use-queue";
import { flushQueue } from "@/lib/actions";
import { cn } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/types";

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-8 items-center justify-center rounded-[9px] border border-ice/30 bg-ice-dim/40">
        <Snowflake className="size-[18px] text-ice" strokeWidth={2.25} />
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-alarm shadow-[0_0_8px_rgb(255_59_78)]" />
      </div>
      {!compact && (
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-[-0.02em]">Cold-Grid</div>
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Shelter Triage Mesh</div>
        </div>
      )}
    </div>
  );
}

/** Online state, queued offline actions, and automatic replay on reconnect. */
export function ConnectionPill() {
  const online = useOnline();
  const queue = useQueue();

  useEffect(() => {
    if (!online) return;
    void flushQueue().then((n) => {
      if (n > 0) toast.success(`Reconnected — ${n} queued action${n > 1 ? "s" : ""} delivered`);
    });
  }, [online]);

  return (
    <div
      className={cn(
        "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold",
        online ? "border-line bg-raised text-ink-2" : "border-caution/40 bg-caution-dim text-caution",
      )}
      role="status"
    >
      {online ? <Wifi className="size-3.5 text-go" /> : <CloudOff className="size-3.5" />}
      <span className="hidden sm:inline">{online ? "Live" : "Offline"}</span>
      {queue.length > 0 && (
        <span className="rounded bg-caution px-1.5 font-mono text-[11px] text-void">{queue.length} queued</span>
      )}
    </div>
  );
}

export function FrostChip() {
  const { state } = useSystemState();
  return (
    <AnimatePresence>
      {state?.code_frost && (
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          className="flex h-8 items-center gap-1.5 rounded-lg border border-frost/40 bg-frost/10 px-2.5 text-xs font-bold uppercase tracking-[0.08em] text-frost"
        >
          <Snowflake className="size-3.5 animate-[spin_6s_linear_infinite]" />
          <span className="hidden sm:inline">Code Frost</span>
          {state.windchill_c != null && <span className="font-mono">{Number(state.windchill_c).toFixed(0)}°</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TopBar({ title, right, className }: { title?: ReactNode; right?: ReactNode; className?: string }) {
  const auth = useAuth();
  const profile = auth.status === "ready" ? auth.profile : null;
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line bg-void/85 px-3 backdrop-blur-xl sm:px-4",
        className,
      )}
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Logo compact />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">{title ?? (profile ? ROLE_LABEL[profile.role] : "Cold-Grid")}</div>
          {profile && (
            <div className="truncate font-mono text-[11px] text-muted">
              {profile.callsign ?? profile.full_name}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {right}
        <FrostChip />
        <ConnectionPill />
        <IconButton label="Sign out" onClick={() => void auth.signOut()}>
          <LogOut className="size-4" />
        </IconButton>
      </div>
    </header>
  );
}

export function FullscreenLoader({ label = "Connecting to the mesh…" }: { label?: string }) {
  return (
    <div className="grid-field flex min-h-dvh flex-col items-center justify-center gap-4 bg-void">
      <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }}>
        <Snowflake className="size-8 text-ice" />
      </motion.div>
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
