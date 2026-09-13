# Real-world reference data (PEVC3107E)

To make the simulated OCPP flows in this emulator (#9, #10) realistic — timing, message
sequencing, field values — a one-time export was pulled from the CSMS dev environment's Core
database, for one real PEVC3107E-model station (`OC10`).

**This raw export is never committed to this (public) repo.** It contains real hardware/SIM
identifiers (serial numbers, ICCID/IMSI), a real deployed-location naming scheme, and full raw
OCPP message payloads. It lives locally, outside this repo, at:

```
~/ev-charger-emulator-local-fixtures/OC10-PEVC3107E/
```

`fixtures/raw/` in this repo is gitignored for the same reason — if you regenerate exports
yourself, keep them there or in an equivalent untracked location.

## What was captured

| File | Contents |
| --- | --- |
| `station.json` | The `ChargingStation` row: vendor/model/serials, firmware version, protocol (`ocpp1.6`), meter type |
| `evses.json` / `connectors.json` | The 2-EVSE / 2-connector topology (Plug A / Plug B) |
| `boots.json` | Most recent `BootNotification` state (heartbeat interval, boot status) |
| `latest-status-notifications.json` | Current per-connector status |
| `sample-transaction.json` | One complete, real charging session (start/stop time, total kWh, cost, stop reason) |
| `sample-transaction-start.json` / `-stop.json` | The OCPP 1.6 `StartTransaction`/`StopTransaction` records for that session |
| `sample-transaction-meter-values.json` | Every `MeterValues` sample taken during that session (sampled-value arrays: energy, voltage, current, SoC, power) |
| `sample-transaction-ocpp-messages.json` | Every raw OCPP-J frame (`[messageType, id, action, payload]`, CALL/CALLRESULT pairs) exchanged with the station in a window around that session — Heartbeats, StatusNotifications, Authorize, StartTransaction, MeterValues, StopTransaction, with real request/response correlation IDs and timestamps |

## How to use this

When building #6 (OCPP client engine), #8 (boot/heartbeat/status), and #9 (local charging
simulation), use `sample-transaction-ocpp-messages.json` as the reference for real message
ordering/cadence (e.g. actual Heartbeat interval, how many MeterValues per minute, what a real
`StopTransaction` reason/payload looks like) rather than guessing from the OCPP spec alone. Don't
hardcode real values from it (serials, IDs) into the emulator's shipped defaults/seed data —
those should be clearly-fake placeholders; only the *shape and timing* should inform the
implementation.

## Regenerating

The export was pulled directly from the Core Postgres DB (`ChargingStations`, `Evses`,
`Connectors`, `Boots`, `LatestStatusNotifications`, `Transactions`, `StartTransactions`,
`StopTransactions`, `MeterValues`, `OCPPMessages` tables) for station `OC10`, scoped to one
representative completed transaction plus a time window of OCPP messages around it. Re-run
against any CSMS dev environment's Core DB if a fresher or different-station sample is needed —
always keep the output outside version control.
