import type { OcppChargePointStatus } from "@/lib/ocpp";
import { orderModelConnectors, type OrderedDeviceModelConnector } from "@/lib/device-instances/connectors";
import { logDeviceInstanceEvent } from "@/lib/device-instances/events";
// Circular import with hardware-test-state.ts (which imports listConnectorStates back from this
// file) — safe here since both directions only call functions from inside async function
// bodies, never at module-evaluation time; see the two-way collision guard below.
import { isHardwareTestOutputRunning } from "@/lib/device-instances/hardware-test-state";
import { queueOutboxMessage } from "@/lib/device-instances/outbox";
import { callOcpp, getOrCreateChargePointSession, getRuntimeConnectionState } from "@/lib/device-instances/runtime";
import { isFaultStopCause } from "@/lib/device-instances/stop-causes";
import { prisma } from "@/lib/prisma";

const WH_PER_KWH = 1000;
const MS_PER_HOUR = 3_600_000;
/** Nominal DC bus voltage used for this module's own simulated Voltage/Current samples — matches `src/lib/ocpp/remote-commands.ts`'s constant of the same name. */
const NOMINAL_VOLTAGE_V = 400;
/**
 * How often a locally/RFID-initiated real transaction (one this module reported to the CSMS —
 * see `reportTransactionStartToCsms` below) sends `MeterValues` while `Charging`. Matches
 * `src/lib/ocpp/remote-commands.ts`'s own default `MeterValueSampleInterval` fallback.
 */
const METER_VALUES_INTERVAL_MS = 60_000;
/**
 * How long a connector stays in `Preparing` (cable plugged in, card presented, authorizing)
 * before the simulated session promotes to `Charging` and the meter starts. The real OC10
 * device's captured OCPP traffic (fixtures/OC10-PEVC3107E/sample-transaction-ocpp-messages.json,
 * see docs/data-fixtures.md) shows 8-44s between a `Preparing` StatusNotification and the
 * matching StartTransaction — 8s keeps the state clearly visible across a few poll cycles
 * without making the user wait long in the emulator.
 */
const PREPARING_DURATION_MS = 8_000;

/**
 * How long a stopped connector stays in `Finishing` before settling on its final status. Real
 * `PEVC3107E` `StatusNotification` traffic (CitrineOS DB, station 89) shows `Charging` ->
 * `Finishing` -> `Available` with `Finishing` lasting anywhere from ~5s to ~2min; 5s keeps it
 * visible across a couple of poll cycles without making the post-charge popup feel stuck.
 */
const FINISHING_DURATION_MS = 5_000;

/**
 * Best-effort mirror of a local status transition onto the instance's real
 * `OcppChargePointSession` (see `runtime.ts::getOrCreateChargePointSession`), so the
 * dashboard's live connector chips (`serialize.ts::buildConnectorSummaries`, which reads the
 * session's tracked status rather than `DeviceInstanceConnectorState`) agree with the Home/Lock/
 * Cost screens, and — once the instance is actually connected — so the CSMS receives a real
 * `StatusNotification` for locally-simulated sessions too, not just CSMS-initiated ones. Never
 * throws: a session lookup failure must not fail the local state transition it's mirroring.
 */
async function notifySessionStatus(deviceInstanceId: string, connectorId: number, status: OcppChargePointStatus): Promise<void> {
  try {
    const session = await getOrCreateChargePointSession(deviceInstanceId);
    session.setConnectorStatus(connectorId, status);
  } catch (err) {
    console.error(`Failed to mirror connector ${connectorId} status "${status}" onto the OCPP session for ${deviceInstanceId}:`, err);
  }
}

/** Rounds to 2 decimal places. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ConnectorRuntimeView {
  connectorId: number;
  label: string | null;
  status: string;
  locked: boolean;
  activeSession: {
    idTag: string;
    transactionId: number | null;
    startedAt: string;
    chargeRateKw: number;
    currentEnergyWh: number;
  } | null;
}

export interface StopSessionResult {
  connectorId: number;
  connectorLabel: string | null;
  idTag: string;
  transactionId: number | null;
  startedAt: string;
  stoppedAt: string;
  energyKwh: number;
  cost: number;
  currency: string | null;
  stopCause: string;
  isFault: boolean;
  durationSeconds: number;
}

class ConnectorSessionError extends Error {}

/**
 * Refuses to start a real/local charging session on a connector currently running a hardware
 * output test (`hardware-test-state.ts`'s Charging Test tab / plug contactor actions) — the other
 * half of the two-way collision guard (see `hardware-test-state.ts::setOutputRunning`'s matching
 * check the other direction).
 */
