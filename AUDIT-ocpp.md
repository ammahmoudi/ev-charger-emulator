# OCPP protocol engine audit — `src/lib/ocpp/**`

Scope: `client.ts`, `session.ts`, `remote-commands.ts`, `remote-command-types.ts`, `types.ts`,
`session-types.ts`, `errors.ts`, `in-memory-configuration-store.ts`, `index.ts`, and their tests.

Method: read every file in scope; cross-checked message shapes/enums/behavior against
CitrineOS core's OCPP 1.6 JSON Schemas (`packages/base/src/ocpp/model/1.6/`) and against real
recorded `OCPPMessages` rows in the CitrineOS dev DB (read-only) for a PEVC3107E-class station.

## Bugs found and fixed

1. **Zeroed-out `MeterValues` during active transactions (the headline bug).**
   `sendMeterValues` always reported a single `Energy.Active.Import.Register` sample hardcoded
   to `"0"`, regardless of whether/how long a transaction had been running. Real DB traffic
   confirms an idle connector legitimately reports `"0.00"` with `context: "Sample.Clock"`,
   `location: "Outlet"` — that part was fine — but an **active** transaction should report a
   growing register plus `Voltage`/`Current.Import`/`Power.Active.Import`/`Power.Offered`/`SoC`,
   all tagged `context: "Sample.Periodic"`, `phase: "L1"`, with per-measurand `location`
   (`Cable` for V/A/W, `Body` for energy, `EV` for SoC) — see the real sample in the DB. Fixed by
   adding a per-connector meter simulation (`buildSampledValues` in `remote-commands.ts`) that
   tracks a persistent per-connector energy register, simulated charge rate (read from the
   `evChargerRatedPowerKw` config key when available, else a 30 kW fallback), and derives
   realistic Voltage/Current/Power/SoC from it.
2. **`meterStart`/`meterStop` hardcoded to `0`.** Every `StartTransaction`/`StopTransaction` sent
   `meterStart: 0` / `meterStop: 0` regardless of the connector's actual accumulated energy.
   Fixed: `meterStart` now reads the connector's persisted (in-process) energy register;
   `meterStop` reflects the register after the simulated energy accumulated during the session.
3. **No periodic `MeterValues` during a transaction.** A real charger samples periodically
   (per `MeterValueSampleInterval`); this emulator only ever sent one on `TriggerMessage`. Fixed:
   a per-transaction interval timer now sends `MeterValues` every `MeterValueSampleInterval`
   seconds (config-driven, default 60s) while charging, and is cleaned up on stop/dispose.
4. **`RemoteStopTransaction` sent `StopTransaction` with no `reason`** (defaulting, per spec, to
   the CSMS inferring `"Local"`) even though this stop was CSMS-initiated. Fixed to send
   `reason: "Remote"`, the correct spec value, and to include `idTag` (optional but present in
   real traffic) and a `transactionData` final `Transaction.End` meter sample (matches the real
   `StopTransaction` sample recorded in the DB, which includes `transactionData`).
5. **A connector in `Reserved` status could never actually be started.** `ReserveNow` didn't
   exist at all (see gaps below), but once added, a naive integration would leave a reserved
   connector permanently un-startable since `handleRemoteStartTransaction` only accepted
   `Available`. Fixed as part of the `ReserveNow` implementation: a `RemoteStartTransaction` for
   a `Reserved` connector now succeeds if the idTag matches the reservation (and is rejected
   otherwise), consuming the reservation.
6. **`SupportedFeatureProfiles` under-reported.** The in-memory config store advertised only
   `Core`, even though (after this fix) `FirmwareManagement`, `LocalAuthListManagement`,
   `Reservation`, `SmartCharging`, and `RemoteTrigger` are all implemented. A CSMS that reads
   this key before deciding which messages to send would never exercise the new features. Fixed.
7. **`TriggerMessage` couldn't trigger `FirmwareStatusNotification`** even generically (it wasn't
   supported at all before this change, so this is a gap, not a regression) — added now that
   firmware handling exists.

