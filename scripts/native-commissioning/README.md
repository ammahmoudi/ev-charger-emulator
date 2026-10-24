# Native Prisma-backed emulator commissioning bench

This is test infrastructure, not Core or a group/admission service. It owns no user credential, funds, tariff or quota. A bench transaction is not a Core/CDR/payment session. It accepts exactly one new whitelisted station identity and one unassigned `BENCH-` tag, never an existing instance or account token.

Root must first verify the actual immutable native emulator image and model (plus source revision only when genuinely available), create a new unique instance, and retain that protected binding. Do not list/get/reconcile/reconnect the two existing instances. Give the NEW instance a bench `ws://<private-service>:8080/ocpp/<new-identity>` URL; attach the EV using its own connector API before triggering the bench. The same new instance is disconnected and repointed to actual DEV Core only after successful evidence review.

## Packaging

Root inspected native image `sha256:d573ded1a256065daba8a98129eec4f2059dcba1924cc4c8237da1b8e0e8cc47` (`evyar-ev-charger-emulator-xm8p5n:latest`, working directory `/opt/app`, Node22.22.2). **Its direct `ws` module path is NOT proven**: the attempted `/opt/app/node_modules/ws/package.json` read failed. Do not assume bundled Next modules can be required as `ws`. Root must locate and verify an actual module path, or package an exact pinned/hash-verified pure-JS `ws` artifact for this test bench only.

Use an **immutable cached Node22 application image that actually contains a verified accessible `ws` module**, selected by root from native image inspection. No arbitrary new image tag is certified by this recipe. Place the script beneath that image's verified application directory, or explicitly set `NODE_PATH` to its verified application `node_modules` path. Changing only the working directory does not change Node's script-relative module resolution. The `/tmp` entrypoint below requires that explicit verified `NODE_PATH`. No package install, production image modification or public exposure is required.

Root supplies the exact committed `bench.cjs` bytes as `/tmp/cgp-native-bench/bench.cjs` and records their SHA256 against the committed source. Example container entrypoint after these bytes have been installed:

```
/bin/sh -ec 'umask 077; mkdir -p /tmp/cgp-native-bench/evidence; chmod 700 /tmp/cgp-native-bench/evidence; exec node /tmp/cgp-native-bench/bench.cjs'
```

Attach only the approved private Docker network shared with the native emulator; **no published ports, public domain or external CSMS access**. Root selects the exact cached image ID and module working directory, not this document. Use bounded memory/CPU/PID limits and a one-shot restart policy. Evidence must remain private mode0600 inside a real nonsymlink mode0700 directory. Raw JSONL/evidence/receipt filenames are nonce-specific and exclusive; previous attempts cannot be overwritten.

Required private environment:

- `PORT=8080`
- `CGP_BENCH_IDENTITY`: new unique station path identity (16–100 allowed ASCII characters)
- `CGP_BENCH_ID_TAG`: freshly generated **unassigned** `BENCH-` +12–14 hex characters (at most20 OCPP characters), never a user UID/master tag
- `CGP_BENCH_NONCE`:32 hex characters
- `CGP_BENCH_CONTROL_TOKEN`:64 fresh hex characters; operator-only HTTP control, not an IAM/provider token
- `CGP_BENCH_TX_BASE`: root-reviewed unused integer1900000000–2100000000; five consecutive IDs stay distinct from known Core history and future sequence IDs. Root must establish this disjoint range; high IDs alone are not a uniqueness proof.
- `CGP_BENCH_METER_INTERVAL_S=1` (only supported native profile)
- `CGP_BENCH_EVIDENCE_DIR=/tmp/cgp-native-bench/evidence`
- `CGP_BENCH_NEW_INSTANCE_ID`, `CGP_BENCH_MODEL_ID`: exact protected new-instance binding
- `CGP_BENCH_NATIVE_SOURCE_COMMIT`: actual verified40hex source revision, or the exact explicit value `UNKNOWN` when absent. Missing/blank/lowercase alternatives fail. `UNKNOWN` becomes JSON `nativeSourceCommit:null`; no source-equivalence claim is created.
- `CGP_BENCH_NATIVE_IMAGE_ID`: actual verified immutable sha256 image ID

