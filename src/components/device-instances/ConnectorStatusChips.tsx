import type { OcppChargePointStatus } from "@/lib/ocpp";
import type { DeviceInstanceConnectorView } from "@/lib/device-instances/types";

const STYLES: Record<OcppChargePointStatus, string> = {
  Available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  Preparing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  Charging: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  SuspendedEVSE: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  SuspendedEV: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  Finishing: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  Reserved: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-400",
  Unavailable: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  Faulted: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

const UNKNOWN_STYLE = "bg-zinc-50 text-zinc-400 dark:bg-zinc-900 dark:text-zinc-600";

/** Renders one badge per connector: its label plus live status (or "Not started" before the instance has ever run). */
export function ConnectorStatusChips({ connectors }: { connectors: DeviceInstanceConnectorView[] }) {
  if (connectors.length === 0) {
    return <span className="text-xs text-zinc-400">No connectors</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {connectors.map((connector) => (
        <span
          key={connector.connectorId}
          title={connector.errorCode && connector.errorCode !== "NoError" ? connector.errorCode : undefined}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            connector.status ? STYLES[connector.status] : UNKNOWN_STYLE
          }`}
        >
          {connector.label}: {connector.status ?? "Not started"}
        </span>
      ))}
    </div>
  );
}
