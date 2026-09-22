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
  in-memory-only before this change; the new state follows the same existing pattern.
- CSMS-initiated `RemoteStartTransaction`/`RemoteStopTransaction` still track connector state only
  in this module's in-memory maps, not in `device-instances`' Prisma-backed
  `DeviceInstanceConnectorState` (used by the Home screen). That integration gap predates this
  change and is cross-cutting (needs a `device-instances`-side change); flagging it here since it
  limits how visible a CSMS-initiated remote start is in the UI, but a fix is outside owned files.
- `SetChargingProfile`/`ClearChargingProfile` validate and store profiles but don't yet feed back
  into the simulated charge rate (i.e., a `TxProfile` limiting to 10A doesn't actually throttle
  the simulated `Power.Active.Import`). Full smart-charging enforcement would need the meter
  simulation to consult the active profile's `chargingSchedule`; left as a follow-up given the
  brief's emphasis on completeness (a slot for every message) over full enforcement semantics.
- No support for the OCPP 1.6 Security Whitepaper's `SignedUpdateFirmware` /
  `SignedFirmwareStatusNotification` variant (out of Core/1.6J base scope).
