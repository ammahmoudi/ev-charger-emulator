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

export interface RemoteCommandHandlersDeps {
  /** Backing store for `GetConfiguration`/`ChangeConfiguration`. Default: a small in-memory store. */
  configStore?: OcppConfigurationStore;
  /** Delay before reconnecting after a `Reset`, to simulate a reboot cycle, in ms. Default: 500. */
  resetReconnectDelayMs?: number;
  /** Delay before a `GetDiagnostics` upload reports `Uploaded`, in ms. Default: 2000. */
  diagnosticsUploadDelayMs?: number;
  /** Called when a fire-and-forget follow-up action (e.g. sending `StartTransaction`) fails. */
  onError?: (error: Error) => void;
}

/** Handle returned by {@link registerRemoteCommandHandlers} for introspection and teardown. */
export interface RemoteCommandHandlers {
  /** The transaction currently tracked as active on a connector, if any. */
  getActiveTransaction(connectorId: number): OcppActiveTransaction | undefined;
  listActiveTransactions(): OcppActiveTransaction[];
  /** Unregisters all handlers this module registered on the client. */
  dispose(): void;
}
