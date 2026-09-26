# Software Requirements Specification: "Cold-Grid" Shelter Triage Mesh

**Version:** 2.1 (revised for a buildable hackathon MVP)
**Supersedes:** v2.0
**Date:** 2026-09-26

---

## 0. What changed from v2.0 and why

| Area | v2.0 said | v2.1 says | Why |
|---|---|---|---|
| Overdose mesh framing | "Bypassing traditional 9-1-1 dispatch" | Alerts nearby naloxone carriers **in parallel with** 9-1-1. The app always prompts the reporter to call 9-1-1. | Bypassing 9-1-1 is a liability and ethics problem. Nearby responders cut time-to-naloxone; paramedics still need to come. |
| Hosting | Vercel/GCP edge | Web on Vercel (static). API on a long-running container (Cloud Run / Render / Railway). | Serverless functions cannot hold WebSockets or a MongoDB change stream open. |
| Bed hold expiry | TTL deletes the hold and "releases the bed" | Availability is **derived**: `capacity - occupied - active holds`, where an active hold has `expireAt > now`. TTL only garbage-collects. | TTL deletion runs on a ~60 s background sweep and cannot update other documents. Deriving availability makes expiry exact to the second. |
| Eligibility filter | MongoDB Atlas Search | `$geoNear` with a `query` filter on eligibility fields. | Atlas Search is full-text search. Hard constraints are an exact match and belong in the geo query. |
| Routing | Distance Matrix API, Directions API | Google **Routes API** (`computeRouteMatrix`) for travel times; Google **Maps URLs** to hand off turn-by-turn navigation. | Distance Matrix and Directions are Legacy APIs. Maps URLs open the native Maps app with no API key. |
| "First to accept" | Unspecified | Claim is a single atomic conditional update (`status: "open"` → `"claimed"`). | Otherwise two responders can both "win". |
| Responder discovery | "Logged in via Auth0" within 1 km | A responder is **on duty** when their app sent a location heartbeat within the last 5 minutes. | Auth0 knows identity, not location or availability. |
| Ledger | "Hedera / Blockchain / Smart Contracts" | **Hedera Consensus Service (HCS)**. Only a SHA-256 hash of each audit event goes on-chain. | HCS is the purpose-built timestamping service. No personal data or responder IDs on a public ledger. |
| Capacity colours | Green >10, Yellow 1-9, Red 0 | Green >= 10, Yellow 1-9, Red 0 | v2.0 left exactly 10 beds uncoloured. |
| Wind chill | Read windchill from the API | Compute from temperature and wind speed with the Environment Canada formula. | The live feed returned windchill -2 °C at an air temperature of 13 °C. The field is unreliable. |
| Code Frost authorization | Reply "AUTHORIZE" by SMS | Same, but the webhook verifies the Twilio signature and the sender's number against the on-call list. A dashboard button is the fallback. | An unauthenticated webhook lets anyone open overflow sites. |
| Triage PII | "TTL purges triage profiles" | Triage answers are **never stored**. They are used for one query and discarded. | Not storing data beats storing it briefly. |
| NFR claims | 99.99% SLA, PHIPA compliance, 500 ms guarantee | "Designed with PHIPA principles"; availability and latency are measured and reported, not guaranteed. | A hackathon prototype cannot certify compliance or an SLA. Judges will ask. |

---

## 1. Introduction

### 1.1 Purpose
Cold-Grid coordinates shelter capacity across a city, matches people to a bed they are actually eligible for, escalates automatically during extreme cold, and alerts nearby naloxone carriers to an overdose while 9-1-1 is being called.

### 1.2 Scope
A single installable web app (PWA) with role-based views, backed by one API service:

- **Outreach view** (phone): bed map, triage match, bed hold, overdose alert.
- **Responder view** (phone): on-duty toggle, incoming alerts, claim, navigate, resolve.
- **Shelter view** (desktop/tablet): occupancy controls, incoming holds, confirm arrival.
- **City Ops view** (desktop): city map, totals, weather, Code Frost, comms log, audit log.

