# ev-charger-emulator

A multi-device EV charge point (EVSE) emulator with a real UI. It talks OCPP over WebSocket to a
Central System (CSMS) exactly like a physical charger would — boot, heartbeat, status notifications,
transactions, remote commands — so a CSMS can be tested against realistic device behavior without
physical hardware.

Unlike generic OCPP simulators (e.g. EVerest's Node-RED flows), each emulated device here is modeled
after a **real charger model**, with a UI that mirrors that model's own settings/status screens
(device info, system config, network config, fee rate, maintenance/diagnostics, event log, cost,
lock), and per-model parameters you configure before connecting it to a CSMS.

## Status

Early scaffold. See the repo's Issues for the build plan.

## First supported device model

**PEVC3107E** (manufacturer: PEVC/SINO) — a dual-gun (Plug A / Plug B) DC fast charger, CCS2
connectors, OCPP 1.6J. Reference screenshots of the real device's screens are in
[`docs/device-reference/PEVC3107E`](docs/device-reference/PEVC3107E); the vendor's maintenance
manual (PDF/DOCX) is not committed here. Real session/OCPP-log data pulled from a live deployment
for reference is documented in [`docs/data-fixtures.md`](docs/data-fixtures.md) but kept out of
git entirely (not just out of this repo).

Planned device/connector shape (also mirrored in the CSMS's own device-model catalog):

- Vendor: `PEVC`, Model: `PEVC3107E`, Protocol: `OCPP 1.6`
- 2 connectors (Plug A = connector 1, Plug B = connector 2), each its own EVSE
- Config surface split into tabs: Device, System, Networks, Fee Rate, Other
- Runtime screens: Home (per-plug charging card + price), Maintenance/Status (component health,
  per-plug interface board diagnostics), Event log, Cost, Lock

## Planned architecture

- **Next.js** app (UI + API routes / server actions)
- **Postgres** for device models, device instances, parameters, and simulated session/event history
- An OCPP 1.6 (and later 2.x) WebSocket client engine per running device instance, connectable to
  any CSMS via a configurable WS URL (e.g. `ws://<csms-host>/ocpp/<chargePointId>`)
- No authentication in v1 — this runs as a local/dev-only testing tool

### Per-instance CSMS URL

Each device instance has its own `csmsUrl` (a `ws://` or `wss://` WebSocket URL), set when you
create the instance and editable afterwards from its **Networks** tab. It's stored in Postgres per
instance and read at connect time — there's no global/env-configured CSMS endpoint, so one running
app can have different instances pointed at different CSMS dev/staging environments at once.

## Local development

The primary, documented way to run this locally is `npm run dev` against Postgres in Docker:

```
cp .env.example .env
docker compose up -d       # Postgres on localhost:5442
npm install
npm run db:generate
npm run db:migrate         # applies migrations (prompts for a name if the schema changed)
npm run db:seed            # seeds the PEVC3107E device model + a ready-to-go "Demo PEVC3107E" instance
npm run dev                 # http://localhost:3000, GET /api/health checks DB connectivity
```

Open [http://localhost:3000/instances](http://localhost:3000/instances) — the seeded "Demo
PEVC3107E" instance is there to click into immediately. Its CSMS URL is a placeholder
(`ws://localhost:9000/DEMO-PEVC3107E-01`); edit it from the instance's Networks tab to point at a
real CSMS dev/staging endpoint.

### Running the app in Docker too (optional)

If you'd rather not install Node locally, `docker-compose.yml` also has an app image + a one-off
migration/seed job, behind the `full` [Compose profile](https://docs.docker.com/compose/how-tos/profiles/)
so they don't affect the `docker compose up -d` flow above:

```
docker compose --profile full up --build
```

This builds and starts Postgres, runs `prisma migrate deploy` + the seed script once, then starts
the app on [http://localhost:3000](http://localhost:3000) — no local `npm install` or manual DB
setup needed. Re-running it is safe: pending migrations are applied and the seed script leaves an
already-seeded "Demo PEVC3107E" instance as-is.
