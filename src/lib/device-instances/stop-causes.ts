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