function assertNoHardwareTestCollision(deviceInstanceId: string, connectorId: number): void {
  if (isHardwareTestOutputRunning(deviceInstanceId, connectorId)) {
    throw new ConnectorSessionError(
      `Connector ${connectorId} is running a hardware output test — stop it before starting a charging session`,
    );
  }
}

function currentEnergyWh(chargeRateKw: number, startedAt: Date, now: Date): number {
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  return round2((chargeRateKw * WH_PER_KWH * elapsedMs) / MS_PER_HOUR);
}

/**
 * A connector's persisted cumulative energy register (Wh): the sum of every completed
 * `DeviceInstanceSession`'s energy for it. Used as `meterStart`/the running total in
 * `MeterValues` when this module reports a real transaction to the CSMS (see
 * `reportTransactionStartToCsms` below), so a connector's second-and-later transactions report a
 * growing register like a real charger's, not a value that resets to 0 every session. Mirrors
 * `diagnostics.ts::computeEnergyTotal`'s aggregation; kept separate to avoid a cross-module
 * dependency for a one-line query.
 */
export async function getMeterRegisterWh(deviceInstanceId: string, connectorId: number): Promise<number> {
  const { _sum } = await prisma.deviceInstanceSession.aggregate({
    where: { deviceInstanceId, connectorId },
    _sum: { energyWh: true },
  });
  return _sum.energyWh ?? 0;
}

/**
 * Builds a `MeterValues`/`StopTransaction.transactionData` `sampledValue` array for a
 * connector-sessions-initiated real transaction — same measurand/location/phase/unit shape as
 * `src/lib/ocpp/remote-commands.ts`'s own simulation (see AUDIT-ocpp.md), duplicated rather than
 * imported so `src/lib/ocpp` stays independent of this module's Prisma-backed persistence.
 */
function buildLocalSampledValues(
  meterWh: number,
  chargeRateKw: number,
  context: "Sample.Periodic" | "Transaction.End",
): Record<string, string>[] {
  const powerW = chargeRateKw * 1000;
  const currentA = NOMINAL_VOLTAGE_V > 0 ? powerW / NOMINAL_VOLTAGE_V : 0;
  return [
    {
      value: String(Math.round(meterWh)),
      context,
      format: "Raw",
      measurand: "Energy.Active.Import.Register",
      location: "Body",
      phase: "L1",
      unit: "Wh",
    },
    { value: NOMINAL_VOLTAGE_V.toFixed(1), context, format: "Raw", measurand: "Voltage", location: "Cable", phase: "L1", unit: "V" },
    { value: currentA.toFixed(1), context, format: "Raw", measurand: "Current.Import", location: "Cable", phase: "L1", unit: "A" },
    { value: powerW.toFixed(1), context, format: "Raw", measurand: "Power.Active.Import", location: "Cable", phase: "L1", unit: "W" },
  ];
}

/**
 * Per-connector periodic `MeterValues` timers for connector-sessions-initiated real transactions
 * — `globalThis`-backed to survive Next.js dev-server hot reloads, same pattern as
 * `runtime.ts`'s connection registry. Deliberately separate from `src/lib/ocpp/remote-
 * commands.ts`'s own (unrelated) meter-values timer, which already runs for CSMS-
 * `RemoteStartTransaction`-initiated sessions — `adoptRemoteSession`'s `skipMeterValuesLoop`
 * option keeps the two from ever double-reporting the same connector.
 */
const globalForMeterLoops = globalThis as unknown as {
  deviceInstanceMeterValueLoops: Map<string, ReturnType<typeof setInterval>> | undefined;
};
const meterValueLoops = globalForMeterLoops.deviceInstanceMeterValueLoops ?? new Map<string, ReturnType<typeof setInterval>>();
if (process.env.NODE_ENV !== "production") {
  globalForMeterLoops.deviceInstanceMeterValueLoops = meterValueLoops;
}

function meterLoopKey(deviceInstanceId: string, connectorId: number): string {
  return `${deviceInstanceId}:${connectorId}`;
}

function stopMeterValuesLoop(deviceInstanceId: string, connectorId: number): void {
  const key = meterLoopKey(deviceInstanceId, connectorId);
  const timer = meterValueLoops.get(key);
  if (timer) {
    clearInterval(timer);
    meterValueLoops.delete(key);
  }
}

