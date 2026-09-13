import type { OcppClient } from "./client";
import { TypedEventEmitter } from "./typed-event-emitter";
import type {
  OcppBootStatus,
  OcppChargePointErrorCode,
  OcppChargePointIdentity,
  OcppChargePointSessionEvents,
  OcppChargePointSessionOptions,
  OcppChargePointStatus,
  OcppConnectorStatusInfo,
} from "./session-types";

const DEFAULT_BOOT_RETRY_FALLBACK_MS = 30_000;
/** Used when the CSMS accepts boot but returns a non-positive interval. */
const DEFAULT_HEARTBEAT_INTERVAL_SEC = 300;

/**
 * Implements the OCPP 1.6 boot/connectivity message flow on top of an {@link OcppClient}:
 * sends `BootNotification` on connect, reacts to Accepted/Pending/Rejected and the
 * negotiated interval, runs the `Heartbeat` loop once accepted, and sends per-connector
 * `StatusNotification`s.
 *
 * This is transport/identity-agnostic — the caller supplies the OCPP identity fields and
 * connector list (typically derived from a `DeviceModel` + device instance), and later
 * work (local charging simulation, remote commands) drives connector status via
 * `setConnectorStatus`. A UI layer can subscribe via `on(...)` for live status.
 */
export class OcppChargePointSession extends TypedEventEmitter<OcppChargePointSessionEvents> {
  private readonly identity: OcppChargePointIdentity;
  private readonly bootRetryFallbackMs: number;
  private readonly connectors = new Map<number, OcppConnectorStatusInfo>();

