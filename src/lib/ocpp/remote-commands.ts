import { OcppCallError } from "./errors";
import { InMemoryConfigurationStore } from "./in-memory-configuration-store";
import { createChargingProfileHandlers } from "./charging-profile";
import { createDataTransferHandler } from "./data-transfer";
import { createFirmwareHandlers } from "./firmware";
import { createLocalAuthListHandlers } from "./local-list";
import { createReservationHandlers } from "./reservation";
import type {
  OcppActiveTransaction,
  OcppChangeConfigurationStatus,
  OcppConfigurationEntry,
  OcppConfigurationStore,
  RemoteCommandHandlers,
  RemoteCommandHandlersDeps,
} from "./remote-command-types";
import type { OcppChargePointSession } from "./session";
import type { OcppClient } from "./client";

const DEFAULT_RESET_RECONNECT_DELAY_MS = 500;
/** Simulated delay before a `GetDiagnostics` upload reports `Uploaded`, in ms. */
const DEFAULT_DIAGNOSTICS_UPLOAD_DELAY_MS = 2_000;
/** Used when `evChargerRatedPowerKw` isn't present in the configuration store. */
const DEFAULT_SIMULATED_CHARGE_RATE_KW = 30;
const RATED_POWER_CONFIG_KEY = "evChargerRatedPowerKw";
const METER_INTERVAL_CONFIG_KEY = "MeterValueSampleInterval";
const DEFAULT_METER_INTERVAL_SEC = 60;
const MS_PER_HOUR = 3_600_000;
/** Nominal DC bus voltage used for simulated Voltage/Current samples. */
const NOMINAL_VOLTAGE_V = 400;
/** Assumed EV battery capacity used to derive a plausible simulated SoC curve. */
const SIMULATED_BATTERY_CAPACITY_WH = 60_000;
const JITTER_FRACTION = 0.02;

interface TransactionSimState {
  startedAtMs: number;
  meterStartWh: number;
  chargeRateKw: number;
  initialSocPercent: number;
  meterValuesTimer: ReturnType<typeof setInterval> | null;
}

const SUPPORTED_TRIGGER_MESSAGES = new Set([
  "BootNotification",
  "Heartbeat",
  "StatusNotification",
  "MeterValues",
  "DiagnosticsStatusNotification",
  "FirmwareStatusNotification",
]);

/**
 * Registers handlers for CSMS-initiated (remote) OCPP 1.6 commands on top of an
 * {@link OcppClient} and its {@link OcppChargePointSession}: `RemoteStartTransaction`,
 * `RemoteStopTransaction`, `UnlockConnector`, `Reset`, `GetConfiguration`,
 * `ChangeConfiguration`, `ChangeAvailability`, `GetDiagnostics`, `TriggerMessage`,
 * `ReserveNow`/`CancelReservation`, `SetChargingProfile`/`ClearChargingProfile`, `DataTransfer`,
 * `SendLocalList`/`GetLocalListVersion`, and `UpdateFirmware`.
 */
