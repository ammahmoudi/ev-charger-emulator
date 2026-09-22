# UI audit — device instance screens (PEVC3107E)

Scope: `src/components/device-instances/**`, `src/components/device-test/**`,
`src/app/instances/**`, `src/app/page.tsx`, `src/app/layout.tsx`. Audited against
`docs/device-reference/PEVC3107E/**` (screenshots + manual pages) and by reading
`src/lib/device-instances/**` / `src/lib/ocpp/**` as a consumer.

Overall: this area is in good shape. The Home screen, Status/diagnostics overlay, Settings
(Device/System/Networks/Fee Rate/Other), Maintenance, Event, Cost, Lock, QR, and Device
(hardware test) screens all closely mirror the real device's captured screens, and most
"live-looking" data (jittered telemetry, per-connector session timers/energy, event/cost
history) is already wired to real per-instance state rather than placeholders.

## Bugs found and fixed

1. **CSMS URL edit left the connection-status badge stale ("Connected" after the socket was
   actually torn down).** `PATCH /api/device-instances/[id]` (`src/app/api/device-instances/[id]/route.ts`)
   already called `disposeDeviceInstance(id)` when `csmsUrl` changed, which tears down the
   runtime client — but `disposeDeviceInstance` marks the entry `manuallyStopped` before
   disconnecting, which suppresses the client's own `disconnected` → `writeStatus(DISCONNECTED)`
   handler (`runtime.ts`'s `createEntry`). Net effect: editing the Networks tab's Domain name
   (csmsUrl) while an instance was CONNECTED/CONNECTING left `DeviceInstance.status` reading
   "Connected" in the Home header (`HomeHeaderBar`) and dashboard, even though the socket had
   been closed and the runtime registry entry removed — until the user separately hit
   stop/start. This is the exact "does the Networks tab's CSMS URL edit work end to end" case
   the brief asked to verify, and it didn't.
   **Fix:** `route.ts` now also resets `status` to `DISCONNECTED` (with an explanatory
   `statusReason`) whenever the URL changes away from a non-disconnected state. This is a
   change outside this area's owned files (the route lives outside `src/app/instances/**`), but
   it's minimal (four lines) and squarely a UI-correctness fix, so I made it rather than only
   noting it. — `src/app/api/device-instances/[id]/route.ts`

2. **Status/diagnostics overlay was missing the per-plug "unlock" buttons the real device
   shows.** Reference `screenshots/02-status-diagnostics.png` shows four buttons: "Plug A
   details", "Plug A unlock", "Plug B unlock", "Plug B details". The emulator only rendered the
   "details" links. **Fix:** added an "unlock" button per connector next to its details link,
   calling the same `/connectors/:connectorId/lock` endpoint the Lock screen uses (disabled when
   already unlocked). This required loading the connector list twice under two different id
   schemes — the diagnostics screens address a connector by its DB `deviceModelConnector.id`,
   while Lock/Cost/Home use the numeric OCPP `connectorId` — so I added a small
   `orderConnectorsByEvse` helper (`diagnostics-types.ts`) to zip the two lists by
   (evseIndex, connectorIndex) order, and added a unit test for it.
   — `src/app/instances/[id]/status/page.tsx`, `src/lib/device-instances/diagnostics-types.ts`

## Bugs found, not fixed (require changes outside this area's owned files / another agent's
   internals — noted per the brief's rule rather than fixed deeply)

3. **HIGH — Two disconnected connector-status stores; CSMS remote commands and hardware-test
   actions are invisible on the Home/Cost/Lock/Maintenance screens, and local sessions are
   invisible on the dashboard.** This is the root cause behind two things the brief explicitly
   asked to verify — "remote-start/remote-stop reflected live in the UI" and "connector
   availability badges match backend state" — and both currently fail:

   - The dashboard (`src/app/page.tsx`'s `ConnectorStatusChips`) reads connector status from
     `serializeDeviceInstance`/`listDeviceInstances` → `buildConnectorSummaries` →
     `getInstanceConnectorStatuses` (`serialize.ts:9`, `runtime.ts:183`) — the **in-memory**
     `OcppChargePointSession` status, driven by `session.setConnectorStatus(...)`.
   - The Home screen (`ConnectorChargeCard`), Cost, Lock, and Maintenance screens all read
     connector status from `listConnectorStates` (`connector-sessions.ts:120`) — the
     **Prisma-persisted** `DeviceInstanceConnectorState` table, driven by
     `startChargingSession`/`adoptRemoteSession`/`stopChargingSession`.
   - These two stores are never reconciled:
     - `handleRemoteStartTransaction`/`handleRemoteStopTransaction`
       (`src/lib/ocpp/remote-commands.ts:78-131`) only call `session.setConnectorStatus(...)`
       and track the transaction in a closure-local `activeTransactions` map — they never call
       `connector-sessions.ts`'s `adoptRemoteSession`/`stopChargingSession`. So a CSMS-initiated
       `RemoteStartTransaction` correctly drives `StatusNotification`/`StartTransaction` over the
       wire (protocol-correct), but the Home/Cost/Lock/Maintenance screens keep showing the
       connector as `Available` with no active session — a user could then also start a local
       RFID session on the same connector.
     - Conversely, `startChargingSession` (local RFID master-card flow, "Start" on the Cost
       page's quick-simulate panel) only writes `DeviceInstanceConnectorState` — it never calls
       `session.setConnectorStatus(...)` and sends no `StatusNotification`/`StartTransaction` to
       a connected CSMS. So a locally-simulated session is invisible both to the CSMS and to the
       dashboard's `ConnectorStatusChips`.
     - `hardware-test-state.ts`'s `setOutputRunning` (the Device (hardware test) screen's
       "Charging Test" start/stop and each plug's "Contactor action") *also* calls
       `session.setConnectorStatus(...)` directly (`hardware-test-state.ts:296-298`), so running
       a hardware test flips the dashboard's chip to "Charging" while Home/Cost/Lock still show
       "Available" and still allow starting a real session on the same connector.
   - `presentRfidCard`'s non-master-card path (`rfid.ts`) is the one place that already bridges
     this correctly — it drives the real `Authorize`/`StartTransaction` via `session`, then calls
     `adoptRemoteSession` to mirror the result into `DeviceInstanceConnectorState`. The same
     pattern (drive `session.setConnectorStatus` *and* the DB state together) would fix the three
     gaps above.
   - **Why not fixed here:** the fix requires changes inside `src/lib/ocpp/remote-commands.ts`
     (not in this area's owned files, and per the brief owned by whoever built the OCPP protocol
     layer) coordinated with `src/lib/device-instances/connector-sessions.ts` and
     `hardware-test-state.ts` internals (also out of scope per the brief's "don't restructure
     internals" rule) — e.g. deciding how `remote-commands.ts`'s local `activeTransactions` map
     should relate to `DeviceInstanceConnectorState.activeTransactionId`/`activeIsRemote`, and
     whether `hardware-test-state.ts`'s "Charging Test" should mint a real `DeviceInstanceSession`
     row. That's a design decision for the owning agent(s), not a one-line UI fix.

4. **Interface-board/communication diagnostics never reflect an actual charging session
   (contributes to the "reports zeros" complaint).** `diagnostics.ts`'s
   `getInterfaceBoardReading`/`getPlugOutputCurrent` (`diagnostics.ts:186-248`) jitter around a
   fixed baseline that's never updated from `connector-sessions.ts`'s session state — so
   "Plug A interface board"'s AD Sampling voltage stays 0.0 and the Communication screen's
   "plug output current(A)" stays 0.0 even while that connector is actively `Charging`. On the
   real device (see `02-status-diagnostics.png`/`03-communication.png`), these move with the
   session. Not fixed here: `diagnostics.ts` is `src/lib/device-instances` internals another
   agent owns, and wiring it to session state overlaps with finding #3's status-store split.

## Verified working (no bug found)

- RFID simulation flow: master-card path (always local, no CSMS required) and non-master-card
  path (real `Authorize`/`StartTransaction`, gated on `CONNECTED` state) both work as designed;
  `RfidPromptModal` correctly messages which path a given idTag will take.
- Settings screens: Device/System/Networks/Fee Rate/Other tabs, pagination-by-sortOrder-gap, and
  parameter validation all match the reference screenshots and manual pages. `GetConfiguration`/
  `ChangeConfiguration` already read/write the same `DeviceInstanceParameter` rows the Settings
  screen edits (`PrismaConfigurationStore`).
- Maintenance's 5 sub-tabs (Time Setting, Event Record Clear, Consumption Record Clear, Restore
  Factory Setting with both Restore/OCPP buttons, Upgrade Board Program) all have the red
  confirm-dialog treatment matching the manual pages, and Upgrade correctly makes connectors
  `Unavailable` for the simulated duration and bumps the firmware version shown on Setting →
  Device.
- Event log and Cost/session-history tables match the manual's column layouts, paginate
  correctly, and are backed by real per-instance rows (not placeholders).
- Lock screen's "unlock mid-session ends the transaction" behavior matches a real connector's
  cable release and a CSMS `UnlockConnector`.
- Device (hardware-test) screen's 4 sub-tabs match the manual pages' fields; jittered
  temperature/voltage/current readouts vary sensibly with `outputRunning`/contactor state.

## Files touched

- `src/app/api/device-instances/[id]/route.ts` (minimal cross-boundary fix, #1)
- `src/app/instances/[id]/status/page.tsx` (#2)
- `src/lib/device-instances/diagnostics-types.ts` (#2, added `orderConnectorsByEvse`)
- `src/lib/device-instances/__tests__/diagnostics-types.test.ts` (new)

## Test results

- `npx vitest run` — 10 files, 92 tests, all passing (includes the new
  `diagnostics-types.test.ts`).
- `npx tsc --noEmit` — clean (after `npx next typegen`, needed once since this worktree had
  never been built/dev-run, so `next-env.d.ts`'s route types didn't exist yet — unrelated to any
  change here).
- `npm run lint` — clean.

Not attempted: React component tests. The repo has no `@testing-library/react`/jsdom set up
(`vitest.config.ts` is `environment: "node"`, `include: ["src/**/*.test.ts"]` only) and no
existing component test to follow the pattern of — only `src/lib/**` unit tests exist. Adding a
whole component-testing stack felt like more than this bug-fixing pass should take on
unilaterally, so I added a `.test.ts` unit test for the one new pure helper function instead
(`orderConnectorsByEvse`), consistent with the existing `src/lib/device-instances/__tests__/`
style.
