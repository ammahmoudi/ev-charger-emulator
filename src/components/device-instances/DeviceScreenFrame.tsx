import type { ReactNode } from "react";

/**
 * The real PEVC3107E's screen is a fixed-resolution touchscreen — every reference screenshot in
 * docs/device-reference/PEVC3107E/ (screenshots/ and manual-pages/) is exactly 536x314px
 * (aspect ratio ~1.707), never a responsive shape. Wraps a device screen's header/body/bottom-nav
 * chrome in a frame locked to that exact aspect ratio (scaled up 2x for on-screen usability, and
 * shrinking proportionally on narrow viewports) inside a bezel, so it reads as a photo of the
 * physical device's screen rather than a normal web page. Content taller than the frame scrolls
 * inside it (the caller's body wrapper needs `flex-1 min-h-0 overflow-y-auto`) instead of growing
 * the frame past the real screen's proportions.
 */
export function DeviceScreenFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full" style={{ maxWidth: "1072px" }}>
      <div className="rounded-[28px] bg-zinc-900 p-3 shadow-2xl ring-1 ring-black/10 dark:bg-black sm:p-4">
        <div
          className="mx-auto flex w-full flex-col overflow-hidden rounded-[10px] bg-white shadow-inner dark:bg-zinc-900"
          style={{ aspectRatio: "536 / 314" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
