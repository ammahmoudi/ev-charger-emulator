# Audit — device-instance runtime state/persistence

## Resolution summary (post-fix pass)

| Finding | Status |
| --- | --- |
| P0 — Meter values hardcoded to zero (`src/lib/ocpp/remote-commands.ts`) | **Not fixed** — out of this agent's owned files (`src/lib/ocpp/**`); flagged in detail below for that owner to coordinate on. |
| P0 — `getPlugOutputCurrent()` always returns 0 | **Fixed** — now derives a plausible current from the connector's real active `Charging` session (`diagnostics.ts`). |
| P0 — No persisted local authorization list/cache | **Fixed** — new `DeviceInstanceLocalAuthEntry` table + `local-auth.ts` (list/upsert/remove/lookup) + `rfid.ts` now checks it before requiring a live CSMS connection. `GET/POST /api/device-instances/[id]/local-auth`, `DELETE .../local-auth/[idTag]` added so it's reachable; the `SendLocalList`/`GetLocalListVersion` OCPP handlers themselves still belong to the `src/lib/ocpp` owner. |
| P0 — No offline transaction queue | **Fixed** for the concrete failure path that existed (a remote session's `StopTransaction` failing) — new `DeviceInstanceOutboxMessage` table + `outbox.ts` (`queueOutboxMessage`/`drainOutbox`), wired into `connector-sessions.ts::stopChargingSession`'s existing catch block and drained in `runtime.ts`'s `bootAccepted` handler. Not yet extended to locally-simulated sessions' Start/MeterValues (see split-brain note below). |
| P0 — Runtime connection state doesn't survive restart | **Fixed** — `runtime.ts::reconcileRuntimeOnStartup()`, called once per process from `GET /api/device-instances`, reconnects every instance left `CONNECTED`/`CONNECTING` in the DB. |
| P1 — Split-brain connector status | **Partially fixed** — `connector-sessions.ts` now calls `session.setConnectorStatus(...)` at every local-session transition (`notifySessionStatus`), so the dashboard's live view and a real `StatusNotification` (once connected) agree with the Lock/Cost screens for locally-simulated sessions too. Full unification (local sessions also sending real `StartTransaction`/`MeterValues`/`StopTransaction`, using the CSMS-assigned transaction id like the remote path does) is **not done** — it's a deeper, cross-cutting redesign of transaction identity that needs coordination with the `src/lib/ocpp` owner; noted as a follow-up. |
| P1 — No `Finishing` lifecycle state | **Fixed** — `connector-sessions.ts` now holds `Finishing` (new `finishingSince`/`finishingNextStatus` columns) between a successful stop and the final `Available`, resolved lazily like the existing `Preparing`→`Charging` promotion. Fault stops and cancel-before-start stops skip it (see code comments for why). |
| P1 — `energyTotal` never accumulates | **Fixed** — `diagnostics.ts::getInterfaceBoardReading` now sums completed `DeviceInstanceSession.energyWh` for that connector on top of the factory baseline. |
| P1 — Diagnostics/hardware-test toggle state is 100% in-memory | **Not fixed** — left as-is (documented tradeoff, not attempted this pass: needs its own schema design and touches two files' entire storage model for a lower-severity gap than the P0s above). Flagged as a follow-up. |
| P1 — Firmware-upgrade timer doesn't survive restart | **Fixed** — `DeviceInstance.firmwareUpgradeStartedAt` persists the in-flight upgrade; `maintenance.ts::resolveStaleFirmwareUpgrade` self-heals a stale upgrade (no owning in-memory timer, duration elapsed) on the next `getMaintenanceState` read. |
| P1 — `BootNotification` sends the wrong vendor | **Fixed** — `runtime.ts` now sends `deviceModel.brand ?? deviceModel.manufacturer`. |
| P2 — `PrismaConfigurationStore.set()` doesn't validate values | **Not fixed** — still flagged for coordination with the parameters/validation module owner. |
| P2 — Inefficient repeated connector/model lookups | **Not fixed** — low-severity, left as a follow-up. |
| P2 — Unguarded race in `Preparing`→`Charging` promotion | **Fixed** — both `resolvePreparingPromotion` and the new `resolveFinishingPromotion` now use a conditional `updateMany` (only the caller that actually matched the expected prior status logs events/notifies the OCPP session). |
| Zero test coverage for `runtime.ts`, `connector-sessions.ts`, `rfid.ts`, `events.ts`, `prisma-configuration-store.ts`, `serialize.ts` | **Fixed** — integration tests added for all of these (plus the new `local-auth.ts`/`outbox.ts`), run against the local Postgres from `docker-compose.yml`. `vitest.config.ts` now loads `.env` and DB-touching `describe` blocks use `describe.skipIf(!process.env.DATABASE_URL)` so the suite still runs cleanly without a DB configured. |

New bug found and fixed during this pass, not in the original audit: `runtime.ts` never registered a `session.on("error", ...)` listener. Node's `EventEmitter` throws synchronously when an `"error"` event has no listener, so any transient `OcppChargePointSession` send failure (a `StatusNotification`/`Heartbeat`/`BootNotification` call failing mid-flight, e.g. the socket dropping) would have crashed the process instead of just being recorded — mirrored the existing `client.on("error", ...)` handling.

Files touched: `prisma/schema.prisma` (+ new migration), `src/lib/device-instances/{connector-sessions,runtime,diagnostics,rfid,maintenance}.ts`, new `src/lib/device-instances/{local-auth,outbox}.ts`, `src/app/api/device-instances/route.ts`, `src/app/api/device-instances/[id]/diagnostics/**`, new `src/app/api/device-instances/[id]/local-auth/**`, `vitest.config.ts`, and new/updated tests under `src/lib/device-instances/__tests__/`.

Test/typecheck/lint results: `npx vitest run` — 128/128 passed, exit 0. `npx tsc --noEmit` — clean except one pre-existing, unrelated error in `src/app/layout.tsx` (`Cannot find name 'LayoutProps'`), confirmed present on a clean checkout before any of this pass's changes — not touched, out of scope. `npx eslint .` — clean, exit 0.

---


Scope: `src/lib/device-instances/**` (excluding `parameters.ts`/`settings-pages.ts`, owned by
another agent), `src/app/api/device-instances/**`, `src/app/api/device-models/**`,
`prisma/schema.prisma`. Cross-checked against the real CitrineOS dev DB (read-only, station
`PEVC3107E`/vendor `SINO`, stations 88/89/91/102) and `citrineos-core`'s OCPP 1.6
`Transactions` module handler.

Legend: **P0** = directly causes the "reports zeros" / unrealistic-behavior complaints the owner
flagged, or a hard restart-survival gap; **P1** = real gap vs. a genuine charger, should fix;
**P2** = smaller bug/inefficiency; **Info** = out-of-scope but load-bearing context for other
agents.

---

## P0 — Meter values are hardcoded to zero (the owner's core complaint)

**File: `src/lib/ocpp/remote-commands.ts`** — *not in this agent's owned file list*
(`src/lib/ocpp/**`), but this is the literal root cause of "it reports ZEROS", so flagging it
prominently for the OCPP-layer owner and coordinating fixes with the state layer below.

- `sendMeterValues()` (line ~266) always sends a single sample:
  `{ measurand: "Energy.Active.Import.Register", value: "0", unit: "Wh" }` — no
  Voltage/Current.Import/Power.Active.Import/Power.Offered/SoC, and the value is a hardcoded
  string `"0"` regardless of how long the transaction has been running.
- It is **only** invoked via `TriggerMessage` from the CSMS (`triggerMessage()` →
  `case "MeterValues"`). There is no periodic timer sending `MeterValues` automatically during
  an active `RemoteStartTransaction`-initiated charging session — a real charger samples every
  ~30s while charging (verified from CitrineOS's own `MeterValues` table for `PEVC3107E`
  stations, see below).
- `startTransaction()` (line ~50) always sends `meterStart: 0`; `stopTransaction()` (line ~101)
  always sends `meterStop: 0`. CitrineOS's OCPP1.6 `Transactions` module computes
  `totalKwh = (meterStop - startTransaction.meterStart) / 1000`
  (`citrineos-core/packages/core/src/modules/Transactions/src/module/module.ts:1260`) — so
  **every** CSMS-`RemoteStartTransaction`-initiated session shows `totalKwh = 0` in CitrineOS's
  own DB, no matter how long it actually "charged."

**Real-world reference** (CitrineOS DB, station 89 connector 2, transaction 1910,
2026-09-21 18:23–19:29): samples every ~30s, `Energy.Active.Import.Register` monotonically
increasing (10770725 → 10772251 Wh in the first ~4 minutes), `Power.Active.Import` ramping from
~6.4 kW to ~48.6 kW (DC fast-charge ramp-up), `Power.Offered` constant at 90000 W, `SoC`
increasing slowly (35% → 37%), `Voltage` ~350-357V, `Current.Import` ~18A→136A. Real
`StartTransaction.meterStart` values are the station's cumulative lifetime register (e.g.
8600–10800 kWh scale), not 0.

**Recommendation** (for the `src/lib/ocpp` owner, coordinate before either side changes
`remote-commands.ts`): add a periodic per-connector `MeterValues` sender keyed off
`activeTransactions`, computing real energy/power from elapsed time and a configurable charge
rate (mirroring the ramp math this agent's `connector-sessions.ts::currentEnergyWh` already
does for the locally-simulated path — same shape, just also emit Voltage/Current/Power/SoC
samples), and pass through real `meterStart`/`meterStop` instead of `0`.

---

## P0 — `getPlugOutputCurrent()` always returns 0 (owned file, will fix)

`src/lib/device-instances/diagnostics.ts:240-248`. `plugOutputCurrentBaseline` is initialized to
`0` per connector and **nothing in the codebase ever sets it to a nonzero value** (grepped all
of `src/`) — the jitter only applies `if (baseline !== 0)`. Result: the Communication screen's
per-plug output current always reads exactly `0`, even while a session is actively `Charging` on
that connector. Should derive a baseline from the connector's actual active session
(`activeChargeRateKw` via `connector-sessions.ts::listConnectorStates`), similar to how
`hardware-test-state.ts::renderPlug` derives `outputCurrentA` from `outputRunning`.

---

## P0 — No persisted local authorization list / RFID cache

Real OCPP 1.6 chargers maintain a **local authorization list** (populated by `SendLocalList` /
seeded at boot) plus an authorization cache, used to authorize idTags locally when the CSMS is
unreachable. Confirmed as a first-class CSMS-side concept in the real system
(`LocalListAuthorizations` table in the CitrineOS DB, keyed by idToken + status +
cacheExpiryDateTime).

This emulator has **none of that**:
- `prisma/schema.prisma` has no local-auth-list / auth-cache model at all — only a single
  `DeviceInstance.masterCardIdTag String?` field.
- `src/lib/device-instances/rfid.ts::presentRfidCard` only recognizes exactly one idTag (the
  master card) locally; every other idTag **requires a live CSMS connection**
  (`getRuntimeConnectionState(deviceInstanceId) !== "connected"` → throws) and performs a real
  `Authorize`/`StartTransaction` round-trip. A real charger with a populated local list/cache can
  authorize several known cards locally and queue the transaction for later sync while offline.
- No `GetLocalListVersion`/`SendLocalList` handler exists anywhere (`src/lib/ocpp` grep came up
  empty), so there's no way for a CSMS to even populate such a list today.

**Recommendation**: add a `DeviceInstanceLocalAuthEntry` table (idTag, status, cacheExpiryDateTime,
per instance), a `local-auth.ts` module (list/upsert/remove/lookup, seeded with the master card),
and change `rfid.ts` to check the local list before requiring a live connection. The
`SendLocalList`/`GetLocalListVersion` OCPP handlers themselves belong in `src/lib/ocpp` (flagging
for that owner), backed by this table via a small store interface analogous to
`PrismaConfigurationStore`.

---

## P0 — No offline transaction queue

If a real `StartTransaction`/`StopTransaction`/`MeterValues` call fails while disconnected, this
codebase drops it. Concretely, `connector-sessions.ts::stopChargingSession` (line ~364-380):

```ts
if (state.activeIsRemote && state.activeTransactionId != null) {
  try {
    await callOcpp(deviceInstanceId, "StopTransaction", { ... });
  } catch (err) {
    await logDeviceInstanceEvent(deviceInstanceId, "FAULT", `...failed to notify CSMS...`, stoppedAt);
  }
}
```

The failure is only logged as a `FAULT` event — the `StopTransaction` is never retried or
replayed once the CSMS connection is restored. A real charger queues Start/Stop/MeterValues
messages generated while offline and flushes them in order on reconnect (this is exactly what
"local storage" in the owner's brief refers to). No `DeviceInstanceOutboxMessage` (or similar)
table exists in the schema, and `runtime.ts` has no flush-on-`bootAccepted` hook that would
replay anything.

**Recommendation**: add an outbox table (`DeviceInstanceOutboxMessage`: action, payload JSON,
createdAt, per instance) written whenever an OCPP call that should reach the CSMS fails while
disconnected (start/stop transaction, meter values), and drain it in `runtime.ts`'s
`session.on("bootAccepted", ...)` handler before/after the boot-accepted status write.

---

## P0 — Runtime connection state doesn't survive process restart, and is split from persisted status

`src/lib/device-instances/runtime.ts`'s `registry` (the `OcppClient`/`OcppChargePointSession`
pair, live per-connector statuses, `manuallyStopped` flag) is a plain in-memory `Map` on
`globalThis` (lines 31-39) — by design for hot-reload survival in dev, but it means:

1. On a real process restart (not just a dev hot-reload), `DeviceInstance.status` in the DB can
   still say `CONNECTED` (stale — nothing resets it), while
   `getInstanceConnectorStatuses()`/`getRuntimeConnectionState()` return `[]`/`"disconnected"`
   until a user manually hits Start again. `serialize.ts::buildConnectorSummaries` then shows
   every connector's `status`/`errorCode` as `null` even though the dashboard says CONNECTED.
2. Nothing re-establishes previously-CONNECTED instances' OCPP connections automatically on
   startup — a real charger reconnects to its configured CSMS on power-up without user action.
3. This is a second, independent notion of "connector status" from the persisted
   `DeviceInstanceConnectorState.status` driven by `connector-sessions.ts` — see next finding.

**Recommendation**: on app startup (e.g. a one-time init in `src/lib/prisma.ts`'s module scope,
or a dedicated startup hook), call `startDeviceInstance` for every `DeviceInstance` whose
persisted `status` is `CONNECTED`/`CONNECTING`, and/or reconcile stale `CONNECTED` status back to
`DISCONNECTED` if not immediately reconnecting.

---

## P1 — Split-brain connector status (two disconnected sources of truth)

There are two independent "connector status" concepts that are never reconciled:

- **(a)** `DeviceInstanceConnectorState.status` — Prisma-persisted, driven by
  `connector-sessions.ts`'s local simulation (`Available`/`Preparing`/`Charging`/`Faulted`) and
  `maintenance.ts` (`Available`/`Unavailable` during firmware upgrade). Read by the Home/Lock/
  Cost/Maintenance screens via `listConnectorStates`.
- **(b)** `OcppChargePointSession`'s in-memory connector map — driven by real OCPP
  `StatusNotification`s, `hardware-test-state.ts`, and the remote-CSMS path in `rfid.ts`. Read by
  `serialize.ts::buildConnectorSummaries` for the dashboard/instance-detail screens, and by
  `rfid.ts` itself to check `Available` before a non-master-card swipe.

Starting a **local** (master-card) session via `connector-sessions.ts::startChargingSession`
never calls `session.setConnectorStatus(...)`, so:
- The dashboard (reading (b)) keeps showing the connector's last known real-OCPP status (often
  `null` before the instance has ever connected, or stale `Available`) while the Home/Lock/Cost
  screens (reading (a)) correctly show `Preparing`/`Charging`.
