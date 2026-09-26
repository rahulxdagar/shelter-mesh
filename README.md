# Cold-Grid: Shelter Triage Mesh

Live shelter beds, intake matching, automatic cold-weather escalation ("Code Frost"), and an overdose alert mesh that notifies nearby naloxone carriers while 9-1-1 is called.

- Requirements: [docs/SRS.md](docs/SRS.md)
- Build plan and demo script: [docs/PLAN.md](docs/PLAN.md)

## Run it locally (no accounts needed)

Requires Node 22.18 or newer (Node runs the server's TypeScript directly).

```bash
npm run setup     # installs root, server and web
npm run dev       # API on :8080, web on :5173
```

Open http://localhost:5173 and pick a role. Each browser tab keeps its own role, so one laptop can play every part:

| Tab | Role | Try |
|---|---|---|
| 1 | City Operations · Alex | Dashboard. Open *Demo controls*. |
| 2 | Outreach worker · Sam | Location: *Demo: Parliament Hill*. Find a bed, hold it. Tap OVERDOSE. |
| 3 | Responder · Riley | Location: *Demo: Rideau Centre*. Go on duty. |
| 4 | Responder · Jordan | Location: *Demo: Confederation Park*. Go on duty. |
| 5 | Shelter intake | Pick the shelter the hold went to. Confirm arrival. |

Code Frost demo: in the ops tab, *Fill shelters (surge)*, then *Apply* a -22 °C / 30 km/h override, then *Simulate on-call reply AUTHORIZE* in Communications. Three overflow sites open on every map.

Without keys, every integration runs in a fallback mode, shown in the ops dashboard tags:

| Integration | Without keys | With keys |
|---|---|---|
| MongoDB | In-memory replica set (data resets on restart) | Atlas (`MONGODB_URI`) |
| Auth0 | Role picker, unsigned dev tokens | Auth0 login and RBAC |
| Google | OpenStreetMap tiles, straight-line walking estimate | Maps JS map, Routes API walk + transit times |
| Twilio | Messages appear in the ops Communications panel | Real SMS and voice calls, inbound webhook |
| Hedera | Local SHA-256 hash chain | Hashes on an HCS topic, verified via mirror node |
| Environment Canada | Always live (no key needed) | |
| Tiger Data | History panel off | Bed, weather and response-time history (`TIGER_DATABASE_URL`) |

## History (Tiger Data)

MongoDB holds live state; Tiger Data (TimescaleDB) holds history. Set `TIGER_DATABASE_URL` in `server/.env`:

- Tiger Cloud: the service URL from the Tiger console (`...tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require`).
- Local: `docker compose up -d timescale`, then `postgres://postgres:coldgrid@localhost:5433/coldgrid_dev` (create the database once with `docker compose exec timescale psql -U postgres -c "CREATE DATABASE coldgrid_dev"`).

Tables and aggregates are created on startup. In the ops dashboard, *History → Demo controls → Load 7 days of simulated history* fills the charts for a demo; those rows are labelled as simulated.

Some networks (campus Wi-Fi) block outbound Postgres ports. Check with `nc -z <host> <port>`; if blocked, use the local TimescaleDB or a phone hotspot. The deployed API is not affected.

## Tests

```bash
npm test          # 37 server tests on an in-memory MongoDB replica set
TEST_TIGER_URL=postgres://postgres:coldgrid@localhost:5433/postgres npm test   # + 7 TimescaleDB history tests
npm run typecheck
```

They cover the guarantees the demo relies on: exactly one of 10 concurrent holds gets the last bed, expired holds stop counting immediately, exactly one of two concurrent accepts wins and the other gets a stand-down, stale responders are not alerted, Code Frost needs both conditions and fires once, Twilio signatures and sender allow-lists are enforced, audit tampering is detected, and each role gets 403 outside its permissions.

## Configure the real integrations

Copy `server/.env.example` to `server/.env` and `web/.env.example` to `web/.env`, then fill in what you have. The checklist in [docs/PLAN.md §4](docs/PLAN.md) lists the console steps for each service.

Auth0 specifics:
- API identifier `https://api.coldgrid`, RBAC on, "Add Permissions in the Access Token" on.
- Permissions: `read:capacity write:capacity create:hold confirm:hold create:alert respond:alert execute:code_frost read:audit`.
- Roles as in [server/src/auth.ts](server/src/auth.ts) (`ROLE_PERMISSIONS`).
- The SPA must be authorized for **user access** to the API (APIs → Cold Grid → Application Access), otherwise login fails with "Client … is not authorized to access resource server".
- A post-login Action adds `https://coldgrid/name` and, for shelter staff, `https://coldgrid/shelter_id` to the access token:

```js
exports.onExecutePostLogin = async (event, api) => {
  api.accessToken.setCustomClaim('https://coldgrid/name', event.user.name ?? event.user.email);
  const shelter = event.user.app_metadata?.shelter_id;
  if (shelter) api.accessToken.setCustomClaim('https://coldgrid/shelter_id', shelter);
};
```

Hedera: put the testnet account in `.env`, run `npm --prefix server run hedera:topic`, and copy the printed `HEDERA_TOPIC_ID`.

## Production-like run in Docker

```bash
# ./.env (gitignored) needs AUTH0_DOMAIN and AUTH0_AUDIENCE; other integrations are optional
docker compose up -d --build     # API on :8081 (NODE_ENV=production) + MongoDB 8.2 replica set
docker compose logs -f api
docker compose down              # add -v to wipe the database
```

In this mode Auth0 is enforced, so the local web app needs `VITE_AUTH0_*` set to talk to it.

## Deploy

- **Web → Vercel.** Root directory `web`, build `npm run build`, output `dist`. Set the `VITE_*` variables, including `VITE_API_URL=https://api.<your-domain>`.
- **API → Cloud Run** (or Render/Railway; anything that keeps WebSockets open). `server/Dockerfile`. Set `NODE_ENV=production` (this requires `MONGODB_URI` and Auth0), `CORS_ORIGINS=https://app.<your-domain>`, `PUBLIC_API_URL=https://api.<your-domain>`, and `DEMO_CONTROLS=false` outside the demo. On Cloud Run, set the request timeout to 3600 s and enable session affinity for Socket.IO.
- **Twilio:** set the number's "A message comes in" webhook to `https://api.<your-domain>/api/twilio/sms`.

## Layout

```
server/src
  index.ts            boot: DB, seed, HTTP, Socket.IO, ledger worker, weather poller
  app.ts              all REST routes and the Twilio webhook
  auth.ts             Auth0 JWT verification (jose), dev tokens, permission guard
  realtime.ts         Socket.IO rooms, change streams -> snapshot broadcast, hold-expiry sweep, presence
  db.ts, config.ts, types.ts, seed.ts
  services/
    capacity.ts       derived availability, snapshot, exactly-once shelter_full
    matching.ts       $geoNear + eligibility filter, travel-time sort
    routes.ts         Google Routes API matrix, fallback estimate, Maps URLs
    holds.ts          hold transaction, confirm, cancel
    incidents.ts      responder discovery, atomic claim, stand-down, resolve
    codefrost.ts      threshold engine, dispatch, authorize, end, poller
    weather.ts        Environment Canada feed, wind chill
    twilio.ts         SMS, voice, outbox, signature check
    audit.ts          canonical hashing, chain, ledger queue, verification
    history.ts        Tiger Data: hypertables, continuous aggregates, sampler, trend queries, simulated backfill
    hedera.ts         HCS client and topic submit
web/src
  views/              Outreach, Responder, Shelter, Ops, History (charts)
  map/                Google map, Leaflet fallback
  auth.tsx, live.tsx, geo.tsx, i18n.tsx (EN/FR), components.tsx, styles.css
```

## Known limits

- Web Push is not implemented. Responders get alerts while the app is open (on-duty mode); an iOS home-screen PWA with push permission is the next step.
- The local audit chain is serialized per API process. With several instances, Hedera ordering is the source of truth.
- Demo shelter data is fictional, placed at real Ottawa neighbourhoods.