async function sendConnectorMeterValues(deviceInstanceId: string, connectorId: number): Promise<void> {
  try {
    const state = await prisma.deviceInstanceConnectorState.findUnique({
      where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    });
    if (
      !state ||
      state.status !== "Charging" ||
      !state.activeIsRemote ||
      state.activeTransactionId == null ||
      !state.activeChargeRateKw ||
      !state.activeStartedAt
    ) {
      stopMeterValuesLoop(deviceInstanceId, connectorId);
      return;
    }
    const registerBase = await getMeterRegisterWh(deviceInstanceId, connectorId);
    const meterWh = registerBase + currentEnergyWh(state.activeChargeRateKw, state.activeStartedAt, new Date());
    await callOcpp(deviceInstanceId, "MeterValues", {
      connectorId,
      transactionId: state.activeTransactionId,
      meterValue: [
        { timestamp: new Date().toISOString(), sampledValue: buildLocalSampledValues(meterWh, state.activeChargeRateKw, "Sample.Periodic") },
      ],
    });
  } catch (err) {
    console.error(`Failed to send MeterValues for ${deviceInstanceId} connector ${connectorId}:`, err);
  }
}

/**
 * Starts (idempotently) a periodic real `MeterValues` sender for a connector-sessions-initiated
 * real transaction. No-op if already running for this connector. Called only from the two places
 * that actually mint such a transaction (`resolvePreparingPromotion`'s CSMS report, and
 * `adoptRemoteSession` when not `skipMeterValuesLoop`) — deliberately *not* re-armed
 * opportunistically from a read path, since a read path can't tell "this connector's real
 * transaction is this module's to report" apart from "it's a CSMS-`RemoteStartTransaction`
 * one, already served by `src/lib/ocpp/remote-commands.ts`'s own loop" without risking starting
 * a second, duplicate loop for the latter. Known limitation: a process restart mid-transaction
 * silently stops this loop for the rest of that transaction (the eventual `StopTransaction` still
 * reports the fully-accumulated correct total, since that's computed fresh from
 * `activeStartedAt`, not from the timer) — the same accepted restart-survival gap
 * `src/lib/ocpp/remote-commands.ts`'s own timer already has (see AUDIT-ocpp.md).
 */
function ensureMeterValuesLoopRunning(deviceInstanceId: string, connectorId: number): void {
  const key = meterLoopKey(deviceInstanceId, connectorId);
  if (meterValueLoops.has(key)) return;
  const timer = setInterval(() => {
    void sendConnectorMeterValues(deviceInstanceId, connectorId);
  }, METER_VALUES_INTERVAL_MS);
  meterValueLoops.set(key, timer);
}

async function getOrCreateState(deviceInstanceId: string, connectorId: number) {
  return prisma.deviceInstanceConnectorState.upsert({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    update: {},
    create: { deviceInstanceId, connectorId },
  });
}

type ConnectorState = Awaited<ReturnType<typeof getOrCreateState>>;

/**
 * Fetches an instance's device-model connector topology, ordered/numbered the same way
 * everywhere else in the app (see `connectors.ts::orderModelConnectors`). Callers on the
 * hot-polled path (`startChargingSession`/`stopChargingSession`/`setConnectorLock`/
 * `clearConnectorFault`) fetch this once per call and thread it through instead of each doing
 * their own independent `DeviceInstance`+`DeviceModelConnector` round-trip (previously up to
 * 3-4 per call — see AUDIT-state.md's round-2 addendum).
 */
async function loadOrderedConnectors(deviceInstanceId: string): Promise<OrderedDeviceModelConnector[]> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: deviceInstanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });
  return orderModelConnectors(instance.deviceModel.connectors);
}

/** Pure lookup against an already-loaded connector list — no DB round-trip. */
function labelForConnector(connectors: OrderedDeviceModelConnector[], connectorId: number): string | null {
  return connectors.find((c) => c.connectorId === connectorId)?.displayLabel ?? null;
}

/**
 * If `state` has been sitting in `Preparing` for at least `PREPARING_DURATION_MS`, promotes it
 * to `Charging`: mints the transaction id (mirroring real OCPP, where a charge point has none
 * until StartTransaction is accepted) and resets `activeStartedAt` to the moment charging
 * actually began, so the energy meter and elapsed timer count from there rather than from when
 * the connector started preparing. Returns the updated row, or `null` if no promotion was due
 * (caller should keep using the state it already has).
 */