## Gaps found and fixed (missing message support)

Per the brief's completeness checklist, these CSMS→ChargePoint messages had no handler at all
(the client responded `NotImplemented` via `client.ts`'s default `CALLERROR` fallback):

- `ReserveNow` / `CancelReservation` — new `src/lib/ocpp/reservation.ts`. Tracks reservations
  with an expiry timer that reverts the connector to `Available`; integrates with
  `RemoteStartTransaction` (see bug 5).
- `SetChargingProfile` / `ClearChargingProfile` — new `src/lib/ocpp/charging-profile.ts`.
  Validates the required `csChargingProfiles` shape (purpose/kind/schedule enums, non-empty
  `chargingSchedulePeriod`) per the CitrineOS JSON Schema, stores profiles keyed by
  `chargingProfileId`, and supports `ClearChargingProfile`'s filter-by-`id`/`connectorId`/
  `chargingProfilePurpose`/`stackLevel` semantics. `RemoteStartTransaction`'s optional
  `chargingProfile` field is now also captured into the same store.
- `DataTransfer` — new `src/lib/ocpp/data-transfer.ts`. Defaults to spec-correct
  `UnknownVendorId` for any vendorId (this emulator implements no vendor extensions), with an
  extension point (`RemoteCommandHandlersDeps.dataTransferHandlers`) for future vendor-specific
  behavior.
- `SendLocalList` / `GetLocalListVersion` — new `src/lib/ocpp/local-list.ts`. Maintains a
  version + idTag→idTagInfo map; `Full` replaces the whole list, `Differential` upserts/removes
  individual entries; returns `VersionMismatch` when `listVersion` doesn't advance, `Failed` for
  a `Differential` before any `Full` has ever been applied, and rejects an oversized list.
- `UpdateFirmware` (+ `FirmwareStatusNotification`) — new `src/lib/ocpp/firmware.ts`. Responds
  with the spec-correct empty `{}` conf, schedules the update for `retrieveDate` (or immediately
  if already past), and reports `Downloading` → `Downloaded` → `Installing` → `Installed` via
  `FirmwareStatusNotification`, mirroring the existing `GetDiagnostics`/
  `DiagnosticsStatusNotification` simulation pattern already in the codebase.

## Verified as already correct (no change needed)

- `BootNotification`/`Heartbeat`/`StatusNotification` lifecycle (`session.ts`): field names,
  `Accepted`/`Pending`/`Rejected` handling, heartbeat-interval negotiation, and per-connector
  `StatusNotification` shape all match the CitrineOS schema and real traffic.
- `Reset` (`Hard`/`Soft`), `UnlockConnector`, `ChangeAvailability` (including `connectorId: 0`
  fan-out and `Scheduled` when a transaction is active), `GetConfiguration`/`ChangeConfiguration`,
  `GetDiagnostics`/`DiagnosticsStatusNotification`: field names/status enums all match spec.
- OCPP-J framing/correlation/reconnect (`client.ts`): CALL/CALLRESULT/CALLERROR handling,
  subprotocol negotiation, exponential backoff — matches spec; no bugs found.
- `Reason` enum spelling (`errors.ts`/`types.ts`'s `OcppErrorCode`, and the new `Reason` values
  used in `remote-commands.ts`) matches the spec's (deliberately odd) spellings, e.g.
  `OccurenceConstraintViolation`.

## Known limitations / out of this PR's scope

- The per-connector energy register and reservation/profile/local-list state are all in-process
  only (reset on restart) — this module has no persistence layer, and per `BRIEF.md` persistence
  (`DeviceInstanceConnectorState`, offline transaction queue, etc.) is `device-instances`'
  scope, not `ocpp/`'s. `remote-commands.ts`'s own `activeTransactions` map was already
  in-memory-only before this change; the new state follows the same existing pattern. **Update
  (round 2):** the reservation/charging-profile/local-auth-list state is now behind an injectable
  store interface (see the addendum below) so a caller *can* back it with Prisma — but no
  Prisma-backed implementation exists yet, so the default (in-memory) behavior is unchanged.
- ~~CSMS-initiated `RemoteStartTransaction`/`RemoteStopTransaction` still track connector state
  only in this module's in-memory maps, not in `device-instances`' Prisma-backed
  `DeviceInstanceConnectorState`~~ — **resolved by `agent/integration`'s merge**: see
  `AUDIT-integration.md`'s `onRemoteTransactionStarted`/`onRemoteTransactionStopped` hooks (now
  merged into `remote-command-types.ts`/`remote-commands.ts`), which `device-instances/runtime.ts`
  wires to `connector-sessions.ts`'s `adoptRemoteSession`/`stopChargingSession`.
