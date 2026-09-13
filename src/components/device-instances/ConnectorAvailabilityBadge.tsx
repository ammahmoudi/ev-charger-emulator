/**
 * Connector status is a free-text string (`DeviceInstanceConnectorState.status`, issue #14),
 * not a closed enum — mirrors the known values used across the app (Available/Charging/Faulted
 * from connector-sessions.ts, Unavailable from the Maintenance tab's firmware-upgrade action)
 * and falls back to a neutral style for anything else.
 */
const STYLES: Record<string, string> = {
  Available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  Charging: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  Faulted: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  Unavailable: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 animate-pulse",
};

const DEFAULT_STYLE = "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";

export function ConnectorAvailabilityBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status] ?? DEFAULT_STYLE}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}