async function resolvePreparingPromotion(
  deviceInstanceId: string,
  state: ConnectorState,
  now: Date,
  connectors: OrderedDeviceModelConnector[],
): Promise<ConnectorState | null> {
  if (state.status !== "Preparing" || !state.activeStartedAt) return null;
  if (now.getTime() - state.activeStartedAt.getTime() < PREPARING_DURATION_MS) return null;

  const localTransactionId = state.transactionCounter + 1;
  const chargingStartedAt = new Date(state.activeStartedAt.getTime() + PREPARING_DURATION_MS);

  // Guard against two concurrent pollers both promoting the same connector (see AUDIT-state.md):
  // only the caller whose conditional update actually matches a still-`Preparing` row logs events
  // and notifies the OCPP session; a loser just returns the winner's already-updated row. This
  // also protects the real-CSMS reporting below: only the winner ever calls out, so exactly one
  // StartTransaction is sent per local transaction regardless of how many concurrent pollers hit
  // this function around the same moment.
  const { count } = await prisma.deviceInstanceConnectorState.updateMany({
    where: { deviceInstanceId, connectorId: state.connectorId, status: "Preparing" },
    data: {
      status: "Charging",
      activeTransactionId: localTransactionId,
      activeStartedAt: chargingStartedAt,
      transactionCounter: localTransactionId,
    },
  });

  let updated = await prisma.deviceInstanceConnectorState.findUniqueOrThrow({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId: state.connectorId } },
  });
  if (count === 0) return updated;

  const label = labelForConnector(connectors, state.connectorId) ?? `Connector ${state.connectorId}`;
  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Charging`, chargingStartedAt);
  await logDeviceInstanceEvent(
    deviceInstanceId,
    "TRANSACTION_STARTED",
    `${label}: transaction #${localTransactionId} started (card ${state.activeIdTag})`,
    chargingStartedAt,
  );
  await notifySessionStatus(deviceInstanceId, state.connectorId, "Charging");

  // Report this transaction to the CSMS if connected — a real charger reports every session it
  // starts once online, whether authorized locally (master card, local auth list) or online (see
  // `rfid.ts`'s own-authorized path, which calls `startChargingSession` too), not only
  // CSMS-initiated ones. Closes the "the emulator's primary Home-screen flow is invisible to the
  // CSMS" gap — see AUDIT-integration.md. Done *after* winning the race above (not before) so
  // exactly one StartTransaction goes out even under concurrent pollers.
  //
  // Known limitation: if a user hits Stop in the brief window between here and the CSMS's
  // response, `stopChargingSession` may run against the pre-report row (`activeIsRemote: false`)
  // and skip sending `StopTransaction`, leaving the transaction open at the CSMS. The window is a
  // single round-trip (typically well under a second); accepted rather than adding full
  // request-level locking for this pass.
  if (updated.activeIdTag && getRuntimeConnectionState(deviceInstanceId) === "connected") {
    const meterStart = Math.round(await getMeterRegisterWh(deviceInstanceId, state.connectorId));
    const startTransactionPayload = {
      connectorId: state.connectorId,
      idTag: updated.activeIdTag,
      meterStart,
      timestamp: chargingStartedAt.toISOString(),
    };
    try {
      const response = await callOcpp(deviceInstanceId, "StartTransaction", startTransactionPayload);
      const realTransactionId = Number(response.transactionId);
      updated = await prisma.deviceInstanceConnectorState.update({
        where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId: state.connectorId } },
        data: {
          activeTransactionId: realTransactionId,
          activeIsRemote: true,
          transactionCounter: Math.max(updated.transactionCounter, realTransactionId),
        },
      });
      ensureMeterValuesLoopRunning(deviceInstanceId, state.connectorId);
      await logDeviceInstanceEvent(
        deviceInstanceId,
        "REMOTE_COMMAND",
        `${label}: reported transaction #${realTransactionId} to CSMS (meterStart ${meterStart} Wh)`,
        chargingStartedAt,
      );
    } catch (err) {
      // Couldn't reach the CSMS despite nominally being connected (e.g. a transient send
      // failure) — queue it for replay on reconnect, the same "local storage" pattern
      // `stopChargingSession` already uses for its own StopTransaction, and keep the local
      // transaction id for now (this transaction stays `activeIsRemote: false` until/unless a
      // future pass reconciles a queued StartTransaction's eventual real id).
      await queueOutboxMessage(deviceInstanceId, "StartTransaction", startTransactionPayload);
      await logDeviceInstanceEvent(
        deviceInstanceId,
        "FAULT",
        `${label}: failed to report StartTransaction to CSMS, queued for retry (${err instanceof Error ? err.message : String(err)})`,
        chargingStartedAt,
      );
    }
  }

  return updated;
}

/**
 * If `state` has been sitting in `Finishing` for at least `FINISHING_DURATION_MS`, promotes it
 * to its final status (`finishingNextStatus`, typically `Available`). Mirrors
 * `resolvePreparingPromotion`'s conditional-update race guard.
 */
