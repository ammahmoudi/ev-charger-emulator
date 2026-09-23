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

## Round 2 addendum

Merged `agent/integration` (clean, no conflicts — see `AUDIT-integration.md` for what it
resolved, notably the same connector-status split flagged as finding #3 above, for the
remote-start/stop direction). This round: set up the component-testing stack finding #2 called
for as future work, and added component tests for the round-1 changes plus two more
CSMS-traffic-relevant Home-screen components.

### Component-testing stack

Added `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` as devDependencies (all
React 19-compatible). `vitest.config.ts` now defines two `test.projects` (Vitest 3.2's built-in
project-splitting, each `extends: true` to inherit this file's `resolve.alias`), keyed by
extension rather than by directory so a lib/route test and a component test for the thing it
backs can sit side by side in the same `__tests__/` folder:

- `node` project — unchanged, `*.test.ts`, `environment: "node"`.
- `jsdom` project — new, `*.test.tsx`, `environment: "jsdom"`, with a small `vitest.setup.ts`
  (loads `@testing-library/jest-dom/vitest` matchers, calls `cleanup()` after each test).

No global test APIs (`globals: true`) were enabled — every new test file explicitly imports
`describe`/`it`/`expect`/`vi` from `vitest`, matching the existing `.test.ts` style.

### CSMS-URL stale-status fix: now covered

`src/app/api/device-instances/[id]/route.ts` had no tests at all before this round (checked
first, per the brief). Added
`src/app/api/device-instances/[id]/__tests__/route.test.ts`, a DB-gated integration test (same
`describe.skipIf(!process.env.DATABASE_URL)` + `test-helpers.ts` fixture pattern as
`runtime.test.ts`/`connector-sessions.test.ts`, since the route talks to real Prisma) covering:
CONNECTED→DISCONNECTED and CONNECTING→DISCONNECTED on a csmsUrl change, no-op when the
submitted csmsUrl is unchanged, and no-op when the instance was already DISCONNECTED. This
sandbox still can't reach the docker-mapped Postgres (same limitation `AUDIT-integration.md`
documented), so these 4 tests skip here; they follow the exact pattern of the ~40 other DB-gated
tests in the merged suite, which is the established way this repo verifies Prisma-backed code.

### New component tests

- `src/app/instances/[id]/status/__tests__/page.test.tsx` — the per-plug unlock buttons added in
  round 1 (finding #2): renders a details link + unlock button per connector; only enables
  unlock for a currently-locked connector; clicking unlock POSTs `{locked:false}` to the right
  connector's lock endpoint and disables the button once the refetch reflects it. Mocks
  `next/navigation`'s `useParams` and `global.fetch` (no network/DB needed).
- `src/components/device-instances/__tests__/ConnectorChargeCard.test.tsx` — the Home screen's
  per-plug card: `Available` (idle prompt, enabled Charging button, calls `onStartCharging`),
  `Charging` (idTag + live energy/elapsed-time readout computed from a fixed `now`, calls
  `onStopCharging`), `Finishing` (falls back to the idle prompt with the Charging button
  correctly *disabled*, since the component only special-cases `Preparing`/`Charging`/`Faulted`),
  and `Faulted` (fault message, calls `onClearFault`).
- `src/components/device-instances/__tests__/HomeHeaderBar.test.tsx` — the Home screen's
  connection-status control: `CONNECTED`/`CONNECTING` both read as "running" (toggle offers
  "stop" next), `DISCONNECTED`/`FAULTED` both read as "not running" (toggle offers "start"
  next), a set `statusReason` appears in the toggle's title, clicking the toggle calls
  `onToggleConnection`, and the live clock/serial number render from props.

### Pre-existing test-infra gap fixed in passing

Merging in `agent/state`'s work wired `diagnostics.ts`'s `getInterfaceBoardReading`/
`setInterfaceBoardToggleField`/`setContactorField`/`getPlugOutputCurrent` to a real Prisma lookup
(`resolveNumericConnectorId`) even for the "instance doesn't exist" fallback case — so 4 of
`diagnostics.test.ts`'s tests silently started requiring `DATABASE_URL` to be at least
*configured* (Prisma throws a validation error before attempting any connection if it's unset at
all), without being wrapped in that file's own `describe.skipIf(!process.env.DATABASE_URL)`
pattern that its other DB-touching block already uses. This surfaced as 4 failures (not skips)
running the merged suite in this sandbox. Fixed by gating the two affected `describe` blocks the
same way — a mechanical, test-only, two-line change following the file's own existing pattern
(not a logic change, and not `diagnostics.ts` itself), so I made it directly rather than only
noting it.

### Files touched (round 2)

- `vitest.config.ts`, `vitest.setup.ts` (new) — component-testing stack
- `package.json`/`package-lock.json` — new devDependencies
- `src/app/api/device-instances/[id]/__tests__/route.test.ts` (new)
- `src/app/instances/[id]/status/__tests__/page.test.tsx` (new)
- `src/components/device-instances/__tests__/ConnectorChargeCard.test.tsx` (new)
- `src/components/device-instances/__tests__/HomeHeaderBar.test.tsx` (new)
- `src/lib/device-instances/__tests__/diagnostics.test.ts` (test-only DB-gate fix)

### Test results (round 2)

- `npx vitest run` — 22 files: 13 passed, 9 skipped (all DB-gated, consistent with this
  sandbox's documented lack of Postgres reachability); 132 tests passed, 49 skipped, 0 failed.
- `npx tsc --noEmit` — clean.
- `npm run lint` — clean.
