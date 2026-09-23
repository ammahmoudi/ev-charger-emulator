# Integration pass — merging `agent/ocpp` + `agent/state` + `agent/ui`

This branch (`agent/integration`) merges the three parallel audit/fix passes (see `AUDIT-ocpp.md`,
`AUDIT-state.md`, `AUDIT-ui.md`) and closes the one cross-cutting bug all three independently
flagged but couldn't fix within their own file ownership.

## Merge

`agent/ocpp`, `agent/state`, `agent/ui` were merged into `main` in that order with `git merge`.
All three merges were clean (no conflicts) — the three agents' file ownership didn't overlap in
practice, matching the brief's intent.

## The cross-cutting bug: CSMS-initiated sessions invisible to the Home/Cost/Lock/Maintenance screens

**Finding, independently reported by `emu-ocpp`'s "known limitations", `emu-ui`'s finding #3, and
`emu-state`'s "P1 — Split-brain connector status":** there are two independent notions of
"connector status":

- **In-memory** (`OcppChargePointSession`, `src/lib/ocpp/session.ts`) — driven by real OCPP
  `StatusNotification`s, `hardware-test-state.ts`, and `remote-commands.ts`'s
  `RemoteStartTransaction`/`RemoteStopTransaction` handling. Read by the dashboard
  (`src/app/page.tsx`'s `ConnectorStatusChips`).
- **Prisma-persisted** (`DeviceInstanceConnectorState`, `src/lib/device-instances/connector-sessions.ts`)
  — driven by locally-simulated sessions (RFID master-card flow) and, since `emu-state`'s pass,
  also mirrored from the in-memory session for local sessions (`notifySessionStatus`). Read by the
  Home/Cost/Lock/Maintenance screens.

`emu-state`'s pass fixed the **local-session → in-memory** direction. The
**remote-session → Prisma-persisted** direction was still missing: a CSMS-initiated
`RemoteStartTransaction`/`RemoteStopTransaction` correctly drove the real OCPP wire protocol
(`remote-commands.ts`) but never touched `DeviceInstanceConnectorState`, so a remote-started
session was protocol-correct but invisible on the Home/Cost/Lock/Maintenance screens — directly
undercutting the brief's "so CitrineOS core can be exercised with ALL its functions" goal, since
the most CSMS-centric flow (a real remote start) was the one flow the UI couldn't show.

### Fix

Added two optional dependency-injected hooks to `RemoteCommandHandlersDeps`
(`src/lib/ocpp/remote-command-types.ts`): `onRemoteTransactionStarted` and
`onRemoteTransactionStopped`. `src/lib/ocpp/remote-commands.ts` calls them once a
`RemoteStartTransaction`/`RemoteStopTransaction` has actually completed against the CSMS
(`StartTransaction.conf`/`StopTransaction.conf` received). This is a callback, not an import —
`src/lib/ocpp` must stay independent of `device-instances`' Prisma-backed persistence (the same
reason `configStore`/`onError` are already injected rather than hardcoded).

`src/lib/device-instances/runtime.ts` (the existing integration point, which already wires
`configStore` the same way) wires these two hooks to `connector-sessions.ts`'s existing
`adoptRemoteSession`/`stopChargingSession` — the same functions the RFID non-master-card path
already uses for exactly this purpose.

`stopChargingSession` gained two new options to support this without double-sending protocol
traffic or re-deriving numbers that drift from what was actually sent to the CSMS:

- `skipCsmsNotify?: boolean` — `remote-commands.ts` already sent the real `StopTransaction` itself
  before calling the hook; without this flag `stopChargingSession` would (since
  `adoptRemoteSession` sets `activeIsRemote: true`) send a **second** `StopTransaction` for the
  same transaction.
- `energyWhOverride?: number` — the final energy figure `remote-commands.ts` actually reported to
  the CSMS, used instead of `connector-sessions.ts`'s own independent elapsed-time simulation, so
  the persisted `DeviceInstanceSession`/cost the Cost screen shows matches what CitrineOS recorded
  rather than two simulations silently drifting apart.

