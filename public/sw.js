/* Cold-Grid service worker: app-shell caching, map tile caching, and background replay of queued pins. */
const VERSION = "coldgrid-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const TILE_CACHE = `${VERSION}-tiles`;
const TILE_LIMIT = 1500;
const SHELL_ROUTES = ["/", "/login", "/outreach", "/observer", "/ems", "/shelter", "/ops", "/offline.html"];
const SYNC_TAG = "coldgrid-queue";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => Promise.allSettled(SHELL_ROUTES.map((r) => cache.add(new Request(r, { cache: "reload" })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isTile(url) {
  return /basemaps\.cartocdn\.com|tiles\.basemaps|cartocdn/.test(url.hostname);
}

async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Live data (Supabase REST/Realtime) and our API proxies are never cached here —
  // the app keeps its own IndexedDB snapshot of capacity.
  if (url.hostname.endsWith("supabase.co") || url.pathname.startsWith("/api/")) return;

  // Page navigations: network first, fall back to the cached shell for that route.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(request, { ignoreSearch: true })) ||
            (await cache.match("/offline.html")) ||
            Response.error()
          );
        }),
    );
    return;
  }

  // Immutable build assets and vendored worker: cache first.
  if (url.origin === self.location.origin && (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/vendor/") || url.pathname.startsWith("/icons/"))) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      }),
    );
    return;
  }

  // Basemap style, glyphs and tiles: stale-while-revalidate so maps render in dead zones.
  if (isTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) {
              cache.put(request, res.clone());
              trimCache(TILE_CACHE, TILE_LIMIT);
            }
            return res;
          })
          .catch(() => hit || Response.error());
        return hit || network;
      }),
    );
  }
});

// ─── Background sync: replay emergency pins captured offline ─────────────────
function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("coldgrid", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const result = fn(t.objectStore(store));
    t.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
  });
}

async function replayQueue() {
  const db = await idb();
  const config = await tx(db, "kv", "readonly", (s) => s.get("sync-config"));
  if (!config || !config.accessToken) return;
  const items = (await tx(db, "queue", "readonly", (s) => s.getAll())) || [];

  for (const item of items) {
    // Triage re-runs need the UI to present results; the page handles those when it opens.
    if (item.type !== "incident") continue;
    const res = await fetch(`${config.url}/rest/v1/rpc/create_incident`, {
      method: "POST",
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_client_ref: item.id,
        p_lat: item.payload.lat,
        p_lng: item.payload.lng,
        p_accuracy: item.payload.accuracy,
        p_captured_at: item.payload.captured_at,
        p_queued: true,
      }),
    });
    if (res.ok) {
      await tx(db, "queue", "readwrite", (s) => s.delete(item.id));
    } else if (res.status === 401) {
      return; // token expired: the page refreshes it and flushes on next open
    } else {
      throw new Error(`Replay failed: ${res.status}`); // let the browser retry the sync
    }
  }
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage({ type: "queue-flushed" }));
}

self.addEventListener("sync", (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replayQueue());
});
