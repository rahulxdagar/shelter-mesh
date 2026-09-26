# Changelog

All notable changes to the **Cold-Grid: Shelter Triage Mesh** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.1.0] - 2026-09-26

### Added

#### Core Architecture & Specifications
- **Software Requirements Specification (SRS v2.1)** (`docs/SRS.md`): Defined complete system requirements, security, performance (sub-500ms overdose dispatch), PHIPA data-minimization principles, and hardware/network tolerance.
- **Implementation & Demo Plan** (`docs/PLAN.md`): Established 36-hour sprint milestones, 3-minute pitch demo script, fail-soft integration checklist, and automated verification procedures.
- **Root Scaffolding & Monorepo Tooling** (`package.json`): Configured workspace scripts for concurrent development (`dev`), unified installation (`setup`), TypeScript typechecks (`typecheck`), and automated test runners (`test`).

#### Backend API & Microservices (`server/`)
- **Live Bed Telemetry (Module 1)**:
  - Dynamic derived availability algorithm (`capacity - occupied - activeHolds`) ensuring zero stale counts without depending on background TTL sweep latencies.
  - Real-time MongoDB Change Stream watcher broadcasting city-wide capacity snapshots to WebSocket subscribers within 150ms debounce window.
  - Shelter occupancy atomic increment/decrement endpoints (`POST /api/shelters/:id/occupancy`) and capacity reconfiguration (`PATCH /api/shelters/:id`).
  - Exactly-once `shelter_full` transition detection and audit logging powered by conditional atomic database updates.
  - Background 5-second interval sweep to broadcast capacity updates as soon as holds expire.
- **Intake Matching & Atomic Bed Holds (Module 2)**:
  - Geospatial eligibility matching (`POST /api/match`) using MongoDB `$geoNear` 2dsphere indexing and strict filtering (age range, gender identity, family status, accessibility, active substance use).
  - Transit and walking travel-time calculation powered by Google Routes API (`computeRouteMatrix`) with graceful fallback to straight-line street-factored estimates.
  - Concurrent bed reservation system (`POST /api/holds`) utilizing MongoDB multi-document transactions and optimistic locking via `holdSeq` counter increments to guarantee that exactly one worker acquires the final bed during hold races.
  - Human-readable hold identifiers (`FROST-XXXX`) with 45-minute countdowns and arrival confirmation workflows (`POST /api/holds/:id/confirm`).
  - My active holds query (`GET /api/holds/mine`) and hold cancellation (`DELETE /api/holds/:id`).
- **Code Frost Cold-Weather Escalation Engine (Module 3)**:
  - Environment Canada MSC GeoMet OGC API integration polling live weather observations (`citypageweather-realtime`) every 15 minutes.
  - Mathematical wind chill index calculation according to Environment Canada standards for temperatures $\le 10^\circ\text{C}$ and wind speeds $\ge 4.8\text{ km/h}$.
  - Dual-condition trigger engine activating Code Frost only when regular shelter capacity falls below 1% and effective temperature drops below $-15^\circ\text{C}$.
  - Emergency overflow shelter activation (100 spaces per site) upon authorization.
  - Twilio Voice (`Polly.Joanna`) and SMS multi-dispatch to designated on-call supervisors.
  - Inbound Twilio webhook handler (`POST /api/twilio/sms`) with cryptographic `X-Twilio-Signature` verification and sender allowlist checks for `AUTHORIZE` triggers.
  - Operations weather override controls (`POST /api/codefrost/override`) and manual evaluation triggers (`POST /api/codefrost/evaluate`).
- **Overdose Response Mesh (Module 4)**:
  - Real-time responder presence tracking (`presence:update`) with 30-second heartbeats and 5-minute TTL expiration.
  - Low-latency incident dispatch (`POST /api/incidents`) alerting on-duty naloxone carriers within a 1 km radius in parallel with an immediate 9-1-1 prompt.
  - Single atomic conditional update (`findOneAndUpdate({ status: 'open', 'alerted.userId': me })`) guaranteeing exactly one winner in acceptance races (`POST /api/incidents/:id/accept`).
  - Automated stand-down broadcast (`incident:standdown`) dispatched to non-winning responders.
  - Turn-by-turn navigation handoff to Google Maps via native URL schemes requiring no client API key.
  - Incident resolution lifecycle (`POST /api/incidents/:id/resolve`) tracking dispatch latency (`dispatchMs`) and time-to-claim metrics.
- **Tamper-Evident Audit Trail & Hedera Consensus Service (Module 6)**:
  - Canonical JSON serialization with deterministic SHA-256 hash chaining across high-liability events (`shelter_full`, `code_frost_*`, `overdose_*`).
  - Hedera Consensus Service (HCS) integration publishing privacy-preserving audit hashes to public Hedera testnet topics with zero PII.
  - Non-blocking asynchronous queue worker with exponential backoff and retry handling (`drainLedger`) decoupled from critical dispatch paths.
  - Cryptographic verification endpoint (`GET /api/audit/:id/verify`) comparing local records against Hedera mirror node REST responses.
  - Outbox inspection endpoint (`GET /api/outbox`) for tracking dispatched and simulated communications.
