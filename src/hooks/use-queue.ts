"use client";

import { useEffect, useState } from "react";
import { listQueue, onQueueChange, type QueuedAction } from "@/lib/offline";

export function useQueue() {
  const [items, setItems] = useState<QueuedAction[]>([]);
  useEffect(() => {
    let active = true;
    const refresh = () => void listQueue().then((q) => active && setItems(q));
    refresh();
    const off = onQueueChange(refresh);
    // The service worker may drain the queue in the background.
    navigator.serviceWorker?.addEventListener("message", refresh);
    return () => {
      active = false;
      off();
      navigator.serviceWorker?.removeEventListener("message", refresh);
    };
  }, []);
  return items;
}
