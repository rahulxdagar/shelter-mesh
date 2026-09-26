# Cold-Grid · Shelter Triage Mesh

Real-time inter-agency shelter triage and emergency dispatch for the City of Ottawa. One PWA with five role views, backed by Supabase (Postgres + PostGIS + Realtime).

| Role | Route | What it does |
| --- | --- | --- |
| Street Outreach | `/outreach` | Mobile intake → nearest compatible beds (PostGIS `ST_Distance`) → 1-tap 20-min **Hold Bed**, turn-by-turn walking directions, 2-second **Drop Pin** in the nav bar |
| Shelter Intake | `/shelter` | ± bed / warming-chair telemetry, live incoming referral queue with synced countdowns, **Client Checked In**, 1-click walk-in overflow reroute |
| EMS Crisis Team | `/ems` | Tactical radar map of overdose pins, distance/ETA, drawer with reverse-geocoded address and En Route / On Scene / Resolved / False Alarm |
| City Ops · 3-1-1 | `/ops` | Municipal capacity map and meters, Code Frost banner, warming-hub authorization |
| Field Observer | `/observer` | Drop Pin only |

## Setup

1. `npm install`
2. Create `.env.local` (see `.env.example`):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: from Supabase → Project Settings → API
   - `SUPABASE_DB_URL`: Postgres connection string with your password (only used by the `db:*` scripts)
3. `npm run db:setup` applies `supabase/migrations/*` and loads the demo seed
4. `npm run dev`

The migrations enable `postgis`, `pg_cron` and `http` and schedule two jobs: expiring lapsed holds every minute and evaluating Code Frost every 15 minutes.

`npm run db:seed` resets the demo at any time. It restores inventory and clears holds, pins and alerts.

### Demo accounts

All demo accounts use the password `ColdGrid-2026!`. The login screen has one-tap buttons for the main ones.

| Email | Role |
| --- | --- |
| `outreach@coldgrid.demo`, `outreach2@coldgrid.demo` | Street Outreach (use two to demo the last-bed race) |
| `staff.mission@`, `staff.booth@`, `staff.shepherds@`, `staff.cornerstone@`, `staff.ysb@`, `staff.carling@`, `staff.respite@` + `coldgrid.demo` | Shelter Intake for each facility |
| `ems@coldgrid.demo`, `ems2@coldgrid.demo` | EMS |
| `ops@coldgrid.demo` | City Ops |
| `observer@coldgrid.demo` | Field Observer |

Facility names, addresses and coordinates are real. Bed counts are demo values that put the network at about 98% occupancy, so a few holds push it past the 99% Code Frost trigger.

## How the core rules are enforced

- **Every write goes through a Postgres function** (`hold_bed`, `check_in_hold`, `create_incident`, …). RLS makes tables read-only to clients and scopes rows by role.
- **Last-bed race:** `private.claim_bed` takes `SELECT … FOR UPDATE` on the shelter row. The first transaction wins, and later ones raise `OUT_OF_STOCK`, which makes the client re-query and show the next nearest facility.
- **20-minute hold:** a hold decrements public inventory and is marked `HELD`. When the countdown reaches zero, the client calls `expire_holds()`, and a pg_cron sweep runs every minute as a backstop. Expiry restores the bed. The outreach worker then gets **Reservation Expired: Re-Hold or Re-Route**, and Re-Hold locks the bed again for 10 minutes if one is still free.
- **Code Frost:** `private.evaluate_code_frost()` fetches Ottawa weather from Open-Meteo (free, no key) and computes the Environment Canada wind chill. It sets `code_frost` when wind chill ≤ **−5 °C** and network occupancy ≥ **99 %**, then alerts City Ops, outreach, shelters and EMS. Ops can override it (Auto / Force on / Force off) and unlock the warming hubs, which then appear in triage matches.
- **Offline:** the service worker caches the app shell and map tiles. The last capacity snapshot lives in IndexedDB. Triage done in a dead zone shows provisional matches from that snapshot and is queued. Pins are queued with an idempotency key. The queue replays through Background Sync, or through the page's `online` handler on browsers without it.

The service worker is only registered in production builds (`npm run build && npm start`). Test offline behaviour there.

## Free services used

- **Basemap:** CARTO Dark Matter vector style, rendered with MapLibre GL
- **Routing:** OSRM. Walking uses routing.openstreetmap.de; driving ETA uses router.project-osrm.org.
- **Reverse geocoding:** Nominatim, proxied through `/api/reverse` with a cache to respect the usage policy
- **Weather:** Open-Meteo