async function resolveFinishingPromotion(
  deviceInstanceId: string,
  state: ConnectorState,
  now: Date,
  connectors: OrderedDeviceModelConnector[],
): Promise<ConnectorState | null> {
  if (state.status !== "Finishing" || !state.finishingSince) return null;
  if (now.getTime() - state.finishingSince.getTime() < FINISHING_DURATION_MS) return null;

  const finalStatus = state.finishingNextStatus ?? "Available";

  const { count } = await prisma.deviceInstanceConnectorState.updateMany({
    where: { deviceInstanceId, connectorId: state.connectorId, status: "Finishing" },
    data: { status: finalStatus, locked: false, finishingSince: null, finishingNextStatus: null },
  });

  const updated = await prisma.deviceInstanceConnectorState.findUniqueOrThrow({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId: state.connectorId } },
  });
  if (count === 0) return updated;

  const label = labelForConnector(connectors, state.connectorId) ?? `Connector ${state.connectorId}`;
  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to ${finalStatus}`, now);
  await notifySessionStatus(deviceInstanceId, state.connectorId, finalStatus as OcppChargePointStatus);

  return updated;
}

/** Resolves either pending promotion (`Preparing`->`Charging` or `Finishing`->final status) due for `state`. */
async function resolvePendingPromotion(
  deviceInstanceId: string,
  state: ConnectorState,
  now: Date,
  connectors: OrderedDeviceModelConnector[],
): Promise<ConnectorState | null> {
  return (
    (await resolvePreparingPromotion(deviceInstanceId, state, now, connectors)) ??
    (await resolveFinishingPromotion(deviceInstanceId, state, now, connectors))
  );
}

/**
 * Loads (creating default rows as needed) the runtime state for every connector on an
 * instance's model, using the same (evseIndex, connectorIndex)-ordered `connectorId`
 * numbering as `runtime.ts`'s real `OcppChargePointSession` wiring and `serialize.ts`'s
 * connector summaries — so "connector 1" here is the same physical connector everywhere
 * else in the app. Also lazily promotes any connector that's been `Preparing` or `Finishing`
 * long enough to move on (see `resolvePendingPromotion`) — there's no background job, so this
 * read path (polled by the Home screen every couple seconds) is what actually advances the
 * state machine.
 *
 * `preloadedConnectors`, when given, skips this function's own connector-topology fetch — used
 * by the hot-polled mutation functions below, which already loaded it via `loadOrderedConnectors`
 * for their own label lookup and would otherwise fetch the same data twice.
 */
export async function listConnectorStates(
  deviceInstanceId: string,
  preloadedConnectors?: OrderedDeviceModelConnector[],
): Promise<ConnectorRuntimeView[]> {
  const connectors = preloadedConnectors ?? (await loadOrderedConnectors(deviceInstanceId));

  const states = await prisma.deviceInstanceConnectorState.findMany({ where: { deviceInstanceId } });
  const now = new Date();
  const resolvedStates = await Promise.all(
    states.map(async (state) => (await resolvePendingPromotion(deviceInstanceId, state, now, connectors)) ?? state),
  );
  const stateByConnectorId = new Map(resolvedStates.map((s) => [s.connectorId, s]));

  return connectors.map((connector) => {
    const connectorId = connector.connectorId;
    const state = stateByConnectorId.get(connectorId);
    const activeSession =
      state?.activeStartedAt && state.activeIdTag && state.activeChargeRateKw
        ? {
            idTag: state.activeIdTag,
            transactionId: state.activeTransactionId,
            startedAt: state.activeStartedAt.toISOString(),
            chargeRateKw: state.activeChargeRateKw,
            currentEnergyWh:
              state.status === "Charging" ? currentEnergyWh(state.activeChargeRateKw, state.activeStartedAt, now) : 0,
          }
        : null;

    return {
      connectorId,
      label: connector.displayLabel,
      status: state?.status ?? "Available",
      locked: state?.locked ?? false,
      activeSession,
    };
  });
}

/**
 * Sets a connector's manual lock state (issue #14's Lock screen). Mirrors `UnlockConnector`
 * handling from issue #10, but triggered locally instead of by the CSMS: unlocking a connector
 * that has an in-progress simulated session force-stops it first, matching a real connector's
 * cable release ending any transaction in progress.
 */
export async function setConnectorLock(
  deviceInstanceId: string,
  connectorId: number,
  locked: boolean,
): Promise<ConnectorRuntimeView> {
  const connectors = await loadOrderedConnectors(deviceInstanceId);
  const state = await getOrCreateState(deviceInstanceId, connectorId);
  const displayLabel = labelForConnector(connectors, connectorId) ?? `Connector ${connectorId}`;

  if (!locked && state.activeStartedAt) {
    await stopChargingSession(deviceInstanceId, connectorId, { stopCause: "UnlockConnector" });
  } else {
    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
      data: { locked },
    });
  }

  await logDeviceInstanceEvent(
    deviceInstanceId,
    "REMOTE_COMMAND",
    `${displayLabel}: UnlockConnector (local) → ${locked ? "locked" : "Unlocked"}`,
  );

  const [view] = (await listConnectorStates(deviceInstanceId, connectors)).filter((c) => c.connectorId === connectorId);
  return view;
}

/** Clears a connector's `Faulted` status back to `Available` (a local stand-in for the real device's manual reset). */
export async function clearConnectorFault(deviceInstanceId: string, connectorId: number): Promise<ConnectorRuntimeView> {
  const connectors = await loadOrderedConnectors(deviceInstanceId);
  await getOrCreateState(deviceInstanceId, connectorId);
  await prisma.deviceInstanceConnectorState.update({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    data: { status: "Available" },
  });
  const label = labelForConnector(connectors, connectorId) ?? `Connector ${connectorId}`;
  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Available (Event Clear)`);
  await notifySessionStatus(deviceInstanceId, connectorId, "Available");

  const [view] = (await listConnectorStates(deviceInstanceId, connectors)).filter((c) => c.connectorId === connectorId);
  return view;
}

