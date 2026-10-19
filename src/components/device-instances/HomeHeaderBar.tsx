"use client";

import Link from "next/link";
import type { DeviceConnectionStatus } from "@prisma/client";

import { DeviceHeaderChrome } from "./DeviceHeaderChrome";

function formatClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const CONNECTION_ICON_STYLES: Record<DeviceConnectionStatus, string> = {
  DISCONNECTED: "text-white/60",
  CONNECTING: "text-white/80 animate-pulse",
  CONNECTED: "text-white",
  FAULTED: "text-red-200",
};

/** SN / clock in the device's tall, tabular numerals (reference shows a condensed LCD-style face). */
const LCD_FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "DejaVu Sans Condensed", sans-serif';

/**
 * Home-screen header, pixel-matched to docs/device-reference/PEVC3107E/screenshots/01-home-dual-plug.png:
 * "Hi" logo, white home tab (which opens the status/diagnostics overlay, as on the real device),
 * `SN: <serial>` and the live clock, and the signal glyph at the right — which here doubles as the
 * OCPP connection toggle (the real one is a passive indicator; the red "x" appears when offline).
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
    <DeviceHeaderChrome
      instanceId={instanceId}
      homeHref={`/instances/${instanceId}/status`}
      homeTitle="Status / diagnostics"
      right={
        <>
          <button
            type="button"
            title={statusReason ? `${status} — ${statusReason}` : `${status} — click to ${isRunning ? "stop" : "start"} the OCPP connection`}
            disabled={connectionPending}
            onClick={onToggleConnection}
            className={`relative flex h-[44px] w-[52px] items-center justify-center disabled:opacity-50 ${CONNECTION_ICON_STYLES[status]}`}
          >
            <svg viewBox="0 0 28 24" className="h-[34px] w-[34px]" fill="currentColor">
              <rect x="2" y="15" width="4" height="7" rx="1" />
              <rect x="9" y="10" width="4" height="12" rx="1" opacity={isRunning ? 1 : 0.55} />
              <rect x="16" y="5" width="4" height="17" rx="1" opacity={isRunning ? 1 : 0.35} />
            </svg>
            {!isRunning ? (
              <span className="absolute -bottom-[2px] -right-[2px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#e5302b] text-[16px] font-bold leading-none text-white ring-2 ring-[#0077ce]">
                ×
              </span>
            ) : null}
          </button>
          <Link href={`/instances/${instanceId}/qr`} title="Show QR code" className="sr-only">
            QR
          </Link>
        </>
      }
    >
      <span className="sr-only">{name}</span>
      <span className="text-[32px] font-semibold tracking-wide" style={{ fontFamily: LCD_FONT }}>
        {`SN: ${serialNumber}`}
      </span>
      <span className="ml-auto text-[36px] font-semibold tabular-nums tracking-wide" style={{ fontFamily: LCD_FONT }}>
        {formatClock(now)}
      </span>
    </DeviceHeaderChrome>
  );
}
