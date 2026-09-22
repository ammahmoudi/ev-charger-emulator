import { OcppCallError } from "./errors";
import type { OcppClient } from "./client";

/** `FirmwareStatusNotification.req` `status` values, per the OCPP 1.6 spec (Core/1.6J, non-Security variant). */
export type OcppFirmwareStatus =
  | "Downloaded"
  | "DownloadFailed"
  | "Downloading"
  | "Idle"
  | "InstallationFailed"
  | "Installing"
  | "Installed";

export interface FirmwareHandlersDeps {
  /** Delay before a download reports `Downloaded`, in ms. Default: 2000. */
  downloadDelayMs?: number;
  /** Delay before an install reports `Installed`, in ms. Default: 2000. */
  installDelayMs?: number;
  onError?: (error: Error) => void;
}

export interface FirmwareHandlers {
  /** `UpdateFirmware.conf` is spec-defined as an empty payload; the real status flow is async via `FirmwareStatusNotification`. */
  handleUpdateFirmware(payload: Record<string, unknown>): Record<string, never>;
  /** Re-sends the last-known (or `Idle`, if no update has ever run) firmware status, for `TriggerMessage`. */
  triggerFirmwareStatusNotification(): Promise<void>;
  dispose(): void;
}

/**
 * Registers `UpdateFirmware` handling: schedules the update for `retrieveDate` (immediately if
 * already past), then reports `Downloading` → `Downloaded` → `Installing` → `Installed` via
 * `FirmwareStatusNotification`, mirroring the existing `GetDiagnostics`/
 * `DiagnosticsStatusNotification` simulation already used elsewhere in this module for a
 * fake-but-shape-correct async upload/update flow.
 */
export function createFirmwareHandlers(client: OcppClient, deps: FirmwareHandlersDeps = {}): FirmwareHandlers {
  const downloadDelayMs = deps.downloadDelayMs ?? 2_000;
  const installDelayMs = deps.installDelayMs ?? 2_000;
  const onError = deps.onError ?? (() => {});

  let currentStatus: OcppFirmwareStatus = "Idle";
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  async function sendStatus(status: OcppFirmwareStatus): Promise<void> {
    currentStatus = status;
    try {
      await client.call("FirmwareStatusNotification", { status });
    } catch (err) {
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function runUpdate(): Promise<void> {
    await sendStatus("Downloading");
    await new Promise((resolve) => setTimeout(resolve, downloadDelayMs));
    await sendStatus("Downloaded");
    await sendStatus("Installing");
    await new Promise((resolve) => setTimeout(resolve, installDelayMs));
    await sendStatus("Installed");
  }

  function handleUpdateFirmware(payload: Record<string, unknown>): Record<string, never> {
    const { location, retrieveDate } = payload;
    if (typeof location !== "string" || location.length === 0) {
      throw new OcppCallError("PropertyConstraintViolation", "location is required");
    }
    const retrieveMs = typeof retrieveDate === "string" ? Date.parse(retrieveDate) : NaN;
    if (Number.isNaN(retrieveMs)) {
      throw new OcppCallError("PropertyConstraintViolation", "retrieveDate must be a valid ISO 8601 timestamp");
    }

    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      void runUpdate();
    }, Math.max(0, retrieveMs - Date.now()));
    return {};
  }

  return {
    handleUpdateFirmware,
    triggerFirmwareStatusNotification: () => sendStatus(currentStatus),
    dispose: () => {
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = null;
    },
  };
}
