"use client";

import type { ConnectorType } from "@prisma/client";

const WH_PER_KWH = 1000;
const MS_PER_HOUR = 3_600_000;

export interface ChargeCardConnector {
  connectorId: number;
  label: string;
  connectorType: ConnectorType;
  maxPowerKw: number | null;
}

export interface ChargeCardRuntime {
  status: string;
  locked: boolean;
  evConnected: boolean;
  activeSession: {
    idTag: string;
    startedAt: string;
    chargeRateKw: number;
    currentEnergyWh: number;
  } | null;
}

function badgeLetter(label: string, connectorId: number): string {
  const trimmed = label.trim();
  return trimmed ? trimmed[trimmed.length - 1].toUpperCase() : String(connectorId);
}

function liveEnergyWh(startedAt: string, chargeRateKw: number, now: Date): number {
  const elapsedMs = Math.max(0, now.getTime() - new Date(startedAt).getTime());
  return (chargeRateKw * WH_PER_KWH * elapsedMs) / MS_PER_HOUR;
}

function formatElapsed(startedAt: string, now: Date): string {
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Generic connector glyph — deliberately not connector-type-specific, matching all
 * `ConnectorType` values. Loosely mirrors the real device's CCS2 socket icon (a ring of pins
 * above two DC-pin tabs — see docs/device-reference/PEVC3107E/screenshots/01-home-dual-plug.png):
 * a tight cluster of pins, no other decoration. An earlier version added a curved "smile" line
 * beneath the pin cluster that isn't part of the real icon and made this read as a cartoon face
 * rather than a connector — removed here.
 */
function ConnectorGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <circle cx="32" cy="24" r="15" />
      <circle cx="32" cy="16" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="39" cy="20" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="36" cy="28" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="28" cy="28" r="2.5" fill="currentColor" stroke="none" />
      <circle cx="25" cy="20" r="2.5" fill="currentColor" stroke="none" />
      <rect x="23" y="42" width="7" height="11" rx="2" />
      <rect x="34" y="42" width="7" height="11" rx="2" />
    </svg>
  );
}

/**
 * Per-connector charging status card — the Home screen's core UI element, mirroring
 * the real device's Plug A/B cards: connector type, idle prompt or live charging readout, and a
 * Charging/Stop button. Backed by `connector-sessions.ts`'s DB-persisted session state, the
 * module actually wired into the live instance runtime — see runtime.ts.
 */
export function ConnectorChargeCard({
  connector,
  runtime,
  now,
  pending,
  evPending,
  error,
  onStartCharging,
  onStopCharging,
  onClearFault,
  onToggleEv,
}: {
  connector: ChargeCardConnector;
  runtime: ChargeCardRuntime | null;
  now: Date;
  pending: boolean;
  /** Separate pending flag for the EV plug/unplug control below, so toggling it doesn't read as the Charging/Stop button being busy (and vice versa). */
  evPending: boolean;
  error: string | null;
  onStartCharging: () => void;
  onStopCharging: () => void;
  onClearFault: () => void;
  onToggleEv: () => void;
}) {
  const status = runtime?.status ?? "Available";
  const session = runtime?.activeSession ?? null;
  const evConnected = runtime?.evConnected ?? false;
  const isPreparing = status === "Preparing" && session !== null;
  const isCharging = status === "Charging" && session !== null;
  const isFaulted = status === "Faulted";

  return (
    <div className="flex flex-1 flex-col gap-3 rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
      <div className="flex items-start justify-between">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-200 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
          {badgeLetter(connector.label, connector.connectorId)}
        </span>
        <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{connector.connectorType}</span>
      </div>

      <ConnectorGlyph
        className={`mx-auto h-16 w-16 ${
          isCharging
            ? "text-emerald-500"
            : isPreparing
              ? "text-amber-500 animate-pulse"
              : isFaulted
                ? "text-red-400"
                : evConnected
                  ? "text-sky-400"
                  : "text-zinc-300 dark:text-zinc-700"
        }`}
      />

      {isPreparing && session ? (
        <div className="flex flex-col items-center gap-1 text-center text-sm">
          <p className="font-medium text-amber-600 dark:text-amber-400">Preparing — authorizing card {session.idTag}…</p>
          <p className="font-mono text-xs text-zinc-500">{formatElapsed(session.startedAt, now)}</p>
        </div>
      ) : isCharging && session ? (
        <div className="flex flex-col items-center gap-1 text-center text-sm">
          <p className="font-medium text-emerald-600 dark:text-emerald-400">Charging — card {session.idTag}</p>
          <p className="font-mono text-xs text-zinc-500">{formatElapsed(session.startedAt, now)}</p>
          <p className="text-zinc-700 dark:text-zinc-300">
            {(liveEnergyWh(session.startedAt, session.chargeRateKw, now) / WH_PER_KWH).toFixed(3)} kWh
            <span className="text-zinc-400"> · {session.chargeRateKw} kW</span>
          </p>
        </div>
      ) : isFaulted ? (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          Connector fault — clear it below or from the Lock screen.
        </p>
      ) : (
        <p className="text-center text-sm text-zinc-500 dark:text-zinc-400">
          {evConnected ? "EV connected — click Charging to start." : "Please connect the EV or click charging button."}
        </p>
      )}

      {error ? <p className="text-center text-xs text-red-600 dark:text-red-400">{error}</p> : null}

      {isFaulted ? (
        <button
          type="button"
          disabled={pending}
          onClick={onClearFault}
          className="w-full rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Clear fault
        </button>
      ) : isPreparing ? (
        <button
          type="button"
          disabled={pending}
          onClick={onStopCharging}
          className="w-full rounded-md border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-900 dark:text-amber-400 dark:hover:bg-amber-950"
        >
          Cancel
        </button>
      ) : isCharging ? (
        <button
          type="button"
          disabled={pending}
          onClick={onStopCharging}
          className="w-full rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-900 disabled:opacity-50 dark:bg-zinc-200 dark:text-black dark:hover:bg-white"
        >
          Stop
        </button>
      ) : (
        <button
          type="button"
          disabled={pending || status !== "Available" || !evConnected}
          onClick={onStartCharging}
          className="w-full rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Charging
        </button>
      )}

      {/*
       * EV plug/unplug — the physical cable/car, independent of the Charging/Stop button above
       * (which represents authorization). Always shown, regardless of session state: unplugging
       * while Preparing or Charging force-stops the session (stopCause "EV Disconnected"),
       * mirroring a real cable pull, so this control stays the one place that always reflects
       * (and controls) whether a car is actually there.
       */}
      <button
        type="button"
        disabled={evPending}
        onClick={onToggleEv}
        className={`w-full rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-50 ${
          evConnected
            ? "border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
            : "border-sky-300 text-sky-700 hover:bg-sky-50 dark:border-sky-900 dark:text-sky-400 dark:hover:bg-sky-950"
        }`}
      >
        {evConnected ? (isCharging || isPreparing ? "Unplug EV (stops session)" : "Unplug EV") : "Plug in EV"}
      </button>
    </div>
  );
}