/**
 * Starts a locally-simulated charging session on a connector. This module persists
 * connector/session state directly, so the Cost/Event/Lock screens have real data to show
 * without requiring a live CSMS.
 *
 * Enters `Preparing` rather than jumping straight to `Charging` — matching the real device's
 * plug-in/authorize/StartTransaction sequence (see `resolvePreparingPromotion`) — so the Home
 * screen has time to show a distinct "authorizing" state before the meter starts.
 */
export async function startChargingSession(
  deviceInstanceId: string,
  connectorId: number,
  options: { idTag: string; chargeRateKw: number },
): Promise<ConnectorRuntimeView> {
  if (options.chargeRateKw <= 0) {
    throw new ConnectorSessionError("chargeRateKw must be > 0");
  }
  assertNoHardwareTestCollision(deviceInstanceId, connectorId);

  const connectors = await loadOrderedConnectors(deviceInstanceId);
  const now = new Date();
  let state = await getOrCreateState(deviceInstanceId, connectorId);
  state = (await resolvePendingPromotion(deviceInstanceId, state, now, connectors)) ?? state;

  if (state.activeStartedAt) {
    throw new ConnectorSessionError(`Connector ${connectorId} already has a session in progress`);
  }
  if (state.status !== "Available") {
    throw new ConnectorSessionError(`Connector ${connectorId} is not Available (status: ${state.status})`);
  }

  const label = labelForConnector(connectors, connectorId) ?? `Connector ${connectorId}`;
  const startedAt = now;

  await prisma.deviceInstanceConnectorState.update({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    data: {
      status: "Preparing",
      locked: true,
      activeIdTag: options.idTag,
      activeTransactionId: null,
      activeStartedAt: startedAt,
      activeChargeRateKw: options.chargeRateKw,
    },
  });

  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Preparing`, startedAt);
  await notifySessionStatus(deviceInstanceId, connectorId, "Preparing");

  const [view] = (await listConnectorStates(deviceInstanceId, connectors)).filter((c) => c.connectorId === connectorId);
  return view;
}

/**
 * Persists an already-started real OCPP session — a real `Authorize`/`StartTransaction` already
 * succeeded against the live CSMS (see `src/lib/device-instances/rfid.ts`'s non-master-card RFID
 * path) — into this module's connector state, so the Home screen's existing Charging timer/energy
 * readout and Stop flow work for it exactly like a local simulated session. Skips `Preparing`
 * (the real `Authorize` call already covered "waiting for authorization") and starts `Charging`
 * immediately with the CSMS's own transaction id, marked `activeIsRemote` so `stopChargingSession`
 * knows to also send a real `StopTransaction` when this session ends.
 */
export async function adoptRemoteSession(
  deviceInstanceId: string,
  connectorId: number,
  options: {
    idTag: string;
    transactionId: number;
    chargeRateKw: number;
    /**
     * Set when the caller (`device-instances/runtime.ts`, for a CSMS-`RemoteStartTransaction`)
     * already runs its own periodic `MeterValues` sender for this transaction
     * (`src/lib/ocpp/remote-commands.ts`'s own timer) — skips starting this module's *second*
     * loop for the same connector, which would otherwise double-report. Omit (or `false`) for
     * `rfid.ts`'s own-authorized RFID path, which has no other `MeterValues` sender.
     */
    skipMeterValuesLoop?: boolean;
  },
): Promise<ConnectorRuntimeView> {
  assertNoHardwareTestCollision(deviceInstanceId, connectorId);
  const connectors = await loadOrderedConnectors(deviceInstanceId);
  const state = await getOrCreateState(deviceInstanceId, connectorId);
  if (state.activeStartedAt) {
    throw new ConnectorSessionError(`Connector ${connectorId} already has a session in progress`);
  }

  const label = labelForConnector(connectors, connectorId) ?? `Connector ${connectorId}`;
  const startedAt = new Date();

  await prisma.deviceInstanceConnectorState.update({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    data: {
      status: "Charging",
      locked: true,
      activeIdTag: options.idTag,
      activeTransactionId: options.transactionId,
      activeStartedAt: startedAt,
      activeChargeRateKw: options.chargeRateKw,
      activeIsRemote: true,
      transactionCounter: Math.max(state.transactionCounter, options.transactionId),
    },
  });

  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Charging`, startedAt);
  await logDeviceInstanceEvent(
    deviceInstanceId,
    "TRANSACTION_STARTED",
    `${label}: transaction #${options.transactionId} started (card ${options.idTag}, via CSMS)`,
    startedAt,
  );

  if (!options.skipMeterValuesLoop) {
    ensureMeterValuesLoopRunning(deviceInstanceId, connectorId);
  }

  const [view] = (await listConnectorStates(deviceInstanceId, connectors)).filter((c) => c.connectorId === connectorId);
  return view;
}

