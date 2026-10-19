"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Real PEVC3107E touchscreen: every reference capture is exactly 536x314. The stage is laid out at 2x that. */
export const SCREEN_NATIVE_WIDTH = 536;
export const SCREEN_NATIVE_HEIGHT = 314;
export const SCREEN_STAGE_SCALE = 2;
const STAGE_W = SCREEN_NATIVE_WIDTH * SCREEN_STAGE_SCALE;
const STAGE_H = SCREEN_NATIVE_HEIGHT * SCREEN_STAGE_SCALE;

/**
 * Wraps a device screen's chrome in a fixed 1072x628 stage (2x the 536x314 reference) and scales
 * the whole stage with a CSS transform to fit its container, so the layout never reflows
 * responsively: it is always the same picture as the real device's screen, just bigger or smaller.
 * Content taller than the stage scrolls inside it (callers' body wrapper needs
 * `flex-1 min-h-0 overflow-y-auto`).
 *
 * `bezel={false}` renders the bare screen (used when the screen is embedded into the 3D station's
 * monitor, which supplies its own physical bezel).
 */
/** True when the page is rendered inside the 3D twin's monitor iframe (or opened with ?embed). */
export function useEmbedded(): boolean {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only check, must run after hydration
    setEmbedded(window.self !== window.top || new URLSearchParams(window.location.search).has("embed"));
  }, []);
  return embedded;
}

export function DeviceScreenFrame({ children, bezel = true }: { children: ReactNode; bezel?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const embedded = useEmbedded();

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setScale(el.clientWidth / STAGE_W);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [embedded]);

  const screen = (
    <div ref={hostRef} className="relative w-full overflow-hidden bg-[#f4f6f8]" style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}` }}>
      <div
        className="device-screen absolute left-0 top-0 flex origin-top-left flex-col overflow-hidden bg-[#f4f6f8] text-[#333]"
        style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );

  if (embedded) return <div className="fixed inset-0 z-40 flex items-center bg-black"><div className="w-full">{screen}</div></div>;
  if (!bezel) return screen;
  return (
    <div className="mx-auto w-full" style={{ maxWidth: "1072px" }}>
      <div className="rounded-[28px] bg-zinc-900 p-3 shadow-2xl ring-1 ring-black/10 sm:p-4">
        <div className="overflow-hidden rounded-[8px] shadow-inner">{screen}</div>
      </div>
    </div>
  );
}
