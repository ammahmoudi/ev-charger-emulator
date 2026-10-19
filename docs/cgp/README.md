# CGP-0012/0013 commissioning evidence (emulator)

`src/lib/ocpp/__tests__/cgp-commissioning.test.ts` drives the emulator's own OCPP 1.6J client and charging simulation
(`registerRemoteCommandHandlers`) over a real WebSocket against a minimal CSMS that records every frame with a receive
timestamp. Nothing inside the emulator is mocked. It proves, on the wire:

1. **Charger-side authorization switches are readable and changeable.** `GetConfiguration` reports `LocalPreAuthorize`,
   `AllowOfflineTxForUnknownId` and `LocalAuthListEnabled`; `ChangeConfiguration` turns the list off and the value is read
   back from the charger; unknown keys are `NotSupported`. The emulator has no authorization cache (no `AuthorizationCache`
   profile) and says so. With `LocalAuthListEnabled=false` the Prisma-backed instance ignores its local list
   (`rfid.ts` / `isLocalAuthListEnabled`; master card is unaffected).
2. **Stop delay and overshoot, measured** over 5 trials (RemoteStop at varied phase of a 1 s MeterValues clock):
   energy delivered after the request = `StopTransaction.meterStop` minus the register interpolated from the received
   samples at the request instant. See `commissioning-evidence.json` (`perTrial`, `p95`, `capability`).
3. **A bounded path:** the citrineos-adapter's real `decide()`/`latestMeasurement()` (imported from the sibling checkout
   when present) stops a 72 kW session inside a 300 Wh envelope (delivered 290 Wh; unenforced it would pass 600 Wh in
   30 s), and flags a stale meter.

## What this is not
It is **not** a physical charger. The library-level simulation stops within ~1-2 ms; a real station will not. The
`device-instances` layer additionally holds `Preparing` for 8 s and `Finishing` for 5 s (hard-coded) which this wire test
does not exercise. The `capability` block is therefore a *format and pipeline* proof; a station is only offered limited
packages when ITS OWN measured numbers are recorded with `PUT /v1/charging/enforcement-capabilities/:stationMappingId`
(adapter) - see `tests/acceptance/charging-groups/commissioning` in the evyar root worktree.

## Run
```
npx vitest run src/lib/ocpp/__tests__/cgp-commissioning.test.ts --project node          # no database needed
CGP_EVIDENCE_OUT=docs/cgp/commissioning-evidence.json npx vitest run src/lib/ocpp/__tests__/cgp-commissioning.test.ts --project node
DATABASE_URL=... npx vitest run src/lib/device-instances/__tests__/rfid.test.ts --project node # LocalAuthListEnabled behaviour
```
