import type { OcppChargePointStatus } from "@/lib/ocpp";
import { orderModelConnectors } from "@/lib/device-instances/connectors";
import { logDeviceInstanceEvent } from "@/lib/device-instances/events";
import { queueOutboxMessage } from "@/lib/device-instances/outbox";
import { callOcpp, getOrCreateChargePointSession } from "@/lib/device-instances/runtime";
import { isFaultStopCause } from "@/lib/device-instances/stop-causes";
import { prisma } from "@/lib/prisma";

const WH_PER_KWH = 1000;
const MS_PER_HOUR = 3_600_000;
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

function currentEnergyWh(chargeRateKw: number, startedAt: Date, now: Date): number {
  const elapsedMs = Math.max(0, now.getTime() - startedAt.getTime());
  return round2((chargeRateKw * WH_PER_KWH * elapsedMs) / MS_PER_HOUR);
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
): Promise<ConnectorState | null> {
  if (state.status !== "Preparing" || !state.activeStartedAt) return null;
  if (now.getTime() - state.activeStartedAt.getTime() < PREPARING_DURATION_MS) return null;

  const transactionId = state.transactionCounter + 1;
  const chargingStartedAt = new Date(state.activeStartedAt.getTime() + PREPARING_DURATION_MS);

  // Guard against two concurrent pollers both promoting the same connector (see AUDIT-state.md):
  // only the caller whose conditional update actually matches a still-`Preparing` row logs events
  // and notifies the OCPP session; a loser just returns the winner's already-updated row.
  const { count } = await prisma.deviceInstanceConnectorState.updateMany({
    where: { deviceInstanceId, connectorId: state.connectorId, status: "Preparing" },
    data: {
      status: "Charging",
      activeTransactionId: transactionId,
      activeStartedAt: chargingStartedAt,
      transactionCounter: transactionId,
    },
  });

  const updated = await prisma.deviceInstanceConnectorState.findUniqueOrThrow({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId: state.connectorId } },
  });
  if (count === 0) return updated;

  const label = (await getConnectorLabel(deviceInstanceId, state.connectorId)) ?? `Connector ${state.connectorId}`;
  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Charging`, chargingStartedAt);
  await logDeviceInstanceEvent(
    deviceInstanceId,
    "TRANSACTION_STARTED",
    `${label}: transaction #${transactionId} started (card ${state.activeIdTag})`,
    chargingStartedAt,
  );
  await notifySessionStatus(deviceInstanceId, state.connectorId, "Charging");

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

  const label = (await getConnectorLabel(deviceInstanceId, state.connectorId)) ?? `Connector ${state.connectorId}`;
  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to ${finalStatus}`, now);
  await notifySessionStatus(deviceInstanceId, state.connectorId, finalStatus as OcppChargePointStatus);

  return updated;
}

/** Resolves either pending promotion (`Preparing`->`Charging` or `Finishing`->final status) due for `state`. */
async function resolvePendingPromotion(deviceInstanceId: string, state: ConnectorState, now: Date): Promise<ConnectorState | null> {
  return (
    (await resolvePreparingPromotion(deviceInstanceId, state, now)) ?? (await resolveFinishingPromotion(deviceInstanceId, state, now))
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
 */
export async function listConnectorStates(deviceInstanceId: string): Promise<ConnectorRuntimeView[]> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: deviceInstanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });

  const states = await prisma.deviceInstanceConnectorState.findMany({ where: { deviceInstanceId } });
  const now = new Date();
  const resolvedStates = await Promise.all(
    states.map(async (state) => (await resolvePendingPromotion(deviceInstanceId, state, now)) ?? state),
  );
  const stateByConnectorId = new Map(resolvedStates.map((s) => [s.connectorId, s]));

  return orderModelConnectors(instance.deviceModel.connectors).map((connector) => {
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

async function getConnectorLabel(deviceInstanceId: string, connectorId: number): Promise<string | null> {
  const instance = await prisma.deviceInstance.findUnique({
    where: { id: deviceInstanceId },
    select: { deviceModel: { select: { connectors: true } } },
  });
  if (!instance) return null;
  const connector = orderModelConnectors(instance.deviceModel.connectors).find((c) => c.connectorId === connectorId);
  return connector?.displayLabel ?? null;
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
  const state = await getOrCreateState(deviceInstanceId, connectorId);
  const label = await getConnectorLabel(deviceInstanceId, connectorId);
  const displayLabel = label ?? `Connector ${connectorId}`;

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

  const [view] = (await listConnectorStates(deviceInstanceId)).filter((c) => c.connectorId === connectorId);
  return view;
}

/** Clears a connector's `Faulted` status back to `Available` (a local stand-in for the real device's manual reset). */
export async function clearConnectorFault(deviceInstanceId: string, connectorId: number): Promise<ConnectorRuntimeView> {
  await getOrCreateState(deviceInstanceId, connectorId);
  await prisma.deviceInstanceConnectorState.update({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId } },
    data: { status: "Available" },
  });
  const label = (await getConnectorLabel(deviceInstanceId, connectorId)) ?? `Connector ${connectorId}`;
  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Available (Event Clear)`);
  await notifySessionStatus(deviceInstanceId, connectorId, "Available");

  const [view] = (await listConnectorStates(deviceInstanceId)).filter((c) => c.connectorId === connectorId);
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

  const now = new Date();
  let state = await getOrCreateState(deviceInstanceId, connectorId);
  state = (await resolvePendingPromotion(deviceInstanceId, state, now)) ?? state;

  if (state.activeStartedAt) {
    throw new ConnectorSessionError(`Connector ${connectorId} already has a session in progress`);
  }
  if (state.status !== "Available") {
    throw new ConnectorSessionError(`Connector ${connectorId} is not Available (status: ${state.status})`);
  }

  const label = (await getConnectorLabel(deviceInstanceId, connectorId)) ?? `Connector ${connectorId}`;
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

  const [view] = (await listConnectorStates(deviceInstanceId)).filter((c) => c.connectorId === connectorId);
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
  options: { idTag: string; transactionId: number; chargeRateKw: number },
): Promise<ConnectorRuntimeView> {
  const state = await getOrCreateState(deviceInstanceId, connectorId);
  if (state.activeStartedAt) {
    throw new ConnectorSessionError(`Connector ${connectorId} already has a session in progress`);
  }

  const label = (await getConnectorLabel(deviceInstanceId, connectorId)) ?? `Connector ${connectorId}`;
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

  const [view] = (await listConnectorStates(deviceInstanceId)).filter((c) => c.connectorId === connectorId);
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
  const now = new Date();
  let state = await getOrCreateState(deviceInstanceId, connectorId);
  state = (await resolvePendingPromotion(deviceInstanceId, state, now)) ?? state;

  if (!state.activeStartedAt || !state.activeIdTag || !state.activeChargeRateKw) {
    throw new ConnectorSessionError(`Connector ${connectorId} has no session in progress`);
  }

  const label = (await getConnectorLabel(deviceInstanceId, connectorId)) ?? `Connector ${connectorId}`;
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
    const stopTransactionPayload = {
      transactionId: state.activeTransactionId,
      meterStop: Math.round(energyWh),
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
