"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Shelter, ShelterMatch, Triage } from "./types";

// Keep in sync with public/sw.js, which reads the same database during background sync.
const DB_NAME = "coldgrid";
const DB_VERSION = 1;
export const SYNC_TAG = "coldgrid-queue";

export type QueuedIncident = {
  id: string; // client_ref: idempotency key on the server
  type: "incident";
  payload: { lat: number; lng: number; accuracy: number | null; captured_at: string };
  created_at: string;
};

export type QueuedTriage = {
  id: string;
  type: "triage";
  payload: { triage: Triage; client_label: string; lat: number; lng: number };
  created_at: string;
};

export type QueuedAction = QueuedIncident | QueuedTriage;

type Snapshot = { shelters: Shelter[]; saved_at: string };
type SyncConfig = { url: string; anonKey: string; accessToken: string | null };

interface ColdGridDB extends DBSchema {
  kv: { key: string; value: Snapshot | SyncConfig };
  queue: { key: string; value: QueuedAction };
}

let dbPromise: Promise<IDBPDatabase<ColdGridDB>> | null = null;

function db() {
  dbPromise ??= openDB<ColdGridDB>(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
      if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "id" });
    },
  });
  return dbPromise;
}

// ─── Capacity snapshot ────────────────────────────────────────────────────────
export async function saveSnapshot(shelters: Shelter[]) {
  try {
    await (await db()).put("kv", { shelters, saved_at: new Date().toISOString() }, "snapshot");
  } catch {
    /* storage unavailable (private mode) — live data still works */
  }
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    return ((await (await db()).get("kv", "snapshot")) as Snapshot | undefined) ?? null;
  } catch {
    return null;
  }
}

/** Lets the service worker replay queued pins with the signed-in user's token. */
export async function saveSyncConfig(cfg: SyncConfig) {
  try {
    await (await db()).put("kv", cfg, "sync-config");
  } catch {
    /* ignore */
  }
}

// ─── Action queue ─────────────────────────────────────────────────────────────
const listeners = new Set<() => void>();
export function onQueueChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function emit() {
  listeners.forEach((fn) => fn());
}

export async function enqueue(action: QueuedAction) {
  await (await db()).put("queue", action);
  emit();
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } })?.sync;
    await sync?.register(SYNC_TAG);
  } catch {
    /* Background Sync unsupported — the page flushes on the next `online` event instead */
  }
}

export async function listQueue(): Promise<QueuedAction[]> {
  try {
    return (await (await db()).getAll("queue")).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch {
    return [];
  }
}

export async function dequeue(id: string) {
  await (await db()).delete("queue", id);
  emit();
}

// ─── Offline matching from the cached snapshot ────────────────────────────────
function genderTags(g: Triage["gender"]): string[] {
  if (g === "man" || g === "trans_man") return ["men"];
  if (g === "woman" || g === "trans_woman") return ["women"];
  return ["gender_diverse"];
}

/** Mirrors public.match_shelters so outreach sees provisional results in a dead zone. */
export function matchLocally(shelters: Shelter[], t: Triage, origin: { lat: number; lng: number }, limit = 5): ShelterMatch[] {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  return shelters
    .filter((s) => {
      const tags = s.demographics_supported;
      if (!s.is_active || s.available_beds <= 0) return false;
      if (t.age < s.min_age || t.age > s.max_age) return false;
      if (t.family ? !tags.includes("families") : !genderTags(t.gender).some((g) => tags.includes(g))) return false;
      if (t.sobriety !== "abstinent" && !tags.includes("low_barrier")) return false;
      return t.needs.every((n) => tags.includes(n));
    })
    .map((s) => {
      const dLat = rad(s.lat - origin.lat);
      const dLng = rad(s.lng - origin.lng);
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(origin.lat)) * Math.cos(rad(s.lat)) * Math.sin(dLng / 2) ** 2;
      return { ...s, distance_m: 2 * R * Math.asin(Math.sqrt(h)) };
    })
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}
