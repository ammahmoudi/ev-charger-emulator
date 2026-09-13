import type { DeviceConnectionStatus } from "@prisma/client";

const STYLES: Record<DeviceConnectionStatus, string> = {
  DISCONNECTED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  CONNECTING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 animate-pulse",
  CONNECTED: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  FAULTED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const LABELS: Record<DeviceConnectionStatus, string> = {
  DISCONNECTED: "Disconnected",
  CONNECTING: "Connecting…",
  CONNECTED: "Connected",
  FAULTED: "Faulted",
};

export function StatusBadge({ status }: { status: DeviceConnectionStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${STYLES[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {LABELS[status]}
    </span>
  );
}