- **CitrineOS never sees a `StatusNotification` for a local session at all** — only
  `activeIsRemote` sessions (the non-master-card RFID path, which does a real
  `Authorize`/`StartTransaction`) reach the CSMS. So exercising CitrineOS's `StatusNotification`
  handling via the emulator's "simulate a session" UI (the primary demo path) currently produces
  **no** CSMS traffic at all for that session — only `activeIsRemote` sessions do. This directly
  undercuts the brief's "so that CitrineOS core can be exercised with ALL its functions" goal:
  the local-simulation UI path (likely the most-used one) is invisible to the CSMS.

**Recommendation**: either (a) always route local sessions through a real
`StatusNotification`/`StartTransaction`/`MeterValues`/`StopTransaction` sequence when connected
(closing the gap with the `activeIsRemote` path so *every* session — not just RFID-card-swiped
ones — is CSMS-visible), or at minimum (b) call `session.setConnectorStatus(...)` from
`connector-sessions.ts` so the two views agree even if full OCPP traffic isn't sent. Given the
brief's explicit "so CitrineOS can be exercised with ALL its functions," (a) is the intended
direction — this is a substantial cross-cutting change touching both this agent's files and
`src/lib/ocpp`, so flagging for coordination rather than doing it unilaterally.

---

## P1 — No realistic session lifecycle `Finishing` state