Out of scope for the MVP: native mobile apps, integration with existing shelter management systems (data enters through our API or UI), real 9-1-1 CAD integration.

### 1.3 Users and permissions

| Role | Who | Permissions (JWT scopes) |
|---|---|---|
| `outreach` | Street outreach workers | `read:capacity`, `create:hold`, `create:alert` |
| `responder` | Paramedics, harm reduction workers carrying naloxone | `read:capacity`, `respond:alert`, `create:alert` |
| `shelter_admin` | Shelter intake staff (bound to one shelter) | `read:capacity`, `write:capacity`, `confirm:hold` |
| `city_ops` | 3-1-1 / City Operations supervisors | `read:capacity`, `write:capacity`, `execute:code_frost`, `read:audit` |

---

## 2. Technology stack and sponsor integrations

| Need | Technology | Exactly what we use it for |
|---|---|---|
| Data and geo | **MongoDB Atlas** | GeoJSON + `2dsphere` indexes; `$geoNear` for shelter matching and responder discovery; change streams for live updates; TTL indexes for holds and responder presence; multi-document transactions for bed holds. |
| SMS and voice | **Twilio** | Code Frost SMS + voice call to on-call managers; inbound SMS webhook for `AUTHORIZE` and for offline overdose alerts. |
| Maps and routing | **Google Maps Platform** | Maps JavaScript API (map and markers), Routes API `computeRouteMatrix` (walk/transit times), Maps URLs (navigation handoff). |
| Identity | **Auth0** | Login, RBAC; permissions in the access token; API verifies JWTs. |
| Audit | **Hedera Consensus Service** | Hash of each high-liability event submitted to an HCS topic; consensus timestamp and sequence number stored for verification. |
| Weather | **Environment Canada** (MSC GeoMet OGC API, `citypageweather-realtime`) | Current temperature and wind speed, polled every 15 minutes. |
| History | **Tiger Data** (TimescaleDB) | Time-series history: hypertables for bed availability, weather and overdose response events; continuous aggregates for trends; retention policies. MongoDB stays the live operational store. |
| Hosting | **Vercel** (web), **Cloud Run** (API), **Domain.com** (.tech domain) | Static PWA at the edge; API in a container that allows WebSockets. |

Every integration has a **local fallback** so the system runs with no keys (in-memory MongoDB, dev login, console "outbox" for Twilio, local hash chain for Hedera, OpenStreetMap tiles, straight-line travel estimates). The UI labels which mode each integration is in.

---

## 3. Functional requirements

### 3.1 Module 1: Live bed telemetry

- **FR 1.1** The API exposes REST endpoints to read shelters and to update capacity and occupancy (`write:capacity`). A shelter admin may update only their own shelter.
- **FR 1.2** Shelters are stored in MongoDB with a GeoJSON `Point` location and a `2dsphere` index.
- **FR 1.3** Available beds = `capacity - occupied - activeHolds`, where `activeHolds` counts holds with `expireAt > now`.
- **FR 1.4** A change stream on `shelters` and `holds` triggers a city snapshot pushed to all connected clients over WebSockets. A 5-second sweep also pushes a snapshot when a hold has expired since the last sweep.
- **FR 1.5** The map shows one marker per active shelter. Green: >= 10 available. Yellow: 1-9. Red: 0. Overflow sites are shown only while activated.
- **FR 1.6** When a shelter goes from > 0 to 0 available, the system writes a `shelter_full` audit event (FR 6). The transition is detected with a conditional update so it is logged exactly once, even with several API instances.

### 3.2 Module 2: Intake matching