async function getFeeRateParams(
  deviceInstanceId: string,
): Promise<{ pricePerKwh: number; currency: string | null; serviceFeePerSession: number }> {
  const params = await prisma.deviceInstanceParameter.findMany({
    where: {
      deviceInstanceId,
      deviceModelParameter: { key: { in: ["pricePerKwh", "currencyUnit", "serviceFeePerSession"] } },
    },
    include: { deviceModelParameter: { select: { key: true, defaultValue: true } } },
  });

  const byKey = new Map(params.map((p) => [p.deviceModelParameter.key, p.value ?? p.deviceModelParameter.defaultValue]));
  return {
    pricePerKwh: Number(byKey.get("pricePerKwh") ?? 0) || 0,
    currency: byKey.get("currencyUnit") ?? null,
    serviceFeePerSession: Number(byKey.get("serviceFeePerSession") ?? 0) || 0,
  };
}

/**
 * Ends a connector's in-progress simulated session: computes final energy/cost from the
 * fee-rate parameters (issue #12), persists a `DeviceInstanceSession` row for the Cost screen,
 * logs the transaction-stop (and, for a fault stop cause, a fault) event, and returns a summary
 * shaped for the post-charge popup.
 *
 * Works whether the connector is `Preparing` or `Charging`: stopping during `Preparing` (before
 * a transaction id was ever minted) cancels the attempt with zero energy/cost, matching a real
 * connector being released before StartTransaction ever went out.
 */
