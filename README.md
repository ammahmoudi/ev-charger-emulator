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

## Local development

Not yet scaffolded — tracked in the repo's Issues.