- **FR 2.1** The outreach worker enters: age, gender identity, family (with children), accessibility needs, active substance use. **No name or identifier is collected.**
- **FR 2.2** The API runs `$geoNear` from the worker's GPS position (max 15 km), with a query filter on hard eligibility constraints:
  - `minAge <= age <= maxAge`
  - gender identity is in `acceptsGenders`
  - if family: `acceptsFamilies = true`
  - if accessibility needs: `accessible = true`
  - if active substance use: `allowsActiveUse = true`
- **FR 2.3** Shelters with 0 available beds are dropped. For the nearest 10 remaining, the API requests walking and transit times from the Routes API and sorts by the fastest option. If the Routes API is not configured or fails, it falls back to a straight-line walking estimate (4.5 km/h), and the UI says so.
- **FR 2.4** The triage answers are not written to any database or log.
- **FR 2.5 Bed hold.** Selecting a shelter creates a hold `{shelterId, code, createdBy, createdAt, expireAt = now + 45 min}` inside a transaction that first re-checks availability. Two outreach workers racing for the last bed: exactly one succeeds.
- **FR 2.6** The hold has a short human-readable code (e.g. `FROST-4821`) the client gives at the door. The hold does not contain triage data.
- **FR 2.7** The shelter admin confirms arrival: in one transaction the hold is deleted and `occupied` is incremented. An expired hold cannot be confirmed.
- **FR 2.8** Holds that are not confirmed stop counting at `expireAt` (FR 1.3). A TTL index on `expireAt` removes them from the database afterwards. The worker who made a hold can cancel it.

### 3.3 Module 3: Code Frost

- **FR 3.1** The API polls Environment Canada every 15 minutes for the configured city (default Ottawa, `on-118`).
- **FR 3.2** Effective temperature = wind chill computed with the Environment Canada formula when air temperature <= 10 °C and wind >= 5 km/h; otherwise air temperature.
  `WC = 13.12 + 0.6215 T - 11.37 V^0.16 + 0.3965 T V^0.16`
- **FR 3.3** Trigger when **both** hold: city-wide available beds / total beds (regular shelters) < 1%, and effective temperature < -15 °C. Thresholds are configurable.
- **FR 3.4** On trigger, create a Code Frost event in state `pending_authorization`, then send an SMS and a voice call (Twilio) to every on-call number. No new event is created while one is pending or active.
- **FR 3.5** Authorization: an SMS reply of `AUTHORIZE` from an on-call number (Twilio signature verified), or the dashboard button (`execute:code_frost`). Either one activates the designated overflow sites with 100 emergency spaces each and logs `code_frost_authorized`.
- **FR 3.6** City Ops can end Code Frost, which deactivates overflow sites that have nobody checked in.
- **FR 3.7 Demo control.** City Ops can set a weather override (e.g. -22 °C, 30 km/h wind) and force an evaluation. Overrides are labelled on screen and in the audit log.

### 3.4 Module 4: Overdose response mesh

- **FR 4.1** Responders who toggle **On duty** send their GPS position every 30 seconds. Presence is stored with a `2dsphere` index and expires 5 minutes after the last heartbeat (TTL).
- **FR 4.2** An outreach worker or responder taps the alert button. The app captures GPS, sends the alert, and **immediately shows a full-width "Call 9-1-1" button**.
- **FR 4.3** The API finds on-duty responders within 1 km (`$geoNear`, `maxDistance: 1000`, heartbeat in last 5 min, excluding the reporter), creates an incident, and pushes an alert to each of them over WebSocket. The alert includes distance and location.
- **FR 4.4** The API records `dispatchMs` = time from receiving the request to finishing the pushes.
- **FR 4.5** If nobody is within 1 km, the reporter is told immediately that no nearby responder is available, and the 9-1-1 prompt stays.
- **FR 4.6** The first responder to accept claims the incident through an atomic conditional update. Everyone else alerted gets a **stand-down**. The reporter sees "Responder on the way" with an ETA.
- **FR 4.7** The claiming responder gets a one-tap Google Maps navigation link to the location.
- **FR 4.8** The responder marks the incident resolved.
- **FR 4.9** `overdose_alert`, `overdose_claimed` and `overdose_resolved` are written to the audit log with timestamps (FR 6).

