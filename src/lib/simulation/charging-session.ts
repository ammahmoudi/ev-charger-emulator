import type { OcppClient } from "../ocpp/client";
import type { OcppChargePointSession } from "../ocpp/session";
import { TypedEventEmitter } from "../ocpp/typed-event-emitter";
import type {
  ChargingSessionState,
  SimulatedChargingSessionConfig,
  SimulatedChargingSessionEvents,
  SimulatedStopReason,
} from "./charging-session-types";

const DEFAULT_METER_VALUE_INTERVAL_MS = 30_000;
const WH_PER_KWH = 1000;
const MS_PER_HOUR = 3_600_000;

/** Rounds to 2 decimal places — whole-Wh rounding would floor short/low-rate ticks to 0. */
function roundWh(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Simulates an EV plugging into a connector and a charging session progressing,
 * independent of remote commands — driven from the emulator's own UI/API (issue #9).
 *
 * Composes an `OcppChargePointSession` (for connector `StatusNotification` transitions)
 * with the underlying `OcppClient` (for `Authorize`/`StartTransaction`/`MeterValues`/
 * `StopTransaction` calls, which the boot/connectivity session layer doesn't implement)
 * to run a full OCPP 1.6 transaction lifecycle against a CSMS with realistic, increasing
 * meter values.
 *
 * Takes a plain config object — not a Prisma `DeviceInstance` (issue #3 isn't merged
 * yet) — so it can be wired to real instance data later without rework.
 */
export class SimulatedChargingSession extends TypedEventEmitter<SimulatedChargingSessionEvents> {
  private readonly config: Required<SimulatedChargingSessionConfig>;

  private state: ChargingSessionState = "idle";
  private transactionId: number | null = null;
  private currentEnergyWh = 0;
  private meterTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: OcppClient,
    private readonly chargePointSession: OcppChargePointSession,
    config: SimulatedChargingSessionConfig,
  ) {
    super();
    if (config.chargeRateKw <= 0) {
      throw new Error(`chargeRateKw must be > 0, got ${config.chargeRateKw}`);
    }
    this.config = {
      connectorId: config.connectorId,
      idTag: config.idTag,
      chargeRateKw: config.chargeRateKw,
      meterValueIntervalMs: config.meterValueIntervalMs ?? DEFAULT_METER_VALUE_INTERVAL_MS,
      meterStartWh: config.meterStartWh ?? 0,
    };
  }

  getState(): ChargingSessionState {
    return this.state;
  }

  getTransactionId(): number | null {
    return this.transactionId;
  }

  getCurrentEnergyWh(): number {
    return this.currentEnergyWh;
  }

  /**
   * Simulates an EV plugging into the connector: sets it to `Preparing`, sends
   * `Authorize`, and — if accepted — sends `StartTransaction` and begins the periodic
   * `MeterValues` loop. Resolves once the handshake settles (accepted, denied, or
   * failed); transport/CALLERROR failures are reported via the `error` event rather
   * than a rejection, matching `OcppChargePointSession`'s style.
   */
  async plugIn(): Promise<void> {
    if (this.state !== "idle" && this.state !== "stopped" && this.state !== "authorizationDenied") {
      throw new Error(`Cannot plug in while session is in state '${this.state}'`);
    }

    this.setState("authorizing");
    this.chargePointSession.setConnectorStatus(this.config.connectorId, "Preparing");

    try {
      const authResponse = await this.client.call("Authorize", { idTag: this.config.idTag });
      const idTagInfo = authResponse.idTagInfo as { status?: string } | undefined;
      const idTagStatus = idTagInfo?.status ?? "Invalid";

      if (idTagStatus !== "Accepted") {
        this.setState("authorizationDenied");
        this.chargePointSession.setConnectorStatus(this.config.connectorId, "Available");
        this.emit("authorizationDenied", { idTagStatus });
        return;
      }

      this.setState("starting");
      this.currentEnergyWh = this.config.meterStartWh;

      const startResponse = await this.client.call("StartTransaction", {
        connectorId: this.config.connectorId,
        idTag: this.config.idTag,
        meterStart: roundWh(this.currentEnergyWh),
        timestamp: new Date().toISOString(),
      });

      const transactionId = Number(startResponse.transactionId);
      this.transactionId = transactionId;

      this.setState("charging");
      this.chargePointSession.setConnectorStatus(this.config.connectorId, "Charging");
      this.emit("transactionStarted", { transactionId, meterStartWh: this.currentEnergyWh });
      this.startMeterValueLoop();
    } catch (err) {
      this.setState("idle");
      this.chargePointSession.setConnectorStatus(this.config.connectorId, "Available");
      this.emit("error", toError(err));
    }
  }

  /**
   * Ends the current transaction and sends a final `MeterValues` plus `StopTransaction`
   * with the accumulated energy. `reason: "EVDisconnected"` (simulated unplug) sends the
   * connector straight back to `Available`; any other reason (e.g. `"Local"`, a manual
   * stop) leaves it at `Finishing`, since the EV is still simulated as plugged in.
   */
  async stop(reason: SimulatedStopReason = "Local"): Promise<void> {
    if (this.state !== "charging") {
      throw new Error(`Cannot stop while session is in state '${this.state}'`);
    }
    const transactionId = this.transactionId;
    if (transactionId === null) {
      throw new Error("Cannot stop: no active transaction id");
    }

    this.stopMeterValueLoop();
    this.setState("stopping");

    try {
      await this.client.call("StopTransaction", {
        transactionId,
        idTag: this.config.idTag,
        meterStop: roundWh(this.currentEnergyWh),
        timestamp: new Date().toISOString(),
        reason,
      });
    } catch (err) {
      this.emit("error", toError(err));
    }

    this.chargePointSession.setConnectorStatus(
      this.config.connectorId,
      reason === "EVDisconnected" ? "Available" : "Finishing",
    );
    this.setState("stopped");
    this.emit("transactionStopped", { transactionId, meterStopWh: this.currentEnergyWh, reason });
    this.transactionId = null;
  }

  /** Stops the meter-value loop, if running. Does not send `StopTransaction` — call `stop()` first for a clean end. */
  dispose(): void {
    this.stopMeterValueLoop();
  }

  private startMeterValueLoop(): void {
    this.stopMeterValueLoop();
    this.meterTimer = setInterval(() => void this.sendMeterValue(), this.config.meterValueIntervalMs);
  }

  private stopMeterValueLoop(): void {
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
  }

  private async sendMeterValue(): Promise<void> {
    const incrementWh =
      (this.config.chargeRateKw * WH_PER_KWH * this.config.meterValueIntervalMs) / MS_PER_HOUR;
    this.currentEnergyWh += incrementWh;
    const timestamp = new Date().toISOString();
    const energyWh = roundWh(this.currentEnergyWh);

    try {
      await this.client.call("MeterValues", {
        connectorId: this.config.connectorId,
        transactionId: this.transactionId,
        meterValue: [
          {
            timestamp,
            sampledValue: [
              { value: String(energyWh), measurand: "Energy.Active.Import.Register", unit: "Wh" },
            ],
          },
        ],
      });
      this.emit("meterValue", { energyWh, timestamp });
    } catch (err) {
      this.emit("error", toError(err));
    }
  }

  private setState(state: ChargingSessionState): void {
    this.state = state;
    this.emit("stateChanged", state);
  }
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
