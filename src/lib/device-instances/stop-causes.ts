/**
 * Stop-cause vocabulary shared between server (validation/cost logic) and client (UI dropdowns).
 * Kept dependency-free (no Prisma import) so it can be imported from client components.
 */

/** Normal (non-fault) stop causes a locally-simulated session can be stopped with. */
export const NORMAL_STOP_CAUSES = ["Manu. Stop", "Remote Stop", "EV Disconnected", "UnlockConnector"] as const;

/**
 * Device-surfaced internal fault codes seen on the real PEVC3107E's Cost screen — modeled as
 * free text (not a closed enum) per issue #14, but offered as quick-pick options in the UI.
 */
export const FAULT_STOP_CAUSES = ["QF Err", "KM Err", "Ins Err"] as const;

export const STOP_CAUSE_OPTIONS: string[] = [...NORMAL_STOP_CAUSES, ...FAULT_STOP_CAUSES];

export function isFaultStopCause(stopCause: string): boolean {
  return (FAULT_STOP_CAUSES as readonly string[]).includes(stopCause);
}

/** OCPP 1.6 wire values. Device display labels must never be sent as reason enums. */
export const OCPP16_STOP_REASONS = [
  "EmergencyStop", "EVDisconnected", "HardReset", "Local", "Other", "PowerLoss",
  "Reboot", "Remote", "SoftReset", "UnlockCommand", "DeAuthorized",
] as const;

export function toOcpp16StopReason(cause: string): (typeof OCPP16_STOP_REASONS)[number] {
  switch (cause) {
    case "Manu. Stop": return "Local";
    case "Remote Stop": return "Remote";
    case "EV Disconnected": return "EVDisconnected";
    case "UnlockConnector": return "UnlockCommand";
    default:
      return OCPP16_STOP_REASONS.find((reason) => reason === cause) ?? "Other";
  }
}

/** Repair retained display labels without changing the actual stop's meter, time or identity. */
export function normalizeOcpp16StopPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return typeof payload.reason === "string"
    ? { ...payload, reason: toOcpp16StopReason(payload.reason) }
    : payload;
}
