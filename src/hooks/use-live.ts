"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { loadSnapshot, saveSnapshot } from "@/lib/offline";
import type { Alert, BedHold, Incident, Shelter, SystemState } from "@/lib/types";

type Row = { id: string | number };

type LiveOptions<T extends Row> = {
  table: string;
  /** Unique per subscription so two views of the same table don't share a channel. */
  channel: string;
  load: () => PromiseLike<{ data: T[] | null; error: unknown }>;
  /** Rows that fail this are dropped when they arrive via realtime. */
  keep?: (row: T) => boolean;
  sort?: (a: T, b: T) => number;
  enabled?: boolean;
  onChange?: (payload: RealtimePostgresChangesPayload<T>) => void;
  onLoaded?: (rows: T[]) => void;
};

/**
 * Initial fetch + Supabase Realtime postgres_changes, merged by id. Refetches whenever
 * the socket resubscribes, the tab regains focus, or the device comes back online, so a
 * dropped WebSocket can never leave a view silently stale.
 */
export function useLiveTable<T extends Row>(opts: LiveOptions<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef(opts);
  useLayoutEffect(() => {
    ref.current = opts;
  });
  const enabled = opts.enabled ?? true;
  const uid = useId();

  const apply = useCallback((next: T[]) => {
    const { keep, sort } = ref.current;
    let out = keep ? next.filter(keep) : next;
    if (sort) out = [...out].sort(sort);
    return out;
  }, []);

  const refetch = useCallback(async () => {
    const { data, error } = await ref.current.load();
    if (error || !data) {
      setError((error as { message?: string })?.message ?? "Failed to load");
      setLoading(false);
      return;
    }
    setError(null);
    setRows(apply(data));
    setLoading(false);
    ref.current.onLoaded?.(data);
  }, [apply]);

  useEffect(() => {
    if (!enabled) return;
    const sb = supabase();
    const channel = sb
      .channel(`live:${opts.channel}:${uid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: opts.table }, (payload) => {
        const p = payload as RealtimePostgresChangesPayload<T>;
        setRows((prev) => {
          if (p.eventType === "DELETE") {
            const oldId = (p.old as Partial<T>).id;
            return prev.filter((r) => r.id !== oldId);
          }
          const row = p.new as T;
          const without = prev.filter((r) => r.id !== row.id);
          return apply([...without, row]);
        });
        ref.current.onChange?.(p);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          // First subscribe and every reconnect: resync anything missed while disconnected.
          void refetch();
        }
      });

    // Load immediately too, so data appears even if the socket is slow or blocked.
    void refetch();

    const resync = () => document.visibilityState === "visible" && void refetch();
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
      void sb.removeChannel(channel);
    };
  }, [enabled, opts.channel, opts.table, uid, refetch, apply]);

  return { rows, setRows, loading, error, refetch };
}

// ─── Domain hooks ─────────────────────────────────────────────────────────────
const SHELTER_COLUMNS =
  "id, slug, name, operator, address, phone, kind, lat, lng, demographics_supported, min_age, max_age, total_beds, available_beds, total_chairs, available_chairs, is_active, updated_at";

export function useShelters(channel = "shelters") {
  const [snapshotAt, setSnapshotAt] = useState<string | null>(null);
  const live = useLiveTable<Shelter>({
    table: "shelters",
    channel,
    load: () => supabase().from("shelters").select(SHELTER_COLUMNS).order("name"),
    sort: (a, b) => a.name.localeCompare(b.name),
    onLoaded: (rows) => {
      setSnapshotAt(null);
      void saveSnapshot(rows);
    },
  });

  const { rows, loading, error, setRows } = live;
  // Dead zone: serve the last capacity snapshot from IndexedDB.
  useEffect(() => {
    if (!error || rows.length) return;
    void loadSnapshot().then((snap) => {
      if (snap) {
        setRows(snap.shelters);
        setSnapshotAt(snap.saved_at);
      }
    });
  }, [error, rows.length, setRows]);

  // Keep the snapshot current as realtime updates stream in.
  useEffect(() => {
    if (!loading && !error && rows.length) void saveSnapshot(rows);
  }, [rows, loading, error]);

  return { ...live, snapshotAt };
}

export function useSystemState() {
  const live = useLiveTable<SystemState & { id: 1 }>({
    table: "system_state",
    channel: "system_state",
    load: () => supabase().from("system_state").select("*").eq("id", 1),
  });
  return { state: live.rows[0] ?? null, ...live };
}

export function useAlerts(channel = "alerts", limit = 30) {
  return useLiveTable<Alert>({
    table: "alerts",
    channel,
    load: () => supabase().from("alerts").select("*").order("created_at", { ascending: false }).limit(limit),
    sort: (a, b) => b.created_at.localeCompare(a.created_at),
  });
}

export function useHolds(opts: {
  channel: string;
  enabled?: boolean;
  load: () => PromiseLike<{ data: unknown; error: unknown }>;
  keep?: (h: BedHold) => boolean;
  onChange?: (payload: RealtimePostgresChangesPayload<BedHold>) => void;
}) {
  return useLiveTable<BedHold>({
    table: "bed_holds",
    channel: opts.channel,
    enabled: opts.enabled,
    load: opts.load as () => PromiseLike<{ data: BedHold[] | null; error: unknown }>,
    keep: opts.keep,
    sort: (a, b) => b.created_at.localeCompare(a.created_at),
    onChange: opts.onChange,
  });
}

export function useIncidents(opts: {
  channel: string;
  onChange?: (payload: RealtimePostgresChangesPayload<Incident>) => void;
  keep?: (i: Incident) => boolean;
  sinceHours?: number;
}) {
  const hours = opts.sinceHours ?? 12;
  return useLiveTable<Incident>({
    table: "incidents",
    channel: opts.channel,
    load: () =>
      supabase()
        .from("incidents")
        .select("id, client_ref, lat, lng, accuracy_m, address, status, reported_by, reporter_role, responder_id, captured_at, created_at, updated_at, queued_offline")
        .gte("created_at", new Date(Date.now() - hours * 3_600_000).toISOString())
        .order("created_at", { ascending: false }),
    keep: opts.keep,
    sort: (a, b) => b.created_at.localeCompare(a.created_at),
    onChange: opts.onChange,
  });
}

// ─── Clock & connectivity ─────────────────────────────────────────────────────
const tickers = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let tickNow = Date.now();

function subscribeTick(fn: () => void) {
  tickers.add(fn);
  if (!tickTimer) {
    tickTimer = setInterval(() => {
      tickNow = Date.now();
      tickers.forEach((t) => t());
    }, 250);
  }
  return () => {
    tickers.delete(fn);
    if (!tickers.size && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** One shared 4 Hz clock so every countdown on screen flips in lockstep. */
export function useNow() {
  return useSyncExternalStore(subscribeTick, () => tickNow, () => 0);
}

function subscribeOnline(fn: () => void) {
  window.addEventListener("online", fn);
  window.addEventListener("offline", fn);
  return () => {
    window.removeEventListener("online", fn);
    window.removeEventListener("offline", fn);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}