Both existing call sites of `stopChargingSession` (the stop-session API route,
`connector-sessions.ts`'s own `UnlockConnector` handling) are unaffected — the new options are
optional and default to today's behavior.

### Residual gap (not fixed, documented rather than rushed)

- **Timing mismatch during the stop sequence.** The in-memory session's `Finishing`→`Available`
  transition (`remote-commands.ts`'s `stopTransaction`) is immediate (no hold), while the
  Prisma-persisted state now correctly enters a real `Finishing` hold
  (`connector-sessions.ts`'s `finishingSince`/`finishingNextStatus`, from `emu-state`'s pass)
  before settling to `Available`. For the few seconds of that hold, the dashboard chip
  (in-memory, already `Available`) and the Home/Cost screens (persisted, still `Finishing`)
  briefly disagree. This is a real improvement over complete invisibility, not a full fix —
  unifying it would mean holding the in-memory status in `Finishing` for the same duration,
  which needs the meter-simulation/status code in `remote-commands.ts` to know about the
  persisted layer's `FINISHING_DURATION_MS` constant, another layering question left for a
  follow-up.
- **`hardware-test-state.ts`'s `setOutputRunning`** (Charging Test tab / plug contactor actions)
  still calls `session.setConnectorStatus` directly with no corresponding Prisma-side mirror or
  cross-check against `connector-sessions.ts`'s state — so a hardware test and a real/local
  session can still be started concurrently on the same connector, each blind to the other. Not
  attempted in this pass: unlike the CSMS remote-start case (a real protocol transaction with a
  clear start/stop lifecycle to hook), a hardware "contactor test" has no idTag/transactionId/cost
  and doesn't map cleanly onto `adoptRemoteSession`/`stopChargingSession`'s shape — doing this
  properly needs a small design decision (e.g. a `startChargingSession`/`stopChargingSession`
  guard checking `hardware-test-state.ts`'s per-connector `outputRunning`, and vice versa) rather
  than a mechanical wire-up, and risked more than this pass's remaining time budget could safely
  verify without live DB access (see Testing below). Flagging as the clearest remaining follow-up.
- **`SetChargingProfile`/`ClearChargingProfile`** (from `emu-ocpp`'s pass) still validate/store
  profiles but don't throttle the simulated charge rate in either `remote-commands.ts`'s or
  `connector-sessions.ts`'s energy math — unchanged from `AUDIT-ocpp.md`'s own documented
  limitation.

## Testing

- `npx tsc --noEmit` — clean (the one pre-existing `src/app/layout.tsx` `LayoutProps` error,
  present on a clean `main` checkout before any of this work, confirmed by all three source
  audits independently and left untouched here too).
- `npx eslint .` — clean.
- `npx vitest run` — **this sandbox cannot reach the local Postgres container's mapped port**
  (confirmed: `docker ps`/`docker exec` work, but TCP to `localhost:5442` or the container's
  bridge-network IP both hang/refuse from this shell — a sandbox networking limitation, not a
  code defect). Effect: the ~40 DB-integration tests under `src/lib/device-instances/__tests__/`
  (gated by `describe.skipIf(!process.env.DATABASE_URL)`) skip cleanly with no `DATABASE_URL` set,
  and 4 non-gated `diagnostics.test.ts` tests that (as of `emu-state`'s pass) now touch Prisma
  fail here for the same reason. All of this merged code is unchanged from what `emu-ocpp`
  (114/114 passing, own worktree, own DB) and `emu-state` (128/128 passing, own worktree, own DB)
  each verified independently pre-merge — this pass only added the OCPP-layer tests below (which
  need no DB) and one new DB-gated `connector-sessions.test.ts` case (untested here for the same
  DB-reachability reason as above, but written in the exact pattern as the six existing cases in
  that file, all of which passed 128/128 in `emu-state`'s own run).
  - `src/lib/ocpp/__tests__/remote-commands.test.ts`: 56/56 passing (54 pre-existing + 2 new,
    covering the new hooks: fires with the right args and `chargeRateKw`, and a throwing hook is
    caught via `onError` without blocking the real protocol transition).
  - Full non-DB suite: 118/163 passing, 41 skipped (DB-gated, correctly skip absent
    `DATABASE_URL`), 4 failing (DB-reachability only, see above) — 0 unexplained failures.
- **Not done, and should be done before treating this as fully verified**: running
  `npx vitest run` in an environment with real Postgres reachability (any of the three original
  worktrees, or a machine that isn't this sandboxed shell) to execute the new
  `connector-sessions.test.ts` case and the full DB-gated suite together with these changes.

## Recommended next step for the owner

Live-connect a running instance to a real CSMS (this pass deliberately never did this — see each
worktree's `BRIEF.md`) and drive a `RemoteStartTransaction`/`RemoteStopTransaction` from it, then
confirm the Home screen shows the session and the Cost screen shows a matching entry with the
same energy the CSMS's own `MeterValues`/`StopTransaction` recorded.

## Round 2

Merged `agent/ocpp`, `agent/state`, `agent/ui`'s round-2 work (see each `AUDIT-*.md`'s round-2
addendum) — all three merges were clean (`agent/ui`'s merge auto-resolved one non-conflicting
overlap in `diagnostics.test.ts`, where both `agent/state` and `agent/ui` had touched different
describe blocks in the same file). `agent/state`'s round-2 item #5 (Prisma-backed stores for
`agent/ocpp`'s new `OcppReservationStore`/`OcppChargingProfileStore`/`OcppLocalAuthListStore`
interfaces) completed successfully — `agent/state` waited for and merged `agent/ocpp`'s round-2
commits before implementing its side, confirmed by reading `runtime.ts`: all three stores are
wired into `registerRemoteCommandHandlers`.

One issue surfaced by the merge, fixed here: round 2's diagnostics/hardware-test toggle-state
persistence made previously-DB-free unit tests in `diagnostics.test.ts` and
`hardware-test-state.test.ts` start requiring `DATABASE_URL` without being gated for it (14 new
failures in this sandbox, which still can't reach the mapped Postgres port — see round 1's
Testing section). For `diagnostics.ts` (no existing DI seam), gated the three affected
`describe` blocks with the same `describe.skipIf(!process.env.DATABASE_URL)` pattern already
used elsewhere in that file. For `hardware-test-state.ts` — which already has a
dependency-injection pattern (`HardwareTestStateDeps`) specifically so its own tests don't need a
real DB — did the more consistent fix instead: added
`loadPersistedInstanceSettings`/`savePersistedInstanceSettings`/`loadPersistedPlugToggles`/
`savePersistedPlugToggles` to that interface (defaulting to the existing Prisma-backed
implementations) and threaded them through, restoring all 14 of that file's behavior tests to
running DB-free rather than losing that coverage to a blanket skip.

Round 2 final state (this sandbox, still without Postgres reachability): `npx vitest run` — 136
passing, 80 skipped (DB-gated, correctly absent `DATABASE_URL`), 0 failures. `npx tsc --noEmit`
clean (pre-existing `layout.tsx` error only). `npx eslint .` clean.

Real-DB verification of this exact merged/fixed state, the live-CSMS connectivity test, and
pushing/opening a PR were delegated to a herdr agent with genuine Docker/network access (this
sandbox has none — confirmed: DNS resolution itself fails). See that agent's own report for
results.

## Round 3 — "the primary Home-screen flow was invisible to the CSMS"

Following up on the user's explicit push to fully support manual start, remote start,
authorizations, and config end to end, and a discovery mid-way through this pass that this
sandbox **can** reach the local Postgres container via `host.docker.internal` (just not via
`localhost`/`127.0.0.1`, nor any external host) — so this round's DB-backed tests below were
actually run for real, not just written.

### The core gap: local/RFID-authorized sessions never reached the CSMS

`connector-sessions.ts::startChargingSession` (the Home screen's "Charging" button, reached via
either the master card or a `local-auth.ts`-listed card in `rfid.ts::presentRfidCard`) is a pure
local simulation — it never sent `Authorize`/`StartTransaction`/`MeterValues`/`StopTransaction`
to the CSMS, even while fully `CONNECTED`. Only two paths ever produced real transaction traffic:
a CSMS-initiated `RemoteStartTransaction`, and an *online* (not locally-authorized) RFID swipe.
Concretely, this meant the emulator's most-used demo path — clicking "Charging" on the Home
screen — was invisible to CitrineOS's Transactions module, directly undercutting "CSMS can
exercise ALL its functions."

**Fix**: `resolvePreparingPromotion` (the function that turns `Preparing` into `Charging` for
every local session, regardless of which authorization path reached it) now, once it's won the
promotion race, checks `getRuntimeConnectionState`; if `CONNECTED`, it sends a real
`StartTransaction` (using the connector's persisted cumulative meter register as `meterStart` —
see below), adopts the CSMS's own `transactionId`, marks the row `activeIsRemote`, and starts a
periodic `MeterValues` sender. `stopChargingSession` already knew how to send a real
`StopTransaction` for an `activeIsRemote` session (round 1) — that machinery now fires for these
sessions too, automatically. A failed report (nominally connected but the call itself fails) is
queued via the existing offline outbox, same "local storage" pattern as an offline `StopTransaction`.

This closes the gap for **every** local authorization path in one place — master card, local
auth list, and (unchanged) the existing CSMS-remote and online-RFID paths — since they all funnel
through this same promotion function.

### A real correctness bug found and fixed along the way: absolute register vs. per-transaction delta

While wiring `meterStop` for the fix above, found that `onRemoteTransactionStopped`'s
`meterStopWh` (added in round 1) was the connector's **absolute cumulative register**, but the
receiving side (`stopChargingSession`, via `energyWhOverride`) treated it as this transaction's
own **delta** — storing it directly as `DeviceInstanceSession.energyWh` and using it for cost
calculation. For a connector's first-ever transaction (register starts at 0) delta and absolute
value coincide, hiding the bug; a connector's **second** transaction would have shown a wildly
wrong "session energy" (the entire register, not just what was consumed this session) on the Cost
screen, with cost computed on that inflated figure. Fixed at the source
(`src/lib/ocpp/remote-commands.ts::stopTransaction`): the hook now receives `energyWh` (this
transaction's own delta, `meterStopWh - meterStartWh`), not the absolute register — the real
`StopTransaction.meterStop` sent on the wire is unchanged (still correctly absolute). Added a
regression test running two transactions back-to-back on the same connector (the only way to
actually distinguish delta from absolute, since a single transaction can't).

`stopChargingSession`'s own `meterStop` (for the two paths that call `callOcpp("StopTransaction")`
directly — this round's new local-report path, and the existing online-RFID path) had the mirror
version of the same class of bug: it sent `energyWh` (a delta) as `meterStop` directly, which
would make CitrineOS's `totalKwh = meterStop - meterStart` compute negative for any transaction
after a connector's first. Fixed by adding the connector's register baseline back before sending.

Also fixed in passing: `rfid.ts`'s online-RFID `StartTransaction` call hardcoded `meterStart: 0`
— the exact same "reports zeros" bug class from round 1, just in a spot the earlier passes didn't
reach. Now uses the same persisted register (`getMeterRegisterWh`, newly exported from
`connector-sessions.ts`).

### Other fixes this round

- **`BootNotification` was missing `firmwareVersion`.** `runtime.ts::createEntry` never read the
  board's current firmware-version parameter (tracked since round 1's maintenance persistence
  work) into the `OcppChargePointSession` identity. Fixed: `getOrCreateEntry` now fetches it once
  per instance's first connection. Known follow-up: it's snapshotted at connection time — a
  firmware upgrade completing on an already-open connection doesn't force a reconnect today, so
  BootNotification wouldn't reflect a mid-session upgrade until the next manual reconnect (a real
  charger would typically reboot after an upgrade, which is when it would resend this).
- **QR codes weren't labeled per EVSE.** The QR screen showed two codes as generic "1"/"2" with
  no indication of which physical plug each belonged to, despite `qrCodeUrl1`/`qrCodeUrl2`
  corresponding 1:1 to the model's connectors in order (the same convention used everywhere else
  in the app). Now labeled by each connector's own `label` (e.g. "Plug A"/"Plug B"). Note: unlike
  every other screen, **no real device screenshot or manual page exists for the QR screen at
  all** (checked `docs/device-reference/PEVC3107E/README.md` — it's absent from the mapping
  table) — this is a reasonable design, not a verified match to real hardware.

### Known limitation carried forward

A tight race: if a user hits Stop in the brief window between `resolvePreparingPromotion` winning
its promotion race and the real `StartTransaction` round-trip resolving, `stopChargingSession`
may run against the pre-report row (`activeIsRemote: false` still) and skip sending
`StopTransaction`, leaving the transaction open at the CSMS. The window is one round-trip
(sub-second in practice); accepted rather than adding full request-level locking this pass.

### Testing (round 3)

Ran with real `DATABASE_URL` (`host.docker.internal:5442`, this sandbox's Postgres reachability
quirk — `localhost`/`127.0.0.1` don't work here, but this hostname does): **`npx vitest run` —
25/25 files, 219/219 tests passing** (up from 217; 2 new integration tests covering the
first-vs-second-transaction `meterStart`/`meterStop` register behavior against a real mock CSMS,
plus a new `src/lib/ocpp` regression test for the delta-vs-absolute bug using two transactions).
`npx tsc --noEmit` — clean (no errors at all this time, including the previously-pre-existing
`layout.tsx` one, likely from an already-generated `.next/types`). `npx eslint .` — clean.

Still not done from this sandbox: the live-CSMS test and push/PR, both blocked by Claude Code's
own safety classifier pending the user's explicit decision (see the conversation, not this file).
