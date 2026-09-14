"use client";

import Link from "next/link";
import type { DeviceConnectionStatus } from "@prisma/client";

function formatClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const CONNECTION_ICON_STYLES: Record<DeviceConnectionStatus, string> = {
  DISCONNECTED: "text-white/50",
  CONNECTING: "text-white/80 animate-pulse",
  CONNECTED: "text-white",
  FAULTED: "text-red-300",
};

/**
 * Blue top bar matching the real device's Home screen — home icon, instance name, serial
 * number, live clock, and (deviating from the real device, which shows a passive signal-strength
 * glyph here) a clickable connection toggle plus a link into the status/diagnostics overlay,
 * which the real device reaches from Home rather than the bottom nav (see
 * docs/device-reference/PEVC3107E/README.md).
 */
export function HomeHeaderBar({
  instanceId,
  name,
  serialNumber,
  now,
  status,
  statusReason,
  connectionPending,
  onToggleConnection,
}: {
  instanceId: string;
  name: string;
  serialNumber: string;
  now: Date;
  status: DeviceConnectionStatus;
  statusReason: string | null;
  connectionPending: boolean;
  onToggleConnection: () => void;
}) {
  const isRunning = status === "CONNECTED" || status === "CONNECTING";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-blue-600 px-4 py-3 text-white">
      <Link
        href={`/instances/${instanceId}/status`}
        title="Status / diagnostics"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15 hover:bg-white/25"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <Link
        href={`/instances/${instanceId}/qr`}
        title="Show QR code"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15 hover:bg-white/25"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <path d="M14 14h3v3h-3zM14 20h7M20 14v3M17 20v1M20 20v1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
      <span className="truncate text-sm font-medium">{name}</span>

      <span className="ml-auto text-xs text-white/80">SN: {serialNumber}</span>
      <span className="font-mono text-sm tabular-nums">{formatClock(now)}</span>

      <button
        type="button"
        title={statusReason ? `${status} — ${statusReason}` : `${status} — click to ${isRunning ? "stop" : "start"} the OCPP connection`}
        disabled={connectionPending}
        onClick={onToggleConnection}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-white/15 disabled:opacity-50 ${CONNECTION_ICON_STYLES[status]}`}
      >
        {isRunning ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M5 12.5a9 9 0 0 1 14 0" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.5 16a4.5 4.5 0 0 1 7 0" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="m3 3 18 18" strokeLinecap="round" />
            <path d="M5 12.5a9 9 0 0 1 3.6-2.9M19 12.5a9 9 0 0 0-6-4.3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M8.5 16a4.5 4.5 0 0 1 3-1.4" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
          </svg>
        )}
      </button>
    </div>
  );
}
