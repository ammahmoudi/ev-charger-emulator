"use client";

/**
 * A visual companion to `DeviceScreenFrame`'s per-connector EV plug/unplug control (see
 * `ConnectorChargeCard`): renders outside the device bezel, one car per connector, so someone
 * demoing the emulator can tell at a glance whether a car is "parked" at each plug without reading
 * the phone-sized screen's text. Purely a view over the same `evConnected`/status data the Home
 * screen already polls — clicking a car calls the same connect/disconnect handler, so there's one
 * source of truth, not a second one to keep in sync.
 */

function CarGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" fill="none" className={className}>
      <path
        d="M8 28 L11 16 Q13 12 18 12 H40 Q45 12 47 16 L52 22 H56 Q59 22 59 25 V28 Q59 30 57 30 H7 Q5 30 5 28 V28 Q5 28 8 28 Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path d="M17 15 L14.5 22 H31 V15 Z" fill="white" className="dark:fill-zinc-900" opacity="0.85" />
      <path d="M33 15 V22 H45.5 L41.5 15 Z" fill="white" className="dark:fill-zinc-900" opacity="0.85" />
      <circle cx="17" cy="30" r="5" fill="currentColor" />
      <circle cx="17" cy="30" r="2" fill="white" className="dark:fill-zinc-900" />
      <circle cx="47" cy="30" r="5" fill="currentColor" />
      <circle cx="47" cy="30" r="2" fill="white" className="dark:fill-zinc-900" />
    </svg>
  );
}

export interface CarSimulatorConnector {
  connectorId: number;
  label: string;
  evConnected: boolean;
  isCharging: boolean;
}

export function CarSimulatorPanel({
  connectors,
  pendingConnectorId,
  onToggle,
}: {
  connectors: CarSimulatorConnector[];
  pendingConnectorId: number | null;
  onToggle: (connectorId: number, connected: boolean) => void;
}) {
  if (connectors.length === 0) return null;

  return (
    <div className="mx-auto grid w-full max-w-[1072px] grid-cols-1 gap-3 px-1 sm:grid-cols-2">
      {connectors.map((connector) => {
        const pending = pendingConnectorId === connector.connectorId;
        return (
          <button
            key={connector.connectorId}
            type="button"
            disabled={pending}
            onClick={() => onToggle(connector.connectorId, !connector.evConnected)}
            className="flex items-center gap-3 rounded-xl border border-dashed border-zinc-300 bg-white/60 px-4 py-3 text-left transition disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900/40"
          >
            {/* The "cable" — a line from the connector's edge to the car, solid+colored only once a car is actually there. */}
            <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full border border-zinc-300 text-xs font-bold text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
              {connector.label.trim().slice(-1).toUpperCase() || connector.connectorId}
            </div>
            <div
              className={`h-0.5 flex-1 ${
                connector.evConnected
                  ? connector.isCharging
                    ? "animate-pulse bg-emerald-400"
                    : "bg-sky-400"
                  : "border-t border-dashed border-zinc-300 dark:border-zinc-700"
              }`}
            />
            <CarGlyph
              className={`h-8 w-14 flex-none ${
                connector.evConnected
                  ? connector.isCharging
                    ? "text-emerald-500"
                    : "text-sky-500"
                  : "text-zinc-300 dark:text-zinc-700"
              }`}
            />
            <span className="flex-1 text-xs text-zinc-500 dark:text-zinc-400">
              {connector.evConnected
                ? connector.isCharging
                  ? "Charging"
                  : "Parked & plugged in — tap to unplug"
                : "No car — tap to plug one in"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