The native immutable image/instance/model/configuration binding must be independently verified by root before and after the bench. Source is retained only if actually known. The current inspected native image has created/version labels but no source revision or build provenance, so use explicit `UNKNOWN`; its evidence establishes artifact provenance only, never source equivalence to this repository. The native image/source/binding fields are operator assertions bound into measured evidence; the bench cannot independently inspect another container or prove an instance DB row from an OCPP frame. Root must verify these before launch. Boot serial/path equality is additionally checked over the real wire.

## Operator sequence

1. Start only this private bench, inspect `/health` (`GET`, no credentials, no readiness claim).
2. Point/start only the NEW instance; confirm its Boot serial/path matches the protected identity. Plug its EV (`POST /api/device-instances/:newId/connectors/1/ev`, `{connected:true}`). No local session-start/swipe/master action.
3. Root privately calls `GET /status` with `Authorization: Bearer <control-token>`; require `READY`. Do not print the token.
4. Root may privately call `POST /run` with the same control token (single-use,202 only from READY), **or** use the fixed file trigger with no external HTTP client job. The process precreates `<evidenceDir>/<nonce>.run-trigger.json` as an empty0600 regular file. Empty means inert. After raw evidence proves the expected accepted Boot, root writes that exact existing file once through the container-file API, preserving inode/mode, with JSON `{"action":"RUN","nonce":"<exact nonce>","token":"<exact private control token>"}`. The file supports no path, URL, command, evidence or arbitrary payload fields. Nonce/token/READY state and inode/mode are checked; malformed, extra-field or replaced files fail closed. A nonce-specific exclusive consumed receipt records the trigger hash without its token. Polling cannot replay it. HTTP and file trigger share the same `run()` state validation, so only one can win. If the container-file API replaces the inode or changes mode instead of writing in place, stop: do not relax this guard.
5. The bench sends real ChangeConfiguration/GetConfiguration for meter1s, remote authorization true and local/offline switches false. Every accepted value must read back exactly. The native model must support these settings; missing/unsupported parameters fail, never get silently invented.
6. Five actual RemoteStart/Authorize/StartTransaction trials run sequentially. Four periodic register samples are targeted (minimum3 measured); every frame and monotonic receipt timestamp is retained. Duplicate/nonmonotonic/wrong-transaction/stale samples fail. After each real RemoteStop, both its accepted answer and the bound actual StopTransaction are required. Wait for actual Available before the next trial, without bypassing native finishing behavior.
7. Successful child run records `COMPLETE`, artifact/raw/evidence SHA256 receipt (source may be null) and exits0. A rejected/unanswered/malformed frame, timeout, premature disconnect, wrong identity, duplicate meter loop or missing trial produces FAILED evidence and exits1. Overall deadline10minutes; individual call10seconds, trial-meter20seconds, Available30seconds. On failure, `activeTransactionUnresolved` may be true: root must stop/clean up only this new native instance; never reinterpret failure as calibration success.
8. The native file API requires a running container. Root therefore wraps the child bench with an outer supervisor that writes a private child-exit-code file, keeps the container alive for a bounded collection window, waits for an explicit collection ACK, then exits with the **same child code**. Child completion is not container completion until that ACK; no successful supervisor status may replace a failed child code. The bench itself does not claim or implement this operator supervisor. Root reads protected raw/evidence/receipt using the existing container-file API; capture actual native exit0 and file hashes, preserve all failures. Process completion closes the bench wire. Root stops/disconnects only this new instance before repointing its URL, then verifies no pending bench session. Do not reconnect it to Core with an active bench transaction.
9. Review measured capability: **maximum** observed delay/overshoot, rounded upward; max staleness is rounded-up maximum actual periodic gap. No fixed100ms/1Wh, invented safety factor or old measurement timestamp. Evidence `measuredAt` is this real run's completion time. Capability is scoped to this measured native software/configuration and cannot commission physical hardware.
10. Only after review may root use the existing Adapter capability DTO (`REACTIVE_MEASURED`) with the actual `evidenceRef` and actual `measuredAt`; do not let `buildCapabilityBody` redate an older proof. Establish validUntil using approved commissioning validity policy. Then repoint the same new instance to actual DEV WSS identity, read actual GetConfiguration again, run existing configuration verification/readiness, and only then exercise ordinary BFF APP start. No readiness/admission bypass is introduced.