- **Tiger Data / TimescaleDB History & Analytics (Module 7)**:
  - PostgreSQL / TimescaleDB client integration with automated schema migrations, hypertables (`city_samples`, `shelter_samples`, `incident_events`), and retention policies (90-day samples, 365-day incidents).
  - Timescale continuous aggregates (`city_15m`, `shelter_1h`) with real-time aggregation (`materialized_only = false`) for rapid historical querying across 24-hour and 7-day ranges.
  - Automated background sampler recording city and shelter metrics every 60 seconds.
  - Deterministic PRNG-based simulated history backfill generator (`backfillSimulated`) providing 7 days of realistic Ottawa winter weather and occupancy trends for demonstrations.
- **Zero-Config Local Fallbacks & Dev Mode**:
  - Embedded in-memory MongoDB replica set via `mongodb-memory-server` when `MONGODB_URI` is omitted.
  - Development token generator (`devToken`) supporting role-based simulation without external Auth0 dependencies.
  - In-memory Twilio message outbox displaying SMS and voice transcripts on-screen when API keys are absent.
  - Local SHA-256 hash chaining active when Hedera credentials are not supplied.
  - Haversine street-factored travel estimation when Google Maps Server Key is unset.

#### Web Application & Frontend (`web/`)
- **Modern Progressive Web App (PWA)**:
  - Built with React 19, Vite 8, and TypeScript.
  - Offline Service Worker (`sw.js`) and Web App Manifest (`manifest.webmanifest`) for home-screen installation.
  - High-contrast, glove-friendly dark-mode UI with primary touch targets $\ge 64\text{px}$ and thumb-accessible $\ge 120\text{px}$ SOS emergency trigger.
- **Role-Based Views**:
  - **Outreach View** (`web/src/views/Outreach.tsx`): Interactive bed map, ephemeral triage form, walking/transit travel comparisons, 45-minute hold reservations with countdown timers, active hold management, and emergency overdose trigger.
  - **Responder View** (`web/src/views/Responder.tsx`): On-duty availability toggle, live GPS presence reporting, Web Audio multi-tone sirens, device vibration (`navigator.vibrate`), incoming alert cards with distance/walking time, single-tap acceptance, one-touch Google Maps navigation, and incident resolution.
  - **Shelter Intake View** (`web/src/views/Shelter.tsx`): Real-time occupancy counters, quick check-in / check-out buttons, capacity adjustment, and live incoming bed hold list with arrival confirmation.
  - **City Operations View** (`web/src/views/Ops.tsx`): Real-time city-wide bed totals, weather telemetry, interactive incident monitoring table, Code Frost threshold monitors, Twilio communications feed, and Hedera audit verification panel.
  - **History & Trends Panel** (`web/src/views/History.tsx`): Responsive SVG line charts with crosshair cursor tracking, keyboard arrow navigation, Code Frost reference threshold lines, accessible tabular views, shelter saturation bar charts, and incident dispatch percentiles (p50/p90).
- **Dual Map Support**:
  - `GoogleCityMap.tsx`: Vector map integration via `@vis.gl/react-google-maps` using custom SVG color-coded pins (Green $\ge 10$, Yellow $1\text{--}9$, Red $0$, Blue for emergency overflow).
  - `LeafletCityMap.tsx`: OpenStreetMap tile fallback via `leaflet` and `react-leaflet` when Google Maps API keys are not supplied.
- **Internationalization (i18n)** (`web/src/i18n.tsx`):
  - Bilingual interface in English (EN) and Canadian French (FR) with instant toggling and local storage persistence.
- **Offline Resilience**:
  - LocalStorage caching of the last known city snapshot displayed with timestamp warning banner during network disconnections.
  - Native SMS URI fallback (`sms:?body=OD%20<lat>,<lng>`) allowing field workers to dispatch overdose alerts without mobile data.

#### Containerization & Infrastructure
- **Docker Compose Stack** (`docker-compose.yml`):
  - Multi-service orchestration including Node.js production container, MongoDB 8.2 replica set, and TimescaleDB PG17.
  - Pinned MongoDB to `mongo:8.2` with automated single-node replica set initiation healthchecks (`rs.initiate()`) resolving Linux kernel $\ge 6.19$ incompatibilities.
  - TimescaleDB health-checked service with port forwarding on `:5433` for hybrid local development.
- **Production Container Build** (`server/Dockerfile`):
  - Alpine-based Node.js runtime with production dependency isolation and native ES module execution.