`connector-sessions.ts::stopChargingSession` transitions directly from `Charging`/`Preparing` to
`Available`/`Faulted` (lines 398-409) — it never passes through `Finishing`. Real captured
`StatusNotification` traffic for `PEVC3107E` stations (CitrineOS DB, station 89) always shows
`Charging → Finishing → Available`, with `Finishing` lasting anywhere from ~5 seconds to ~2
minutes:

```
connectorId | connectorStatus | timestamp
2 | Available  | 19:30:50
2 | Finishing  | 19:29:09   -- ~1m41s before Available
1 | Available  | 18:52:01
1 | Finishing  | 18:49:55   -- ~2m06s before Available
```

This is explicitly called out in the task brief ("realistic session lifecycle
(Preparing->Charging->Finishing etc.)"). Recommend adding a short `Finishing` hold (a few
seconds, matching the existing `PREPARING_DURATION_MS` pattern) between the stop request and the
final `Available`/`Faulted` status, with its own `STATUS_CHANGE` event log entry.

---

## P1 — Lifetime energy total never accumulates (another "stuck at a constant" bug)

`diagnostics.ts::createDefaultInterfaceBoard()` hardcodes `energyTotal: 0.444` — a per-plug
lifetime energy counter that, per its name and the real device's Setting screens, should
accumulate as sessions complete. It is never updated anywhere (`energyTotal` only appears in this
one place and in `diagnostics-types.ts`'s type definition — no setter, no read of completed
`DeviceInstanceSession` rows to sum). Every instance's every plug shows exactly `0.444` forever,
regardless of how many charging sessions have run. This is the same class of bug as the
`plugOutputCurrent` zero-stub above — a "constant instead of derived from real activity" bug.

