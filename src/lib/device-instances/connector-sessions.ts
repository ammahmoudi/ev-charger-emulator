import { orderModelConnectors } from "@/lib/device-instances/connectors";
import { logDeviceInstanceEvent } from "@/lib/device-instances/events";
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

  const label = (await getConnectorLabel(deviceInstanceId, state.connectorId)) ?? `Connector ${state.connectorId}`;
  const transactionId = state.transactionCounter + 1;
  const chargingStartedAt = new Date(state.activeStartedAt.getTime() + PREPARING_DURATION_MS);

  const updated = await prisma.deviceInstanceConnectorState.update({
    where: { deviceInstanceId_connectorId: { deviceInstanceId, connectorId: state.connectorId } },
    data: {
      status: "Charging",
      activeTransactionId: transactionId,
      activeStartedAt: chargingStartedAt,
      transactionCounter: transactionId,
    },
  });

  await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Charging`, chargingStartedAt);
  await logDeviceInstanceEvent(
    deviceInstanceId,
    "TRANSACTION_STARTED",
    `${label}: transaction #${transactionId} started (card ${state.activeIdTag})`,
    chargingStartedAt,
  );

  return updated;
}

/**
 * Loads (creating default rows as needed) the runtime state for every connector on an
 * instance's model, using the same (evseIndex, connectorIndex)-ordered `connectorId`
 * numbering as `runtime.ts`'s real `OcppChargePointSession` wiring and `serialize.ts`'s
 * connector summaries — so "connector 1" here is the same physical connector everywhere
 * else in the app. Also lazily promotes any connector that's been `Preparing` long enough to
 * `Charging` (see `resolvePreparingPromotion`) — there's no background job, so this read path
 * (polled by the Home screen every couple seconds) is what actually advances the state machine.
 */
export async function listConnectorStates(deviceInstanceId: string): Promise<ConnectorRuntimeView[]> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: deviceInstanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });

  const states = await prisma.deviceInstanceConnectorState.findMany({ where: { deviceInstanceId } });
  const now = new Date();
  const resolvedStates = await Promise.all(
    states.map(async (state) => (await resolvePreparingPromotion(deviceInstanceId, state, now)) ?? state),
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
  state = (await resolvePreparingPromotion(deviceInstanceId, state, now)) ?? state;

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
  options: { stopCause: string },
): Promise<StopSessionResult> {
  const now = new Date();
  let state = await getOrCreateState(deviceInstanceId, connectorId);
  state = (await resolvePreparingPromotion(deviceInstanceId, state, now)) ?? state;

  if (!state.activeStartedAt || !state.activeIdTag || !state.activeChargeRateKw) {
    throw new ConnectorSessionError(`Connector ${connectorId} has no session in progress`);
  }

  const label = (await getConnectorLabel(deviceInstanceId, connectorId)) ?? `Connector ${connectorId}`;
  const stoppedAt = new Date();
  const energyWh =
    state.status === "Charging" ? currentEnergyWh(state.activeChargeRateKw, state.activeStartedAt, stoppedAt) : 0;
  const { pricePerKwh, currency, serviceFeePerSession } = await getFeeRateParams(deviceInstanceId);
  const cost = energyWh > 0 ? round2((energyWh / WH_PER_KWH) * pricePerKwh + serviceFeePerSession) : 0;
  const isFault = isFaultStopCause(options.stopCause);

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
    data: {
      status: isFault ? "Faulted" : "Available",
      locked: false,
      activeIdTag: null,
      activeTransactionId: null,
      activeStartedAt: null,
      activeChargeRateKw: null,
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
  } else {
    await logDeviceInstanceEvent(deviceInstanceId, "STATUS_CHANGE", `${label} status changed to Available`, stoppedAt);
  }

  return {
    connectorId,
    connectorLabel: label,
    idTag: state.activeIdTag,
    transactionId: state.activeTransactionId,
    startedAt: state.activeStartedAt.toISOString(),
    stoppedAt: stoppedAt.toISOString(),
    energyKwh: round2(energyWh / WH_PER_KWH),
    cost,
    currency,
    stopCause: options.stopCause,
    isFault,
    durationSeconds: Math.round((stoppedAt.getTime() - state.activeStartedAt.getTime()) / 1000),
  };
}

export { ConnectorSessionError };