### 3.5 Module 5: Offline fallback

- **FR 5.1** The app caches the last city snapshot on the device and shows it with a "last updated" time when offline.
- **FR 5.2** If the alert button is tapped while offline, the app opens the phone's SMS composer to the Twilio number with the body `OD <lat>,<lng>`. The inbound SMS webhook creates an incident from registered field numbers.

### 3.6 Module 6: Audit trail

- **FR 6.1** Audit events: `shelter_full`, `code_frost_triggered`, `code_frost_authorized`, `code_frost_ended`, `overdose_alert`, `overdose_claimed`, `overdose_resolved`.
- **FR 6.2** The full event is stored in MongoDB. Its SHA-256 hash (over canonical JSON) is submitted to a Hedera Consensus Service topic. The consensus timestamp and sequence number are stored back on the event.
- **FR 6.3** No personal data goes on-chain; only hashes. User IDs inside the stored event are pseudonymous (Auth0 `sub`).
- **FR 6.4** Ledger submission is asynchronous with retries and never delays a dispatch.
- **FR 6.5** City Ops can view the audit log and verify an event: the API recomputes the hash and compares it with the message fetched from the Hedera mirror node.

### 3.7 Module 7: History and trends (Tiger Data)

- **FR 7.1** Every 60 seconds the API records a city sample (beds, % free, overflow, weather, override flag) and one sample per active shelter into TimescaleDB hypertables.
- **FR 7.2** Overdose alert, claim and resolve events are recorded with dispatch time and seconds to accept.
- **FR 7.3** Continuous aggregates (`city_15m`, `shelter_1h`) serve the City Ops History panel: city beds free and lowest feels-like temperature over 24 h / 7 d with the Code Frost thresholds, share of time each shelter was full, and response-time medians.
- **FR 7.4** Raw samples are kept 90 days, incident events 1 year (retention policies).
- **FR 7.5** History is optional and fails soft: if Tiger Data is unreachable, live operations are unaffected and the panel says so.
- **FR 7.6** Demo controls can load 7 days of simulated history. Simulated rows are tagged `source = 'simulated'` and labelled in the UI; they are never mixed silently with live data.

---

## 4. Non-functional requirements

### 4.1 Security and privacy
- **NFR 1.1** Auth0 issues access tokens with RBAC permissions. Every API route and WebSocket connection verifies the token and checks the required permission.
- **NFR 1.2** Triage answers are never persisted (FR 2.4). Holds contain no client data.
- **NFR 1.3** TLS for all traffic. MongoDB Atlas encrypts data at rest by default. Secrets are only in environment variables and are never committed.
- **NFR 1.4** Twilio webhooks verify `X-Twilio-Signature` and check the sender against an allow-list.
- **NFR 1.5** Designed with PHIPA principles (data minimization, access control, audit). Not certified.

### 4.2 Performance and reliability
- **NFR 2.1** Target overdose dispatch (FR 4.4) under 500 ms server-side. The measured value is shown on the ops dashboard.
- **NFR 2.2** Capacity changes reach connected clients within 1 second.
- **NFR 2.3** The API is stateless apart from WebSocket connections and can be restarted without data loss. Pending ledger writes are stored in MongoDB and retried.
- **NFR 2.4** Every external integration fails soft: an outage of Google, Twilio, Hedera or Environment Canada degrades that feature and is visible in the UI; it never blocks the core flows.

### 4.3 Usability
- **NFR 3.1** High contrast, dark by default. Primary touch targets are at least 64 px tall. The overdose button is at least 120 px and reachable with a thumb.
- **NFR 3.2** English and Canadian French, switchable at any time.
- **NFR 3.3** Installable PWA.