export async function stopChargingSession(
  deviceInstanceId: string,
  connectorId: number,
  options: {
    stopCause: string;
    /**
     * Set when the caller (`src/lib/ocpp/remote-commands.ts`, via
     * `onRemoteTransactionStopped`) already sent this session's `StopTransaction` to the CSMS
     * itself — skips this function's own CSMS notification so a CSMS-initiated
     * `RemoteStopTransaction` doesn't result in the same transaction's stop being reported
     * twice. See AUDIT-integration.md.
     */
    skipCsmsNotify?: boolean;
    /**
     * The real final energy register (Wh) already reported to the CSMS for this transaction,
     * when known (same source as `skipCsmsNotify`) — used instead of this function's own
     * elapsed-time simulation so the persisted session/cost the Home/Cost screens show matches
     * what the CSMS actually recorded, rather than two independent simulations drifting apart.
     */
    energyWhOverride?: number;
  },
): Promise<StopSessionResult> {
  stopMeterValuesLoop(deviceInstanceId, connectorId);

  const connectors = await loadOrderedConnectors(deviceInstanceId);
  const now = new Date();
  let state = await getOrCreateState(deviceInstanceId, connectorId);
  state = (await resolvePendingPromotion(deviceInstanceId, state, now, connectors)) ?? state;

  if (!state.activeStartedAt || !state.activeIdTag || !state.activeChargeRateKw) {
    throw new ConnectorSessionError(`Connector ${connectorId} has no session in progress`);
  }

  const label = labelForConnector(connectors, connectorId) ?? `Connector ${connectorId}`;
  const stoppedAt = new Date();
  const energyWh =
    options.energyWhOverride ??
    (state.status === "Charging" ? currentEnergyWh(state.activeChargeRateKw, state.activeStartedAt, stoppedAt) : 0);
  const { pricePerKwh, currency, serviceFeePerSession } = await getFeeRateParams(deviceInstanceId);
  const cost = energyWh > 0 ? round2((energyWh / WH_PER_KWH) * pricePerKwh + serviceFeePerSession) : 0;
  const isFault = isFaultStopCause(options.stopCause);
  // A cancelled-before-start `Preparing` stop (no transaction id was ever minted) and a fault
  // stop both skip the `Finishing` hold — one because there's nothing to "finish", the other
  // because a fault is an abrupt stop, not a graceful wind-down.
  const goesThroughFinishing = state.activeTransactionId != null && !isFault;

  if (state.activeIsRemote && state.activeTransactionId != null && !options.skipCsmsNotify) {
    // `meterStop` must be the connector's *absolute* register, not this session's own delta
    // (`energyWh`) — CitrineOS (and any spec-following CSMS) computes
    // `totalKwh = (meterStop - meterStart) / 1000`, and this transaction's `meterStart` was the
    // register baseline at start time (see `resolvePreparingPromotion`/`rfid.ts`'s own
    // `StartTransaction` call), not 0. Recomputing the same aggregate here is safe: this
    // session's own row hasn't been inserted into `DeviceInstanceSession` yet, so the sum is
    // identical to what was used as `meterStart`.
    const meterStop = Math.round((await getMeterRegisterWh(deviceInstanceId, connectorId)) + energyWh);
    const stopTransactionPayload = {
      transactionId: state.activeTransactionId,
      meterStop,
      timestamp: stoppedAt.toISOString(),
      reason: options.stopCause,
    };
    try {
      await callOcpp(deviceInstanceId, "StopTransaction", stopTransactionPayload);
    } catch (err) {
      await logDeviceInstanceEvent(
        deviceInstanceId,
        "FAULT",
        `${label}: failed to notify CSMS of StopTransaction #${state.activeTransactionId} (${err instanceof Error ? err.message : String(err)})`,
        stoppedAt,
      );
      // "Local storage": queue it so a reconnect replays the StopTransaction instead of the
      // CSMS's transaction record dangling open forever (see AUDIT-state.md's offline-outbox finding).
      await queueOutboxMessage(deviceInstanceId, "StopTransaction", stopTransactionPayload);
    }
  }

  await prisma.deviceInstanceSession.create({
    data: {
      deviceInstanceId,
      connectorId,
      connectorLabel: label,
      idTag: state.activeIdTag,
      transactionId: state.activeTransactionId,
      startedAt: state.activeStartedAt,
      stoppedAt,
      energyWh,
      cost,
      currency,
      stopCause: options.stopCause,
    },
  });

  await prisma.deviceInstanceConnectorState.update({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    data: goesThroughFinishing
      ? {
          status: "Finishing",
          locked: true,
          activeIdTag: null,
          activeTransactionId: null,
          activeStartedAt: null,
          activeChargeRateKw: null,
          activeIsRemote: false,
          finishingSince: stoppedAt,
          finishingNextStatus: "Available",
        }
      : {
          status: isFault ? "Faulted" : "Available",
          locked: false,
          activeIdTag: null,
          activeTransactionId: null,
          activeStartedAt: null,
          activeChargeRateKw: null,
          activeIsRemote: false,
        },
  });

  if (state.activeTransactionId != null) {
    await logDeviceInstanceEvent(
      deviceInstanceId,
      "TRANSACTION_STOPPED",
      `${label}: transaction #${state.activeTransactionId} stopped (${options.stopCause})`,
      stoppedAt,
    );
  } else {
    await logDeviceInstanceEvent(
      deviceInstanceId,
      "STATUS_CHANGE",
      `${label}: charging cancelled before start (card ${state.activeIdTag}, ${options.stopCause})`,
      stoppedAt,
    );
  }
  if (isFault) {
    await logDeviceInstanceEvent(deviceInstanceId, "FAULT", `${label} fault: ${options.stopCause}`, stoppedAt);
    await notifySessionStatus(deviceInstanceId, connectorId, "Faulted");
  } else if (goesThroughFinishing) {
    await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Finishing`, stoppedAt);
    await notifySessionStatus(deviceInstanceId, connectorId, "Finishing");
  } else {
    await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Available`, stoppedAt);
    await notifySessionStatus(deviceInstanceId, connectorId, "Available");
  }

  return {
    connectorId,
    connectorLabel: label,
    idTag: state.activeIdTag,
    transactionId: state.activeTransactionId,
    startedAt: state.activeStartedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
    // Round to the nearest Wh before converting rather than round2()-ing the kWh result: energyWh
    // is already the finest-grained unit tracked (and, via energyWhOverride, may be the CSMS's own
    // reported register value), so this avoids losing precision a 2-decimal-kWh rounding would
    // (e.g. 1234 Wh -> 1.234 kWh, not 1.23).
    energyKwh: Math.round(energyWh) / WH_PER_KWH,
    cost,
    currency,
    stopCause: options.stopCause,
    isFault,
    durationSeconds: Math.round((stoppedAt.getTime() - state.activeStartedAt.getTime()) / 1000),
  };
}

export { ConnectorSessionError };
