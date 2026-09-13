/**
 * Types for local charging-session simulation, layered on top of `OcppClient` and
 * `OcppChargePointSession`. See `./charging-session.ts`.
 */

/** OCPP 1.6 `StopTransaction.req` `reason` values relevant to a locally-simulated session. */
export type SimulatedStopReason = "Local" | "EVDisconnected" | "Other";

/** Lifecycle state of one simulated charging session on a connector. */
export type ChargingSessionState =
  | "idle"
  | "authorizing"
  | "starting"
  | "charging"
  | "stopping"
  | "stopped"
  | "authorizationDenied";

/**
 * Config for one simulated plug-in, supplied by the caller (a device instance's own
 * connector config, once issue #3 lands) rather than looked up from Prisma here — this
 * module has no knowledge of `DeviceInstance`.
 */
export interface SimulatedChargingSessionConfig {
  /** OCPP `connectorId` this session runs on; must be a connector known to the `OcppChargePointSession`. */
  connectorId: number;
  /** `idTag` sent with `Authorize`/`StartTransaction`/`StopTransaction` — no real RFID/auth backend. */
  idTag: string;
  /** Simulated constant charge rate in kW, used to derive the energy delivery curve. Must be > 0. */
  chargeRateKw: number;
  /** Interval (ms) between simulated `MeterValues` while charging. Default: 30000. */
  meterValueIntervalMs?: number;
  /** Starting meter reading in Wh (e.g. a connector's persisted energy register). Default: 0. */
  meterStartWh?: number;
}

export type SimulatedChargingSessionEvents = {
  /** The session's lifecycle state changed. */
  stateChanged: [state: ChargingSessionState];
  /** A simulated `MeterValues` was sent; `energyWh` is the cumulative energy register value. */
  meterValue: [payload: { energyWh: number; timestamp: string }];
  /** `StartTransaction.conf` was accepted and a transaction is now in progress. */
  transactionStarted: [payload: { transactionId: number; meterStartWh: number }];
  /** `StopTransaction` was sent (successfully or not) and the session has ended. */
  transactionStopped: [
    payload: { transactionId: number; meterStopWh: number; reason: SimulatedStopReason },
  ];
  /** `Authorize` was rejected by the CSMS; no transaction was started. */
  authorizationDenied: [payload: { idTagStatus: string }];
  /** An Authorize/StartTransaction/MeterValues/StopTransaction call failed (transport error, timeout, CALLERROR, ...). */
  error: [error: Error];
};