  private bootStatus: "unknown" | "pending" | "accepted" | "rejected" = "unknown";
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private bootRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly client: OcppClient,
    options: OcppChargePointSessionOptions,
  ) {
    super();
    this.identity = options.identity;
    this.bootRetryFallbackMs = options.bootRetryFallbackMs ?? DEFAULT_BOOT_RETRY_FALLBACK_MS;

    for (const connector of options.connectors) {
      this.connectors.set(connector.connectorId, {
        connectorId: connector.connectorId,
        label: connector.label,
        status: connector.initialStatus ?? "Available",
        errorCode: "NoError",
        timestamp: new Date().toISOString(),
      });
    }

    this.client.on("connected", this.handleClientConnected);
    this.client.on("disconnected", this.handleClientDisconnected);
  }

  getBootStatus(): "unknown" | "pending" | "accepted" | "rejected" {
    return this.bootStatus;
  }

  getConnectorStatus(connectorId: number): OcppConnectorStatusInfo | undefined {
    return this.connectors.get(connectorId);
  }

  listConnectorStatuses(): OcppConnectorStatusInfo[] {
    return Array.from(this.connectors.values());
  }

  /**
   * Records a new status for one connector and emits `connectorStatusChanged`
   * immediately (so a UI reflects it right away), then sends a `StatusNotification`
   * for it — once boot has been accepted; if boot hasn't completed yet, the change is
   * simply captured locally and flushed as part of the initial status sweep on acceptance.
   */
  setConnectorStatus(
    connectorId: number,
    status: OcppChargePointStatus,
    options: { errorCode?: OcppChargePointErrorCode; info?: string } = {},
  ): void {
    const existing = this.connectors.get(connectorId);
    if (!existing) {
      throw new Error(`Unknown connectorId ${connectorId}`);
    }

    const updated: OcppConnectorStatusInfo = {
      ...existing,
      status,
      errorCode: options.errorCode ?? "NoError",
      info: options.info,
      timestamp: new Date().toISOString(),
    };
    this.connectors.set(connectorId, updated);
    this.emit("connectorStatusChanged", updated);

    if (this.bootStatus === "accepted") {
      void this.sendStatusNotification(updated);
    }
  }

  /** Detaches from the client's lifecycle events and stops all timers. Does not disconnect the client. */
  dispose(): void {
    this.disposed = true;
    this.client.off("connected", this.handleClientConnected);
    this.client.off("disconnected", this.handleClientDisconnected);
    this.clearHeartbeat();
    this.clearBootRetry();
  }

  private handleClientConnected = (): void => {
    void this.sendBootNotification();
  };

  private handleClientDisconnected = (): void => {
    this.bootStatus = "unknown";
    this.clearHeartbeat();
    this.clearBootRetry();
  };

  private async sendBootNotification(): Promise<void> {
    const payload: Record<string, unknown> = {
      chargePointVendor: this.identity.chargePointVendor,
      chargePointModel: this.identity.chargePointModel,
    };
    if (this.identity.chargePointSerialNumber !== undefined) {
      payload.chargePointSerialNumber = this.identity.chargePointSerialNumber;
    }
    if (this.identity.chargeBoxSerialNumber !== undefined) {
      payload.chargeBoxSerialNumber = this.identity.chargeBoxSerialNumber;
    }
    if (this.identity.firmwareVersion !== undefined) {
      payload.firmwareVersion = this.identity.firmwareVersion;
    }
    if (this.identity.iccid !== undefined) {
      payload.iccid = this.identity.iccid;
    }
    if (this.identity.imsi !== undefined) {
      payload.imsi = this.identity.imsi;
    }
    if (this.identity.meterType !== undefined) {
      payload.meterType = this.identity.meterType;
    }
    if (this.identity.meterSerialNumber !== undefined) {
      payload.meterSerialNumber = this.identity.meterSerialNumber;
    }

    try {
      const response = await this.client.call("BootNotification", payload);
      this.handleBootResponse(response);
    } catch (err) {
      this.emit("error", toError(err));
      if (!this.disposed) {
        this.scheduleBootRetry(this.bootRetryFallbackMs);
      }
    }
  }

  private handleBootResponse(response: Record<string, unknown>): void {
    const status = response.status as OcppBootStatus;
    const intervalSec = Number(response.interval) || 0;
    const currentTime = String(response.currentTime ?? "");

    switch (status) {
      case "Accepted": {
        this.bootStatus = "accepted";
        this.clearBootRetry();
        this.startHeartbeat(intervalSec > 0 ? intervalSec : DEFAULT_HEARTBEAT_INTERVAL_SEC);
        this.emit("bootAccepted", { heartbeatIntervalSec: intervalSec, currentTime });
        this.flushConnectorStatuses();
        return;
      }
      case "Pending": {
        this.bootStatus = "pending";
        const retryInMs = intervalSec > 0 ? intervalSec * 1000 : this.bootRetryFallbackMs;
        this.emit("bootPending", { retryInMs });
        this.scheduleBootRetry(retryInMs);
        return;
      }
      case "Rejected": {
        this.bootStatus = "rejected";
        const retryInMs = intervalSec > 0 ? intervalSec * 1000 : this.bootRetryFallbackMs;
        this.emit("bootRejected", { retryInMs });
        this.scheduleBootRetry(retryInMs);
        return;
      }
      default: {
        this.emit("error", new Error(`Received BootNotification.conf with unknown status: ${String(status)}`));
        this.scheduleBootRetry(this.bootRetryFallbackMs);
      }
    }
  }

  private scheduleBootRetry(delayMs: number): void {
    this.clearBootRetry();
    this.bootRetryTimer = setTimeout(() => {
      this.bootRetryTimer = null;
      void this.sendBootNotification();
    }, delayMs);
  }

  private clearBootRetry(): void {
    if (this.bootRetryTimer) {
      clearTimeout(this.bootRetryTimer);
      this.bootRetryTimer = null;
    }
  }

  private startHeartbeat(intervalSec: number): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), intervalSec * 1000);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    try {
      const response = await this.client.call("Heartbeat", {});
      this.emit("heartbeat", { currentTime: String(response.currentTime ?? "") });
    } catch (err) {
      this.emit("error", toError(err));
    }
  }

  private flushConnectorStatuses(): void {
    for (const info of this.connectors.values()) {
      void this.sendStatusNotification(info);
    }
  }

  private async sendStatusNotification(info: OcppConnectorStatusInfo): Promise<void> {
    const payload: Record<string, unknown> = {
      connectorId: info.connectorId,
      status: info.status,
      errorCode: info.errorCode,
      timestamp: info.timestamp,
    };
    if (info.info !== undefined) {
      payload.info = info.info;
    }

    try {
      await this.client.call("StatusNotification", payload);
    } catch (err) {
      this.emit("error", toError(err));
    }
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
