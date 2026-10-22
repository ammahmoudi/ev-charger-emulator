"use client";

import { useEffect, useState } from "react";

import { ComputerGlyph, DeviceHeaderChrome, LCD_FONT, SignalGlyph } from "../DeviceHeaderChrome";

const serialCache = new Map<string, string>();

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/**
 * Blue header shared by the device's secondary screens. On the real unit every screen shows the same
 * strip: "Hi" logo, white home tab, live clock and the signal glyph (the Home and status screens also
 * show `SN:`). `title` is only kept as an accessible/hover label.
 */
export function DeviceHeaderBar({ instanceId, title, showSerial = false, computerIndicator = false }: { instanceId: string; title: string; showSerial?: boolean; computerIndicator?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [serial, setSerial] = useState<string | null>(serialCache.get(instanceId) ?? null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!showSerial || serialCache.has(instanceId)) return;
    let cancelled = false;
    fetch(`/api/device-instances/${instanceId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const sn = d?.instance?.chargePointId as string | undefined;
        if (sn && !cancelled) {
          serialCache.set(instanceId, sn);
          setSerial(sn);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [instanceId, showSerial]);

  return (
    <DeviceHeaderChrome instanceId={instanceId} homeTitle="Back to device" right={computerIndicator ? <ComputerGlyph /> : <SignalGlyph />}>
      <span className="sr-only">{title}</span>
      {showSerial && serial ? (
        <span className="text-[32px] font-semibold tracking-wide" style={{ fontFamily: LCD_FONT }}>{`SN: ${serial}`}</span>
      ) : null}
      <span className="ml-auto text-[36px] font-semibold tabular-nums tracking-wide" style={{ fontFamily: LCD_FONT }}>
        {`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`}
      </span>
    </DeviceHeaderChrome>
  );
}