export function registerRemoteCommandHandlers(
  client: OcppClient,
  session: OcppChargePointSession,
  deps: RemoteCommandHandlersDeps = {},
): RemoteCommandHandlers {
  const configStore: OcppConfigurationStore = deps.configStore ?? new InMemoryConfigurationStore();
  const resetReconnectDelayMs = deps.resetReconnectDelayMs ?? DEFAULT_RESET_RECONNECT_DELAY_MS;
  const diagnosticsUploadDelayMs = deps.diagnosticsUploadDelayMs ?? DEFAULT_DIAGNOSTICS_UPLOAD_DELAY_MS;
  const simulatedChargeRateKwFallback = deps.simulatedChargeRateKw ?? DEFAULT_SIMULATED_CHARGE_RATE_KW;
  const onError = deps.onError ?? (() => {});

  const activeTransactions = new Map<number, OcppActiveTransaction>();
  /** Per-connector cumulative energy register (Wh), persisted across transactions for this process's lifetime. */
  const meterRegisterWh = new Map<number, number>();
  const transactionSimState = new Map<number, TransactionSimState>();

  const reservationHandlers = createReservationHandlers(session);
  const chargingProfileHandlers = createChargingProfileHandlers(
    (connectorId) => session.getConnectorStatus(connectorId) !== undefined,
  );
  const localAuthListHandlers = createLocalAuthListHandlers();
  const handleDataTransfer = createDataTransferHandler(deps.dataTransferHandlers);
  const firmwareHandlers = createFirmwareHandlers(client, {
    downloadDelayMs: deps.firmwareDownloadDelayMs,
    installDelayMs: deps.firmwareInstallDelayMs,
    onError,
  });

  function findAvailableConnectorId(): number | undefined {
    return session
      .listConnectorStatuses()
      .find((info) => info.status === "Available" && !activeTransactions.has(info.connectorId))?.connectorId;
  }

  async function getRatedPowerKw(): Promise<number> {
    const { known } = await configStore.list([RATED_POWER_CONFIG_KEY]);
    const parsed = known[0]?.value !== undefined ? Number(known[0].value) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : simulatedChargeRateKwFallback;
  }

  async function getMeterIntervalMs(): Promise<number> {
    const { known } = await configStore.list([METER_INTERVAL_CONFIG_KEY]);
    const parsed = known[0]?.value !== undefined ? Number(known[0].value) : NaN;
    const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_METER_INTERVAL_SEC;
    return seconds * 1000;
  }

  function jitter(value: number): number {
    return value * (1 + (Math.random() * 2 - 1) * JITTER_FRACTION);
  }

  function energyWhSinceStart(state: TransactionSimState, nowMs: number): number {
    const elapsedHours = Math.max(0, nowMs - state.startedAtMs) / MS_PER_HOUR;
    return state.chargeRateKw * 1_000 * elapsedHours;
  }

  /**
   * Builds a realistic `sampledValue` array for a connector: when a transaction is active,
   * reports Energy.Active.Import.Register (a growing register, `location: "Body"`),
   * Voltage/Current.Import/Power.Active.Import/Power.Offered (`location: "Cable"`), and SoC
   * (`location: "EV"`) — matching real PEVC3107E-class traffic recorded by the CSMS. When idle,
   * reports a single zeroed Energy register sample with `context: "Sample.Clock"` and
   * `location: "Outlet"`, which real chargers also do while not charging (see AUDIT-ocpp.md).
   */
  function buildSampledValues(
    connectorId: number,
    context: "Sample.Periodic" | "Transaction.End",
  ): { sampledValue: Record<string, string>[]; meterWh: number } {
    const state = transactionSimState.get(connectorId);
    if (!state) {
      const meterWh = Math.round(meterRegisterWh.get(connectorId) ?? 0);
      return {
        meterWh,
        sampledValue: [
          {
            value: meterWh.toFixed(2),
            context: "Sample.Clock",
            format: "Raw",
            measurand: "Energy.Active.Import.Register",
            location: "Outlet",
            unit: "Wh",
          },
        ],
      };
    }

    const meterWh = Math.round(state.meterStartWh + energyWhSinceStart(state, Date.now()));
    const powerOfferedW = state.chargeRateKw * 1_000;
    const powerActiveImportW = Math.min(powerOfferedW, jitter(powerOfferedW));
    const voltageV = jitter(NOMINAL_VOLTAGE_V);
    const currentA = voltageV > 0 ? powerActiveImportW / voltageV : 0;
    const socPercent = Math.min(
      100,
      Math.round(state.initialSocPercent + (energyWhSinceStart(state, Date.now()) / SIMULATED_BATTERY_CAPACITY_WH) * 100),
    );

    return {
      meterWh,
      sampledValue: [
        {
          value: String(meterWh),
          context,
          format: "Raw",
          measurand: "Energy.Active.Import.Register",
          location: "Body",
          phase: "L1",
          unit: "Wh",
        },
        {
          value: voltageV.toFixed(1),
          context,
          format: "Raw",
          measurand: "Voltage",
          location: "Cable",
          phase: "L1",
          unit: "V",
        },
        {
          value: currentA.toFixed(1),
          context,
          format: "Raw",
          measurand: "Current.Import",
          location: "Cable",
          phase: "L1",
          unit: "A",
        },
        {
          value: powerActiveImportW.toFixed(1),
          context,
          format: "Raw",
          measurand: "Power.Active.Import",
          location: "Cable",
          phase: "L1",
          unit: "W",
        },
        {
          value: powerOfferedW.toFixed(1),
          context,
          format: "Raw",
          measurand: "Power.Offered",
          location: "Cable",
          phase: "L1",
          unit: "W",
        },
        {
          value: String(socPercent),
          context,
          format: "Raw",
          measurand: "SoC",
          location: "EV",
          phase: "L1",
          unit: "Percent",
        },
      ],
    };
  }

  async function sendMeterValues(connectorId: number): Promise<void> {
    const entry = activeTransactions.get(connectorId);
    const { sampledValue } = buildSampledValues(connectorId, "Sample.Periodic");
    const payload: Record<string, unknown> = {
      connectorId,
      meterValue: [{ timestamp: new Date().toISOString(), sampledValue }],
    };
    if (entry) {
      payload.transactionId = entry.transactionId;
    }
    await client.call("MeterValues", payload);
  }

  function stopMeterValuesLoop(connectorId: number): void {
    const state = transactionSimState.get(connectorId);
    if (state?.meterValuesTimer) {
      clearInterval(state.meterValuesTimer);
      state.meterValuesTimer = null;
    }
  }

  async function startMeterValuesLoop(connectorId: number): Promise<void> {
    const intervalMs = await getMeterIntervalMs();
    const state = transactionSimState.get(connectorId);
    if (!state) return;
    state.meterValuesTimer = setInterval(() => {
      void sendMeterValues(connectorId).catch((err) => onError(toError(err)));
    }, intervalMs);
  }

  async function startTransaction(connectorId: number, idTag: string): Promise<void> {
    try {
      session.setConnectorStatus(connectorId, "Preparing");
      const meterStartWh = Math.round(meterRegisterWh.get(connectorId) ?? 0);
      const response = await client.call("StartTransaction", {
        connectorId,
        idTag,
        meterStart: meterStartWh,
        timestamp: new Date().toISOString(),
      });

      const idTagStatus = (response.idTagInfo as { status?: string } | undefined)?.status;
      if (idTagStatus && idTagStatus !== "Accepted") {
        session.setConnectorStatus(connectorId, "Available");
        return;
      }

      activeTransactions.set(connectorId, {
        connectorId,
        transactionId: Number(response.transactionId),
        idTag,
      });
      transactionSimState.set(connectorId, {
        startedAtMs: Date.now(),
        meterStartWh,
        chargeRateKw: await getRatedPowerKw(),
        initialSocPercent: 20 + Math.random() * 20,
        meterValuesTimer: null,
      });
      session.setConnectorStatus(connectorId, "Charging");
      await startMeterValuesLoop(connectorId);
    } catch (err) {
      session.setConnectorStatus(connectorId, "Available");
      onError(toError(err));
    }
  }

  function handleRemoteStartTransaction(payload: Record<string, unknown>): { status: "Accepted" | "Rejected" } {
    const idTag = payload.idTag;
    if (typeof idTag !== "string" || idTag.length === 0) {
      throw new OcppCallError("PropertyConstraintViolation", "idTag is required");
    }

    const requestedConnectorId = typeof payload.connectorId === "number" ? payload.connectorId : undefined;
    const connectorId = requestedConnectorId ?? findAvailableConnectorId();
    if (connectorId === undefined) {
      return { status: "Rejected" };
    }

    const info = session.getConnectorStatus(connectorId);
    if (!info || activeTransactions.has(connectorId)) {
      return { status: "Rejected" };
    }
    if (info.status === "Reserved") {
      if (!reservationHandlers.consumeReservation(connectorId, idTag)) {
        return { status: "Rejected" };
      }
    } else if (info.status !== "Available") {
      return { status: "Rejected" };
    }

    if (payload.chargingProfile) {
      chargingProfileHandlers.tryStoreProfile(connectorId, payload.chargingProfile);
    }

    // Deferred to a macrotask so the RemoteStartTransaction.conf is always sent before
    // any follow-up StatusNotification/StartTransaction messages it triggers.
    setImmediate(() => void startTransaction(connectorId, idTag));
    return { status: "Accepted" };
  }

  async function stopTransaction(entry: OcppActiveTransaction, reason: string): Promise<void> {
    activeTransactions.delete(entry.connectorId);
    stopMeterValuesLoop(entry.connectorId);
    const { sampledValue: finalSampledValue, meterWh: meterStopWh } = buildSampledValues(
      entry.connectorId,
      "Transaction.End",
    );
    meterRegisterWh.set(entry.connectorId, meterStopWh);
    transactionSimState.delete(entry.connectorId);

    try {
      await client.call("StopTransaction", {
        transactionId: entry.transactionId,
        idTag: entry.idTag,
        meterStop: meterStopWh,
        timestamp: new Date().toISOString(),
        reason,
        transactionData: [{ timestamp: new Date().toISOString(), sampledValue: finalSampledValue }],
      });
    } catch (err) {
      onError(toError(err));
    }
    session.setConnectorStatus(entry.connectorId, "Finishing");
    session.setConnectorStatus(entry.connectorId, "Available");
  }

  function handleRemoteStopTransaction(payload: Record<string, unknown>): { status: "Accepted" | "Rejected" } {
    const transactionId = payload.transactionId;
    if (typeof transactionId !== "number") {
      throw new OcppCallError("PropertyConstraintViolation", "transactionId is required");
    }

    const entry = Array.from(activeTransactions.values()).find((t) => t.transactionId === transactionId);
    if (!entry) {
      return { status: "Rejected" };
    }

    setImmediate(() => void stopTransaction(entry, "Remote"));
    return { status: "Accepted" };
  }

  function handleUnlockConnector(
    payload: Record<string, unknown>,
  ): { status: "Unlocked" | "UnlockFailed" | "NotSupported" } {
    const connectorId = payload.connectorId;
    if (typeof connectorId !== "number" || connectorId <= 0 || !session.getConnectorStatus(connectorId)) {
      return { status: "NotSupported" };
    }
    return { status: "Unlocked" };
  }

  async function performReset(type: "Hard" | "Soft"): Promise<void> {
    const reason = type === "Hard" ? "HardReset" : "SoftReset";
    for (const entry of Array.from(activeTransactions.values())) {
      await stopTransaction(entry, reason);
    }

    await new Promise<void>((resolve) => {
      client.once("disconnected", () => resolve());
      client.disconnect(1000, `${type} reset`);
    });

    setTimeout(() => client.connect(), resetReconnectDelayMs);
  }

  function handleReset(payload: Record<string, unknown>): { status: "Accepted" | "Rejected" } {
    const type = payload.type;
    if (type !== "Hard" && type !== "Soft") {
      throw new OcppCallError("PropertyConstraintViolation", "type must be 'Hard' or 'Soft'");
    }

    setImmediate(() => void performReset(type));
    return { status: "Accepted" };
  }

  async function handleGetConfiguration(
    payload: Record<string, unknown>,
  ): Promise<{ configurationKey: OcppConfigurationEntry[]; unknownKey: string[] }> {
    const keys = Array.isArray(payload.key)
      ? payload.key.filter((key): key is string => typeof key === "string")
      : undefined;
    const { known, unknown } = await configStore.list(keys);
    return { configurationKey: known, unknownKey: unknown };
  }

  async function handleChangeConfiguration(
    payload: Record<string, unknown>,
  ): Promise<{ status: OcppChangeConfigurationStatus }> {
    const { key, value } = payload;
    if (typeof key !== "string" || typeof value !== "string") {
      throw new OcppCallError("PropertyConstraintViolation", "key and value are required");
    }
    return { status: await configStore.set(key, value) };
  }

  function handleChangeAvailability(
    payload: Record<string, unknown>,
  ): { status: "Accepted" | "Rejected" | "Scheduled" } {
    const { connectorId, type } = payload;
    if (typeof connectorId !== "number" || (type !== "Operative" && type !== "Inoperative")) {
      throw new OcppCallError("PropertyConstraintViolation", "connectorId and type are required");
    }

    const targets =
      connectorId === 0
        ? session.listConnectorStatuses()
        : (() => {
            const info = session.getConnectorStatus(connectorId);
            return info ? [info] : [];
          })();

    if (targets.length === 0) {
      return { status: "Rejected" };
    }

    let scheduled = false;
    const updates: Array<{ connectorId: number; status: "Available" | "Unavailable" }> = [];
    for (const target of targets) {
      if (type === "Operative") {
        if (target.status === "Unavailable") {
          updates.push({ connectorId: target.connectorId, status: "Available" });
        }
        continue;
      }

      if (activeTransactions.has(target.connectorId)) {
        scheduled = true;
        continue;
      }
      updates.push({ connectorId: target.connectorId, status: "Unavailable" });
    }

    // Deferred so the ChangeAvailability.conf is always sent before the StatusNotifications it triggers.
    setImmediate(() => {
      for (const update of updates) {
        session.setConnectorStatus(update.connectorId, update.status);
      }
    });

    return { status: scheduled ? "Scheduled" : "Accepted" };
  }

  /**
   * Simulates a diagnostics upload: this emulator has no real diagnostics bundle to produce, so
   * it just reports a plausible filename immediately (the `GetDiagnostics.conf`) and then, after
   * a short delay, sends `DiagnosticsStatusNotification` `Uploading` then `Uploaded` — mirroring
   * the shape (not the bytes) of a real charge point's upload-to-`location` flow.
   */
  async function sendDiagnosticsStatusNotification(status: "Uploading" | "Uploaded" | "UploadFailed"): Promise<void> {
    await client.call("DiagnosticsStatusNotification", { status });
  }

  async function performDiagnosticsUpload(): Promise<void> {
    try {
      await sendDiagnosticsStatusNotification("Uploading");
      await new Promise((resolve) => setTimeout(resolve, diagnosticsUploadDelayMs));
      await sendDiagnosticsStatusNotification("Uploaded");
    } catch (err) {
      onError(toError(err));
    }
  }

  function handleGetDiagnostics(payload: Record<string, unknown>): { fileName?: string } {
    const location = payload.location;
    if (typeof location !== "string" || location.length === 0) {
      throw new OcppCallError("PropertyConstraintViolation", "location is required");
    }

    const fileName = `diagnostics_${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
    // Deferred so the GetDiagnostics.conf is always sent before the DiagnosticsStatusNotifications it triggers.
    setImmediate(() => void performDiagnosticsUpload());
    return { fileName };
  }

  async function triggerMessage(requestedMessage: string, connectorId: number | undefined): Promise<void> {
    try {
      switch (requestedMessage) {
        case "BootNotification":
          await session.triggerBootNotification();
          return;
        case "Heartbeat":
          await session.triggerHeartbeat();
          return;
        case "StatusNotification":
          await session.triggerStatusNotification(connectorId as number);
          return;
        case "MeterValues":
          await sendMeterValues(connectorId as number);
          return;
        case "DiagnosticsStatusNotification":
          await sendDiagnosticsStatusNotification("Uploaded");
          return;
        case "FirmwareStatusNotification":
          await firmwareHandlers.triggerFirmwareStatusNotification();
          return;
      }
    } catch (err) {
      onError(toError(err));
    }
  }

  function handleTriggerMessage(
    payload: Record<string, unknown>,
  ): { status: "Accepted" | "Rejected" | "NotImplemented" } {
    const requestedMessage = payload.requestedMessage;
    if (typeof requestedMessage !== "string") {
      throw new OcppCallError("PropertyConstraintViolation", "requestedMessage is required");
    }
    if (!SUPPORTED_TRIGGER_MESSAGES.has(requestedMessage)) {
      return { status: "NotImplemented" };
    }

    const connectorId = typeof payload.connectorId === "number" ? payload.connectorId : undefined;
    if (requestedMessage === "StatusNotification" || requestedMessage === "MeterValues") {
      if (connectorId === undefined || !session.getConnectorStatus(connectorId)) {
        return { status: "Rejected" };
      }
    }

    setImmediate(() => void triggerMessage(requestedMessage, connectorId));
    return { status: "Accepted" };
  }

  client.registerHandler("RemoteStartTransaction", handleRemoteStartTransaction);
  client.registerHandler("RemoteStopTransaction", handleRemoteStopTransaction);
  client.registerHandler("UnlockConnector", handleUnlockConnector);
  client.registerHandler("Reset", handleReset);
  client.registerHandler("GetConfiguration", handleGetConfiguration);
  client.registerHandler("ChangeConfiguration", handleChangeConfiguration);
  client.registerHandler("ChangeAvailability", handleChangeAvailability);
  client.registerHandler("GetDiagnostics", handleGetDiagnostics);
  client.registerHandler("TriggerMessage", handleTriggerMessage);
  client.registerHandler("ReserveNow", reservationHandlers.handleReserveNow);
  client.registerHandler("CancelReservation", reservationHandlers.handleCancelReservation);
  client.registerHandler("SetChargingProfile", chargingProfileHandlers.handleSetChargingProfile);
  client.registerHandler("ClearChargingProfile", chargingProfileHandlers.handleClearChargingProfile);
  client.registerHandler("DataTransfer", handleDataTransfer);
  client.registerHandler("SendLocalList", localAuthListHandlers.handleSendLocalList);
  client.registerHandler("GetLocalListVersion", localAuthListHandlers.handleGetLocalListVersion);
  client.registerHandler("UpdateFirmware", firmwareHandlers.handleUpdateFirmware);

  return {
    getActiveTransaction(connectorId: number): OcppActiveTransaction | undefined {
      return activeTransactions.get(connectorId);
    },
    listActiveTransactions(): OcppActiveTransaction[] {
      return Array.from(activeTransactions.values());
    },
    listReservations: () => reservationHandlers.listReservations(),
    listChargingProfiles: (connectorId) => chargingProfileHandlers.listChargingProfiles(connectorId),
    getLocalAuthListVersion: () => localAuthListHandlers.getVersion(),
    listLocalAuthListEntries: () => localAuthListHandlers.listEntries(),
    dispose(): void {
      client.unregisterHandler("RemoteStartTransaction");
      client.unregisterHandler("RemoteStopTransaction");
      client.unregisterHandler("UnlockConnector");
      client.unregisterHandler("Reset");
      client.unregisterHandler("GetConfiguration");
      client.unregisterHandler("ChangeConfiguration");
      client.unregisterHandler("ChangeAvailability");
      client.unregisterHandler("GetDiagnostics");
      client.unregisterHandler("TriggerMessage");
      client.unregisterHandler("ReserveNow");
      client.unregisterHandler("CancelReservation");
      client.unregisterHandler("SetChargingProfile");
      client.unregisterHandler("ClearChargingProfile");
      client.unregisterHandler("DataTransfer");
      client.unregisterHandler("SendLocalList");
      client.unregisterHandler("GetLocalListVersion");
      client.unregisterHandler("UpdateFirmware");
      for (const connectorId of transactionSimState.keys()) {
        stopMeterValuesLoop(connectorId);
      }
      reservationHandlers.dispose();
      firmwareHandlers.dispose();
    },
  };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