**Recommendation**: derive `energyTotal` from `SUM(DeviceInstanceSession.energyWh)` for that
connector (or track a running total field), rather than a hardcoded constant.

---

## P1 — Simulated diagnostics/hardware-test state is 100% in-memory (won't survive restart)

Both `diagnostics.ts` (fault-injection toggles: overall health, per-plug interface-board
comm/health flags, communication-module states) and `hardware-test-state.ts` (plug
output-running/aux-power/lock, pile contactor/breaker state) keep their entire state in a
`Map` on `globalThis`, explicitly documented as intentional per their *original* ticket's
acceptance criteria (issue #4 / #16) — narrower scope than the current brief. The current brief
explicitly asks for state that "survives restart," which conflicts with that prior decision.

Concretely lost on restart: any fault injected for testing (e.g. "Cabinet Door: abnormal"),
any hardware-test contactor/lock state, the pile's breaker/contactor positions. The numeric
*readouts* (temperatures, voltages) are fine to keep ephemeral/jittered (they're meant to be
"live" telemetry, not history) — only the **toggled boolean/enum fields** (health flags, contactor
positions, lock status, output-running) need persisting.

**Recommendation**: add a small persisted table (or reuse/extend
`DeviceInstanceConnectorState` with a few nullable columns) for the toggled fields only, keep the
jittered numeric readouts computed on read as today.

---

## P1 — Firmware-upgrade timer doesn't survive restart (stuck-`Unavailable` bug)

`maintenance.ts`'s `upgradeTimers` (in-memory `setTimeout` map, lines 108-116). If the process
restarts while a firmware upgrade is in flight (between `startFirmwareUpgrade` marking connectors
`Unavailable` and the 2.5s timer firing), the timer is lost — connectors are left
**permanently `Unavailable`** in the persisted `DeviceInstanceConnectorState`, and the firmware
version parameter never bumps. No recovery path exists (no "resume in-flight upgrades on
startup" logic, no timeout/staleness check on `Unavailable` status from an upgrade).

**Recommendation**: either persist an `upgradeInProgress`/`upgradeStartedAt` timestamp so a
restart can detect and immediately complete (or roll back) a stale in-flight upgrade, or at
minimum add a staleness check when reading connector state.

---

## P1 — `BootNotification` sends the wrong vendor string

`runtime.ts::createEntry` (line 58): `chargePointVendor: instance.deviceModel.manufacturer`.
The seeded `PEVC3107E` `DeviceModel` has `manufacturer: "PEVC"`, `brand: "SINO"`
(`prisma/seed.ts:614-624`). The real CitrineOS DB shows every real `PEVC3107E` station's
`chargePointVendor = "SINO"` (some show `"Piwin"` for a different reseller) — i.e. real hardware
reports the **brand**, not the internal manufacturer code, as `chargePointVendor`. Sending
`"PEVC"` means BootNotification identity won't match what CitrineOS operators would recognize
from real fleet data.

**Fix** (small, in this agent's owned file): use `instance.deviceModel.brand ??
instance.deviceModel.manufacturer` for `chargePointVendor`.

---

## P2 — `PrismaConfigurationStore.set()` doesn't validate values

`prisma-configuration-store.ts::set()` writes any string value straight to
`DeviceInstanceParameter.value` for a CSMS-initiated `ChangeConfiguration`, without running it
through the same `valueType`/`enumOptions`/min/max validation `parameters.ts::validateParameterValue`
applies to Settings-UI edits (`src/app/api/device-instances/[id]/route.ts`'s `PATCH` handler
does call `validateParameterValue`). A CSMS can therefore push an out-of-range or wrongly-typed
value the UI would have rejected. Not fixing in this pass (touches the parameters/validation
module owned by another agent, and `OcppChangeConfigurationStatus`'s exact member set needs
confirming before wiring a rejection path) — flagging for coordination.

## P2 — Inefficient repeated connector/model lookups on hot polled paths

`connector-sessions.ts::getConnectorLabel` re-fetches the full `deviceModel.connectors` graph via
a fresh `prisma.deviceInstance.findUnique` on every call, and most of the exported functions
(`startChargingSession`, `stopChargingSession`, `setConnectorLock`, `clearConnectorFault`) call
it once for the label *and* call `listConnectorStates` again at the end to build the return
view — each of which re-fetches the instance+connectors independently. `listConnectorStates`
itself is polled every "couple of seconds" by the Home screen (per its own doc comment). Not
incorrect, just avoidable extra round-trips — worth a follow-up but not blocking.

## P2 — Unguarded race in `Preparing`→`Charging` promotion

`resolvePreparingPromotion` (`connector-sessions.ts`) reads then unconditionally `update()`s a
connector's state without a `WHERE status = 'Preparing'` guard. It runs on every
`listConnectorStates` poll (no locking/debouncing), so two concurrent requests past the
duration threshold could both perform the promotion, each logging its own
`STATUS_CHANGE`/`TRANSACTION_STARTED` event pair (Prisma `update()` isn't conditional, so the
second write "succeeds" against already-updated data, silently reassigning
`transactionCounter`/`activeTransactionId` from stale state). Low real-world impact for a
single-user local dev tool, but worth a `data: { status: "Preparing" }` guard clause in the
`where` (Prisma doesn't support conditional updates directly without `updateMany` +
count-check) if this becomes multi-tab-sensitive.

---

## Info — Out of this agent's owned files, but relevant

- `src/lib/ocpp/remote-commands.ts` is where the periodic-MeterValues / real meterStart-meterStop
  fixes belong (see P0 section above) — actively being developed by another agent (recent commit
  `b36f0f3 feat(ocpp): wire CSMS remote commands...`). Coordinate before touching.
- No OCPP handlers exist yet for `ReserveNow`/`CancelReservation`, `SetChargingProfile`,
  `DataTransfer`, `SendLocalList`/`GetLocalListVersion`, or `UpdateFirmware` (grepped
  `registerHandler(` in `src/lib/ocpp/`) — all mentioned in the brief's goal list. These are OCPP
  protocol-layer additions (another agent's area), though `SendLocalList`/`GetLocalListVersion`
  would need the local-auth-list table this report recommends above (P0), and `ReserveNow` would
  need a `DeviceInstanceReservation`-style table if reservation state should persist — schema
  changes this agent can own once the other agent confirms the handler shape needed.

---

## Test coverage

`src/lib/device-instances/__tests__/` currently covers only pure/simple functions:
`diagnostics.test.ts`, `hardware-test-state.test.ts`, `maintenance.test.ts` (only
`bumpFirmwareVersion`, not the DB-touching functions), `parameters.test.ts` (other agent's file),
`settings-pages.test.ts` (other agent's file), `stop-causes.test.ts`.

**Zero tests exist** for: `runtime.ts`, `connector-sessions.ts` (the most complex/critical file —
session lifecycle, cost calculation, `Preparing→Charging` promotion), `rfid.ts`, `events.ts`,
`prisma-configuration-store.ts`, `serialize.ts`.

No test-DB wiring exists in `vitest.config.ts` (no global setup file, no mocking of `@/lib/prisma`
anywhere in the test suite). A local Postgres is available via `docker-compose.yml`
(`postgres` service, port 5442) for integration-style tests against a real Prisma client.
Recommend adding tests for the DB-touching modules against that local Postgres (run
`prisma migrate deploy` against a dedicated test schema/DB in a vitest global setup) rather than
mocking Prisma, since these modules are almost entirely persistence logic — mocking would test
very little.