- ~~`SetChargingProfile`/`ClearChargingProfile` validate and store profiles but don't yet feed back
  into the simulated charge rate~~ — **resolved (round 2, see addendum below)**: a `TxProfile`'s
  currently-active schedule period now clamps the simulated charge rate.
- No support for the OCPP 1.6 Security Whitepaper's `SignedUpdateFirmware` /
  `SignedFirmwareStatusNotification` variant (out of Core/1.6J base scope).

## Addendum — round 2 (post-`agent/integration` merge)

Merged `agent/integration` (fast-forward, no conflicts) first, which brought in the
`onRemoteTransactionStarted`/`onRemoteTransactionStopped` hooks referenced above. Then:

### 1. `SetChargingProfile` now throttles the simulated charge rate

`remote-commands.ts` gained `getActiveTxProfileSchedule`/`limitToKw`/`activePeriodLimitKw`/
`effectiveChargeRateKwAt`: they look up the highest-`stackLevel` profile stored for the connector
with `chargingProfilePurpose: "TxProfile"` (via `charging-profile.ts`'s `listChargingProfiles`),
find its currently-active `chargingSchedulePeriod` (by elapsed transaction seconds), and clamp
the device's rated power to that period's limit — converting `'A'` to kW via the module's
existing `NOMINAL_VOLTAGE_V` constant, or reading `'W'` directly. `Power.Offered` in `MeterValues`
now reports this throttled ceiling (previously always the rated power), and energy
(`meterStart`/`meterStop`/the register) is integrated **piecewise** across the schedule's periods
— a naive "current rate × total elapsed time" would make a mid-session throttle change appear to
have applied retroactively to energy already accumulated before the profile was even set.

Scoped narrowly, matching the round-2 brief: only `TxProfile` throttles (not
`TxDefaultProfile`/`ChargePointMaxProfile` stacking/composition), and a profile's schedule is
treated as relative to the transaction's own start regardless of `chargingProfileKind`
(`Absolute`/`Recurring` anchoring isn't implemented — `TxProfile` is overwhelmingly used as
`Relative` in practice). Both are documented as follow-ups, not silently assumed.

### 2. `finishingHoldMs` closes the Finishing/Available timing mismatch

Per `AUDIT-integration.md`'s "Timing mismatch during the stop sequence": added
`RemoteCommandHandlersDeps.finishingHoldMs` (ms, default `0` = today's instant flip). When set,
`stopTransaction` still sends `StopTransaction` to the CSMS and fires
`onRemoteTransactionStarted`/`onRemoteTransactionStopped` immediately, but delays only the local
`session.setConnectorStatus(connectorId, "Available")` call by that many ms after `Finishing`.
`device-instances/runtime.ts` can now pass the same duration `connector-sessions.ts` uses for its
own persisted `Finishing` hold, so the in-memory session (dashboard chip) and the Prisma-persisted
state (Home/Cost screens) agree for the duration of the hold instead of briefly disagreeing.
Pending hold timers are tracked in a `Set` and cancelled in `dispose()`.

### 3. Injectable persistence stores for reservations / charging profiles / the local auth list

Three new interfaces in `remote-command-types.ts`, each optional on `RemoteCommandHandlersDeps`
and defaulting to an in-memory implementation (unexported factory functions inside the
corresponding module) when omitted — same DI pattern as the existing `OcppConfigurationStore`
(which `device-instances/prisma-configuration-store.ts` already backs with Prisma). **Exact
shapes, for whoever implements the Prisma-backed side in round 2:**

```ts
// Backs ReserveNow/CancelReservation. Default: in-memory Map, in reservation.ts.
// Note: the expiry *timer* stays in reservation.ts regardless of store — it's
// runtime-only. A Prisma-backed store means reservations survive a restart as
// *data*, but a caller wanting them to actually re-expire correctly across a
// restart would need to re-arm timers for any still-valid rows at startup.
interface OcppReservationStore {
  list(): Promise<OcppReservation[]>;
  get(reservationId: number): Promise<OcppReservation | undefined>;
  set(reservation: OcppReservation): Promise<void>;
  delete(reservationId: number): Promise<void>;
}
// OcppReservation: { reservationId: number; connectorId: number; idTag: string;
//                    parentIdTag?: string; expiryDate: string }

// Backs SetChargingProfile/ClearChargingProfile, keyed by chargingProfileId.
// Default: in-memory Map, in charging-profile.ts. Deliberately minimal — no
// query params; ClearChargingProfile's id/connectorId/chargingProfilePurpose/
// stackLevel filtering happens in charging-profile.ts itself, over store.list().
interface OcppChargingProfileStore {
  list(): Promise<OcppChargingProfileEntry[]>;
  set(chargingProfileId: number, entry: OcppChargingProfileEntry): Promise<void>;
  delete(chargingProfileId: number): Promise<void>;
}
// OcppChargingProfileEntry: { connectorId: number; profile: Record<string, unknown> }
// (profile is the raw csChargingProfiles object; chargingProfileId lives at profile.chargingProfileId)

// Backs SendLocalList/GetLocalListVersion: a version counter + idTag->idTagInfo
// map. Default: in-memory, in local-list.ts. Full/Differential update semantics
// (replace-all vs. upsert-or-remove-per-entry) stay in local-list.ts; the store
// is just get/set/delete primitives.
interface OcppLocalAuthListStore {
  getVersion(): Promise<number>;
  setVersion(version: number): Promise<void>;
  listEntries(): Promise<OcppLocalListEntry[]>;
  setEntry(idTag: string, idTagInfo: OcppIdTagInfo): Promise<void>;
  deleteEntry(idTag: string): Promise<void>;
  clearEntries(): Promise<void>;
}
// OcppLocalListEntry: { idTag: string; idTagInfo: OcppIdTagInfo }
// OcppIdTagInfo: { status: 'Accepted'|'Blocked'|'Expired'|'Invalid'|'ConcurrentTx';
//                  expiryDate?: string; parentIdTag?: string }
```

Wire a Prisma-backed implementation in via `RemoteCommandHandlersDeps.reservationStore` /
`.chargingProfileStore` / `.localAuthListStore` (same place `configStore` is already wired in
`device-instances/runtime.ts`'s `createEntry`) — no changes needed inside `src/lib/ocpp` itself.

Because a real store is necessarily async, the handler functions that read this state
(`RemoteCommandHandlers.listReservations`/`listChargingProfiles`/`getLocalAuthListVersion`/
`listLocalAuthListEntries`) are now `async` too (previously synchronous) — a breaking change to
that introspection surface, applied here since there were no other consumers yet besides this
module's own tests (updated accordingly).

### Testing

`npx vitest run` (79/79 in `src/lib/ocpp`, up from 72 after the merge), `npx tsc --noEmit` (clean
except the pre-existing `layout.tsx` error), `npx eslint .` (clean) — all re-verified after each
of the three commits this round. New coverage: 5 tests for TxProfile throttling (W/A unit
conversion, no-op when the limit exceeds rated power, piecewise multi-period integration, and
`TxDefaultProfile` not throttling), 2 for `finishingHoldMs` (holds then flips, and the
`onRemoteTransactionStopped` hook still fires immediately regardless of the hold).