#### Automated Test Suite (`server/test/`)
- **Integration & Stress Tests**:
  - `capacity-holds.test.ts`: Verifies derived capacity math, 10-client hold concurrency races on a single bed, hold expiration immediacy, and cross-shelter authorization controls.
  - `codefrost-audit.test.ts`: Tests dual-condition threshold triggers, overflow activation, canonical SHA-256 hash chaining, and tamper detection.
  - `realtime-incidents.test.ts`: Validates WebSocket snapshot broadcasts, responder presence geofencing, atomic incident claim races, and stand-down messaging.
  - `matching.test.ts`: Confirms `$geoNear` filter exclusion across hard eligibility constraints and transit travel sorting.
  - `twilio-signature.test.ts`: Validates cryptographic webhook signature checking and sender allowlist enforcement.
  - `history.test.ts`: Tests TimescaleDB hypertable writes, continuous aggregate rollups, retention logic, and simulated backfill.

---

### Changed

#### Architectural Revisions (Superseding v2.0 as specified in SRS v2.1)
- **Overdose Alerting Paradigm**:
  - *Previous (v2.0)*: Positioned overdose mesh as bypassing municipal 9-1-1 dispatch.
  - *Revised (v2.1)*: Dispatches nearby naloxone carriers **in parallel with** standard 9-1-1 dispatch; interface displays prominent 9-1-1 calling prompts to ensure paramedic arrival.
- **Bed Availability Mechanics**:
  - *Previous (v2.0)*: Relied on background MongoDB TTL sweeps to release expired hold documents and mutate availability.
  - *Revised (v2.1)*: Made availability strictly **derived** on the fly (`capacity - occupied - activeHolds`), making expiry accurate to the second without database write latency.
- **Eligibility Matching Queries**:
  - *Previous (v2.0)*: Proposed MongoDB Atlas Search for demographic matching.
  - *Revised (v2.1)*: Transitioned to geospatial `$geoNear` aggregation with exact filter constraints, reserving Atlas Search for text and utilizing native geospatial indexes for proximity.
- **Mapping & Navigation Integration**:
  - *Previous (v2.0)*: Relied on legacy Distance Matrix API and Directions API.
  - *Revised (v2.1)*: Upgraded to Google Routes API `computeRouteMatrix` for transit/walk matrices and native Google Maps URL schemes for device navigation.
- **Overdose Claim Resolution**:
  - *Previous (v2.0)*: Unspecified claim collision resolution.
  - *Revised (v2.1)*: Enforced single atomic MongoDB conditional update (`findOneAndUpdate({ status: 'open' })`) eliminating dual-winner scenarios.
- **Responder Discovery**:
  - *Previous (v2.0)*: Considered all logged-in Auth0 accounts within 1 km as active responders.
  - *Revised (v2.1)*: Enforced active "on duty" state defined by regular 30s GPS heartbeats within a 5-minute TTL window.
- **Consensus & Audit Logging**:
  - *Previous (v2.0)*: Ambiguous smart contract ledger architecture storing incident details.
  - *Revised (v2.1)*: Hedera Consensus Service (HCS) publishing only SHA-256 event hashes; zero PII or responder identifiers sent on-chain.
- **Capacity Color Scale**:
  - *Previous (v2.0)*: Green $>10$, Yellow $1\text{--}9$, Red $0$ (leaving exactly 10 beds unclassified).
  - *Revised (v2.1)*: Green $\ge 10$, Yellow $1\text{--}9$, Red $0$.
- **Wind Chill Calculations**:
  - *Previous (v2.0)*: Read wind chill directly from weather feed.
  - *Revised (v2.1)*: Implemented standard Environment Canada formula dynamically due to unreliability in raw external feed wind chill fields.
- **Triage Data Privacy**:
  - *Previous (v2.0)*: Persisted triage records and relied on TTL sweeps for data deletion.
  - *Revised (v2.1)*: Triage forms are evaluated completely in-memory during search execution and are never saved to any database or log.

---

### Security

- **Role-Based Access Control (RBAC)**:
  - Auth0 JWT authentication with 8 granular permissions (`read:capacity`, `write:capacity`, `create:hold`, `confirm:hold`, `create:alert`, `respond:alert`, `execute:code_frost`, `read:audit`).
  - Token signature verification using remote JSON Web Key Sets (JWKS) via `jose`.
  - Shelter administrators strictly restricted to mutating their assigned shelter (`canManageShelter`).
- **Webhook Authentication**:
  - Twilio inbound webhooks authenticated via `X-Twilio-Signature` validation.
  - On-call authorizations restricted to authorized supervisor phone numbers (`ONCALL_NUMBERS`).
  - SMS overdose dispatch restricted to pre-registered field devices (`FIELD_NUMBERS`).
- **Data Minimization & Privacy (PHIPA-Aligned)**:
  - Intake questions (age, gender, family, accessibility, substance use) are transiently processed and never written to storage.
  - Bed reservation records contain only randomized alphanumeric codes (`FROST-XXXX`) and expiry timestamps with zero personal identifiers.
  - Cryptographic ledger messages submitted to Hedera contain only SHA-256 hashes.
- **Fail-Safe Secret Management**:
  - All credentials, API tokens, and private keys strictly decoupled from source control via `.env` configuration.
  - Production mode enforces non-dev authentication and halts startup if Auth0 or database credentials are missing.
