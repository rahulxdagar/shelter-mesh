"use client";

import { supabase } from "./supabase";
import { rpc, RpcError } from "./errors";
import { dequeue, enqueue, listQueue, type QueuedAction } from "./offline";
import type { BedHold, Incident, ShelterMatch, Triage } from "./types";

// ─── Triage & holds ───────────────────────────────────────────────────────────
export function matchShelters(t: Triage, origin: { lat: number; lng: number }, exclude?: string) {
  return rpc<ShelterMatch[]>(
    supabase().rpc("match_shelters", {
      p_lat: origin.lat,
      p_lng: origin.lng,
      p_age: t.age,
      p_gender: t.gender,
      p_sobriety: t.sobriety,
      p_needs: t.needs,
      p_family: t.family,
      p_exclude: exclude ?? null,
      p_limit: 5,
    }),
  );
}

export const holdBed = (shelterId: string, clientLabel: string, triage: Triage) =>
  rpc<BedHold>(supabase().rpc("hold_bed", { p_shelter: shelterId, p_client_label: clientLabel, p_triage: triage }));

export const reholdBed = (holdId: string) => rpc<BedHold>(supabase().rpc("rehold_bed", { p_hold: holdId }));
export const checkInHold = (holdId: string) => rpc<BedHold>(supabase().rpc("check_in_hold", { p_hold: holdId }));
export const cancelHold = (holdId: string) => rpc<BedHold>(supabase().rpc("cancel_hold", { p_hold: holdId }));
export const expireHolds = () => rpc<number>(supabase().rpc("expire_holds"));

export const rerouteWalkIn = (clientLabel: string, triage: Triage) =>
  rpc<BedHold>(supabase().rpc("reroute_walk_in", { p_client_label: clientLabel, p_triage: triage }));

export const adjustInventory = (shelterId: string, resource: "beds" | "chairs", delta: number) =>
  rpc(supabase().rpc("adjust_inventory", { p_shelter: shelterId, p_resource: resource, p_delta: delta }));

// ─── Incidents ────────────────────────────────────────────────────────────────
export type PinResult =
  | { delivered: true; incident: Incident }
  | { delivered: false; clientRef: string };

function createIncident(clientRef: string, p: { lat: number; lng: number; accuracy: number | null; captured_at: string }, queued: boolean) {
  return rpc<Incident>(
    supabase().rpc("create_incident", {
      p_client_ref: clientRef,
      p_lat: p.lat,
      p_lng: p.lng,
      p_accuracy: p.accuracy,
      p_captured_at: p.captured_at,
      p_queued: queued,
    }),
  );
}

/** Broadcasts an overdose pin, or queues it locally when the device has no signal. */
export async function dropPin(pos: { lat: number; lng: number; accuracy: number | null }): Promise<PinResult> {
  const clientRef = crypto.randomUUID();
  const payload = { ...pos, captured_at: new Date().toISOString() };
  if (navigator.onLine) {
    try {
      return { delivered: true, incident: await createIncident(clientRef, payload, false) };
    } catch (err) {
      if (!(err instanceof RpcError) || err.code !== "NETWORK") throw err;
    }
  }
  await enqueue({ id: clientRef, type: "incident", payload, created_at: payload.captured_at });
  return { delivered: false, clientRef };
}

export const setIncidentStatus = (id: string, status: Incident["status"]) =>
  rpc<Incident>(supabase().rpc("set_incident_status", { p_incident: id, p_status: status }));

export const setIncidentAddress = (id: string, address: string) =>
  rpc<void>(supabase().rpc("set_incident_address", { p_incident: id, p_address: address }));

// ─── Offline queue replay ─────────────────────────────────────────────────────
export type TriageSyncedDetail = {
  id: string;
  triage: Triage;
  client_label: string;
  origin: { lat: number; lng: number };
  matches: ShelterMatch[];
};
export const TRIAGE_SYNCED = "coldgrid:triage-synced";
export const PIN_SYNCED = "coldgrid:pin-synced";

let flushing = false;

/** Pushes every queued action to the server. Safe to call repeatedly; the server dedupes pins. */
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    const items: QueuedAction[] = await listQueue();
    for (const item of items) {
      try {
        if (item.type === "incident") {
          const incident = await createIncident(item.id, item.payload, true);
          window.dispatchEvent(new CustomEvent(PIN_SYNCED, { detail: incident }));
        } else {
          const { triage, client_label, lat, lng } = item.payload;
          const matches = await matchShelters(triage, { lat, lng });
          window.dispatchEvent(
            new CustomEvent<TriageSyncedDetail>(TRIAGE_SYNCED, {
              detail: { id: item.id, triage, client_label, origin: { lat, lng }, matches },
            }),
          );
        }
        await dequeue(item.id);
        sent++;
      } catch (err) {
        // Still offline: stop and retry on the next reconnect. Anything else is unrecoverable.
        if (err instanceof RpcError && err.code === "NETWORK") break;
        await dequeue(item.id);
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
