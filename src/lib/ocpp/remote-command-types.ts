/**
 * Types for CSMS-initiated (remote) OCPP 1.6 command handling, layered on top of
 * {@link OcppClient} and {@link OcppChargePointSession}. See `./remote-commands.ts`.
 */

/** One configuration key/value pair, as reported by `GetConfiguration.conf`. */
export interface OcppConfigurationEntry {
  key: string;
  readonly: boolean;
  value: string;
}

/**
 * A generic key/value configuration store for `GetConfiguration`/`ChangeConfiguration`.
 *
 * Deliberately storage-agnostic and async — callers can inject any implementation (in-memory,
 * Prisma-backed, ...) that satisfies this shape. `OcppClient`'s handler dispatch already awaits
 * handler results (see `client.ts`'s `handleIncomingCall`), so a Prisma-backed store can persist
 * `ChangeConfiguration` writes directly, e.g. into the same `DeviceInstanceParameter` rows the
 * Settings screen reads (see `PrismaConfigurationStore` in `src/lib/device-instances`).
 */
export interface OcppConfigurationStore {
  /**
   * Looks up the given keys (or every known key, if omitted).
   * `unknown` lists any requested keys this store has no entry for.
   */
  list(keys?: string[]): Promise<{ known: OcppConfigurationEntry[]; unknown: string[] }>;
  /** Applies a `ChangeConfiguration` request. */
  set(key: string, value: string): Promise<OcppChangeConfigurationStatus>;
}

export type OcppChangeConfigurationStatus = "Accepted" | "Rejected" | "NotSupported";

/** One connector's currently tracked remote-command state. */
export interface OcppActiveTransaction {
  connectorId: number;
  transactionId: number;
  idTag: string;
}

/** One tracked `ReserveNow` reservation. See `./reservation.ts`. */
export interface OcppReservation {
  reservationId: number;
  connectorId: number;
  idTag: string;
  parentIdTag?: string;
  expiryDate: string;
}

export type OcppReserveNowStatus = "Accepted" | "Faulted" | "Occupied" | "Rejected" | "Unavailable";
export type OcppCancelReservationStatus = "Accepted" | "Rejected";

/** One stored `SetChargingProfile` profile. See `./charging-profile.ts`. */
export interface OcppChargingProfileEntry {
  connectorId: number;
  profile: Record<string, unknown>;
}

export type OcppSetChargingProfileStatus = "Accepted" | "Rejected" | "NotSupported";
export type OcppClearChargingProfileStatus = "Accepted" | "Unknown";

export type OcppDataTransferStatus = "Accepted" | "Rejected" | "UnknownMessageId" | "UnknownVendorId";

/** A vendor-specific `DataTransfer` handler, keyed by `vendorId` in `RemoteCommandHandlersDeps`. */
export type OcppDataTransferHandler = (
  messageId: string | undefined,
  data: string | undefined,
) =>
  | { status: OcppDataTransferStatus; data?: string }
  | Promise<{ status: OcppDataTransferStatus; data?: string }>;

export type OcppIdTagStatus = "Accepted" | "Blocked" | "Expired" | "Invalid" | "ConcurrentTx";

export interface OcppIdTagInfo {
  status: OcppIdTagStatus;
  expiryDate?: string;
  parentIdTag?: string;
}

/** One entry of the Local Authorization List. See `./local-list.ts`. */
export interface OcppLocalListEntry {
  idTag: string;
  idTagInfo: OcppIdTagInfo;
}

export type OcppSendLocalListStatus = "Accepted" | "Failed" | "NotSupported" | "VersionMismatch";

export interface RemoteCommandHandlersDeps {
  /** Backing store for `GetConfiguration`/`ChangeConfiguration`. Default: a small in-memory store. */
  configStore?: OcppConfigurationStore;
  /** Delay before reconnecting after a `Reset`, to simulate a reboot cycle, in ms. Default: 500. */
  resetReconnectDelayMs?: number;
  /** Delay before a `GetDiagnostics` upload reports `Uploaded`, in ms. Default: 2000. */
  diagnosticsUploadDelayMs?: number;
  /** Delay before an `UpdateFirmware` download reports `Downloaded`, in ms. Default: 2000. */
  firmwareDownloadDelayMs?: number;
  /** Delay before an `UpdateFirmware` install reports `Installed`, in ms. Default: 2000. */
  firmwareInstallDelayMs?: number;
  /**
   * Simulated charge rate (kW) used to derive `MeterValues`/`meterStart`/`meterStop` when the
   * `evChargerRatedPowerKw` configuration key isn't present in `configStore`. Default: 30.
   */
  simulatedChargeRateKw?: number;
  /** Vendor-specific `DataTransfer` handlers, keyed by `vendorId`. Default: none (always `UnknownVendorId`). */
  dataTransferHandlers?: Record<string, OcppDataTransferHandler>;
  /** Called when a fire-and-forget follow-up action (e.g. sending `StartTransaction`) fails. */
  onError?: (error: Error) => void;
  /**
   * Called once a CSMS-initiated `RemoteStartTransaction` has actually started (the real
   * `StartTransaction.conf` came back `Accepted`) — lets a caller (e.g.
   * `device-instances/runtime.ts`) mirror it into its own persisted connector state
   * (`connector-sessions.ts`'s `adoptRemoteSession`), so screens that read that persisted state
   * (Home/Cost/Lock/Maintenance) reflect a remote-started session instead of only the in-memory
   * `OcppChargePointSession` status the dashboard reads. Deliberately kept as an injected
   * callback rather than an import so `src/lib/ocpp` stays independent of `device-instances`'
   * Prisma-backed persistence — see AUDIT-integration.md. Thrown/rejected errors are caught and
   * passed to `onError`, not rethrown.
   */
  onRemoteTransactionStarted?: (
    connectorId: number,
    info: { idTag: string; transactionId: number; chargeRateKw: number },
  ) => void | Promise<void>;
  /**
   * Called once a remote-tracked transaction has actually stopped (via `RemoteStopTransaction`
   * or a `Reset`) and its `StopTransaction` has already been sent to the CSMS — the counterpart
   * to {@link onRemoteTransactionStarted}. `meterStopWh` is this module's own simulated final
   * energy register, passed through so the mirrored persisted session records the same energy
   * figure that was actually reported to the CSMS rather than an independently-simulated one.
   */
  onRemoteTransactionStopped?: (
    connectorId: number,
    info: { transactionId: number; reason: string; meterStopWh: number },
  ) => void | Promise<void>;
}

/** Handle returned by {@link registerRemoteCommandHandlers} for introspection and teardown. */
export interface RemoteCommandHandlers {
  /** The transaction currently tracked as active on a connector, if any. */
  getActiveTransaction(connectorId: number): OcppActiveTransaction | undefined;
  listActiveTransactions(): OcppActiveTransaction[];
  /** Reservations currently tracked (not yet expired/cancelled). */
  listReservations(): OcppReservation[];
  /** Stored `SetChargingProfile` profiles, optionally filtered to one connector (0 = charge-point-wide). */
  listChargingProfiles(connectorId?: number): OcppChargingProfileEntry[];
  /** Current Local Authorization List version (0 if never set via `SendLocalList`). */
  getLocalAuthListVersion(): number;
  listLocalAuthListEntries(): OcppLocalListEntry[];
  /** Unregisters all handlers this module registered on the client. */
  dispose(): void;
}
