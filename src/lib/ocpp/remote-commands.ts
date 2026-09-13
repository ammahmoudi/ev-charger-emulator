import { OcppCallError } from "./errors";
import { InMemoryConfigurationStore } from "./in-memory-configuration-store";
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

const SUPPORTED_TRIGGER_MESSAGES = new Set(["BootNotification", "Heartbeat", "StatusNotification", "MeterValues"]);

/**
 * Registers handlers for CSMS-initiated (remote) OCPP 1.6 commands on top of an
 * {@link OcppClient} and its {@link OcppChargePointSession}: `RemoteStartTransaction`,
 * `RemoteStopTransaction`, `UnlockConnector`, `Reset`, `GetConfiguration`,
 * `ChangeConfiguration`, `ChangeAvailability`, and `TriggerMessage`.
 */
export function registerRemoteCommandHandlers(
  client: OcppClient,
  session: OcppChargePointSession,
  deps: RemoteCommandHandlersDeps = {},
): RemoteCommandHandlers {
  const configStore: OcppConfigurationStore = deps.configStore ?? new InMemoryConfigurationStore();
  const resetReconnectDelayMs = deps.resetReconnectDelayMs ?? DEFAULT_RESET_RECONNECT_DELAY_MS;
  const onError = deps.onError ?? (() => {});

  const activeTransactions = new Map<number, OcppActiveTransaction>();

  function findAvailableConnectorId(): number | undefined {
    return session
      .listConnectorStatuses()
      .find((info) => info.status === "Available" && !activeTransactions.has(info.connectorId))?.connectorId;
  }

  async function startTransaction(connectorId: number, idTag: string): Promise<void> {
    try {
      session.setConnectorStatus(connectorId, "Preparing");
      const response = await client.call("StartTransaction", {
        connectorId,
        idTag,
        meterStart: 0,
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
      session.setConnectorStatus(connectorId, "Charging");
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
    if (!info || info.status !== "Available" || activeTransactions.has(connectorId)) {
      return { status: "Rejected" };
    }

    // Deferred to a macrotask so the RemoteStartTransaction.conf is always sent before
    // any follow-up StatusNotification/StartTransaction messages it triggers.
    setImmediate(() => void startTransaction(connectorId, idTag));
    return { status: "Accepted" };
  }

  async function stopTransaction(entry: OcppActiveTransaction, reason?: string): Promise<void> {
    activeTransactions.delete(entry.connectorId);
    try {
      const payload: Record<string, unknown> = {
        transactionId: entry.transactionId,
        meterStop: 0,
        timestamp: new Date().toISOString(),
      };
      if (reason) payload.reason = reason;
      await client.call("StopTransaction", payload);
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

    setImmediate(() => void stopTransaction(entry));
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

  function handleGetConfiguration(
    payload: Record<string, unknown>,
  ): { configurationKey: OcppConfigurationEntry[]; unknownKey: string[] } {
    const keys = Array.isArray(payload.key)
      ? payload.key.filter((key): key is string => typeof key === "string")
      : undefined;
    const { known, unknown } = configStore.list(keys);
    return { configurationKey: known, unknownKey: unknown };
  }

  function handleChangeConfiguration(
    payload: Record<string, unknown>,
  ): { status: OcppChangeConfigurationStatus } {
    const { key, value } = payload;
    if (typeof key !== "string" || typeof value !== "string") {
      throw new OcppCallError("PropertyConstraintViolation", "key and value are required");
    }
    return { status: configStore.set(key, value) };
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

  async function sendMeterValues(connectorId: number): Promise<void> {
    const entry = activeTransactions.get(connectorId);
    const payload: Record<string, unknown> = {
      connectorId,
      meterValue: [
        {
          timestamp: new Date().toISOString(),
          sampledValue: [{ value: "0", measurand: "Energy.Active.Import.Register", unit: "Wh" }],
        },
      ],
    };
    if (entry) {
      payload.transactionId = entry.transactionId;
    }
    await client.call("MeterValues", payload);
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
  client.registerHandler("TriggerMessage", handleTriggerMessage);

  return {
    getActiveTransaction(connectorId: number): OcppActiveTransaction | undefined {
      return activeTransactions.get(connectorId);
    },
    listActiveTransactions(): OcppActiveTransaction[] {
      return Array.from(activeTransactions.values());
    },
    dispose(): void {
      client.unregisterHandler("RemoteStartTransaction");
      client.unregisterHandler("RemoteStopTransaction");
      client.unregisterHandler("UnlockConnector");
      client.unregisterHandler("Reset");
      client.unregisterHandler("GetConfiguration");
      client.unregisterHandler("ChangeConfiguration");
      client.unregisterHandler("ChangeAvailability");
      client.unregisterHandler("TriggerMessage");
    },
  };
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
