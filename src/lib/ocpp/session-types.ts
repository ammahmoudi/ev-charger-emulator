/**
 * Types for the OCPP 1.6 boot/connectivity lifecycle layered on top of {@link OcppClient}
 * (BootNotification, Heartbeat, StatusNotification). See `./session.ts`.
 */

/** `BootNotification.conf` status values, per the OCPP 1.6 spec. */
export type OcppBootStatus = "Accepted" | "Pending" | "Rejected";

/** `StatusNotification.req` `status` values, per the OCPP 1.6 `ChargePointStatus` enum. */
export type OcppChargePointStatus =
  | "Available"
  | "Preparing"
  | "Charging"
  | "SuspendedEVSE"
  | "SuspendedEV"
  | "Finishing"
  | "Reserved"
  | "Unavailable"
  | "Faulted";

/** `StatusNotification.req` `errorCode` values, per the OCPP 1.6 `ChargePointErrorCode` enum. */
export type OcppChargePointErrorCode =
  | "ConnectorLockFailure"
  | "EVCommunicationError"
  | "GroundFailure"
  | "HighTemperature"
  | "InternalError"
  | "LocalListConflict"
  | "NoError"
  | "OtherError"
  | "OverCurrentFailure"
  | "PowerMeterFailure"
  | "PowerSwitchFailure"
  | "ReaderFailure"
  | "ResetFailure"
  | "UnderVoltage"
  | "OverVoltage"
  | "WeakSignal";

/**
 * Identity fields sent in `BootNotification.req`. Callers (a device instance wired to a
 * `DeviceModel`) supply these — this module has no knowledge of any specific charger model.
 */
export interface OcppChargePointIdentity {
  chargePointVendor: string;
  chargePointModel: string;
  chargePointSerialNumber?: string;
  chargeBoxSerialNumber?: string;
  firmwareVersion?: string;
  iccid?: string;
  imsi?: string;
  meterType?: string;
  meterSerialNumber?: string;
}

/** One physical connector this session reports `StatusNotification`s for. */
export interface OcppConnectorConfig {
  /** OCPP `connectorId` (1-based). */
  connectorId: number;
  /** Human label, e.g. "Plug A" — for UI/logging only, never sent over OCPP. */
  label?: string;
  /** Status to report once boot is accepted, before any explicit status change. Default: "Available". */
  initialStatus?: OcppChargePointStatus;
}

export interface OcppChargePointSessionOptions {
  identity: OcppChargePointIdentity;
  connectors: OcppConnectorConfig[];
  /**
   * Retry delay (ms) used to resend `BootNotification` after a `Pending`/`Rejected`
   * response or a transport failure, when the CSMS didn't return a usable interval.
   * Default: 30000.
   */
  bootRetryFallbackMs?: number;
}

/** Current, locally-tracked status of one connector. */
export interface OcppConnectorStatusInfo {
  connectorId: number;
  label?: string;
  status: OcppChargePointStatus;
  errorCode: OcppChargePointErrorCode;
  info?: string;
  /** ISO 8601 timestamp of the last local status change. */
  timestamp: string;
}

export type OcppChargePointSessionEvents = {
  /** `BootNotification.conf` returned `Accepted`; heartbeats now start on `heartbeatIntervalSec`. */
  bootAccepted: [payload: { heartbeatIntervalSec: number; currentTime: string }];
  /** `BootNotification.conf` returned `Pending`; will retry in `retryInMs`. */
  bootPending: [payload: { retryInMs: number }];
  /** `BootNotification.conf` returned `Rejected`; will retry in `retryInMs`. */
  bootRejected: [payload: { retryInMs: number }];
  /** A `Heartbeat.conf` was received. */
  heartbeat: [payload: { currentTime: string }];
  /** A connector's locally-tracked status changed (fires before the `StatusNotification` send settles). */
  connectorStatusChanged: [info: OcppConnectorStatusInfo];
  /** A BootNotification/Heartbeat/StatusNotification call failed (transport error, timeout, CALLERROR, ...). */
  error: [error: Error];
};