## Limits of the proof

Stop bound is measured from actual bench command emission to actual StopTransaction receipt using a monotonic clock. Overshoot compares actual final register with an extrapolation from the last two real periodic register samples at the command wall-clock instant; raw samples are retained for independent review. Meter timestamp clock skew beyond5seconds, cadence under750ms (duplicate loop), or gaps over5seconds fail the1s profile. These thresholds are test eligibility guards, not fabricated measured capability numbers. The result covers the native simulated charger path in this environment, not a distributed production/physical timing guarantee.

The existing commissioning unit uses an in-memory configuration store. This harness instead drives the already deployed native instance API/runtime and its Prisma-backed store remotely. No native emulator engine, model, API, backend gate or application UI is changed.

## Local source checks

`node --check scripts/native-commissioning/bench.cjs` and `node --test scripts/native-commissioning/bench.test.cjs` (existing `ws` dependency required). Tests use an isolated local fake wire peer only to validate the bench protocol/guards; they are not native commissioning evidence.

## Physical EV handshake between trials

The owned native artifact completed one real trial in attempt002, then timed out after a second Authorize without a StartTransaction. A later owned connector read showed `Available`, `evConnected:true`, no active session. This does **not** prove automatic unplug or a definitive product defect; the artifact's source revision is unknown. An idempotent `{connected:true}` had also returned `Available`, so that call alone does not establish a fresh preparing handshake.

The bench now requires `CGP_BENCH_EMULATOR_APP_NAME` (the verified private emulator application DNS name) and `CGP_BENCH_EMULATOR_BASE_URL=http://<that exact name>:3000`. No public hostname, redirect, credentials, alternative instance or arbitrary endpoint is accepted. Before **each** RemoteStart, with no bench active transaction or pending start, it performs the normal owned-instance API sequence:

1. GET `/api/device-instances/<exact bound instanceId>/connectors`; require connector1 uniquely present, unlocked and inactive.
2. POST that instance's `/connectors/1/ev` with `{connected:false}`; require HTTP200, `Available`, EVfalse, unlocked and no active session.
3. POST the same endpoint with `{connected:true}`; require HTTP200, `Preparing`, EVtrue, unlocked and no active session.

A shared five-second deadline, strict connector responses and redirect rejection cover the complete cycle. Any failure stops before RemoteStart; there is no local session start/stop, master tag, Core or admission call. These are real physical plug-control actions for the isolated simulator, not synthesized OCPP observations. The five RemoteStop timing measurements remain unchanged.

Actual HTTP request/status/acknowledgement evidence is stored separately in `<nonce>.http-actions.jsonl`, included by hash in the receipt/evidence. OCPP raw frames remain actual wire traffic only. After a failed native run, root retains all evidence and actual failed child exit; a future attempt needs a fresh nonce and unassigned tag/unused transaction range, because completed trials remain real native emulator history.

Attempt003 failed closed before the second RemoteStart: the first trial completed, but the next owned connector HTTP response did not satisfy inactivity/readiness. Its original code did not retain that failing connector observation, so the precise state/cause is unknown. An OCPP `Available` observation alone is not sufficient proof that every native HTTP cleanup field has settled.

The pretrial inactive check now records safe connector observations **before** validating them (status, EV presence, lock and active-session presence only; never an idTag). It may repeat only the owned GET within the same five-second total preparation deadline, allowing actual transient cleanup to become inactive. It never unplugs while locked or while an active session remains. If readiness never arrives it fails `OWNED_EV_IDLE_DEADLINE` before any EV mutation or RemoteStart. Wrong identity/schema/HTTP errors keep explicit failure codes. The strict false/Available and true/Preparing acknowledgements remain unchanged. Every observation is retained in the separate HTTP evidence; no OCPP observation or native success is manufactured.
