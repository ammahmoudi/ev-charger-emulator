import Link from "next/link";
import type { ReactNode } from "react";

/** Reference blue sampled from docs/device-reference/PEVC3107E/screenshots (#0077ce). */
export const DEVICE_BLUE = "#0077ce";

/** SN / clock face: the reference renders digits in a tall, tabular LCD-like face. */
export const LCD_FONT = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "DejaVu Sans Condensed", sans-serif';

/** Passive signal-strength glyph with the red "x" (offline marker) shown on the real device. */
export function SignalGlyph({ online = false }: { online?: boolean }) {
  return (
    <span className="relative flex h-[44px] w-[52px] items-center justify-center text-white">
      <svg viewBox="0 0 28 24" className="h-[34px] w-[34px]" fill="currentColor">
        <rect x="2" y="15" width="4" height="7" rx="1" />
        <rect x="9" y="10" width="4" height="12" rx="1" opacity={online ? 1 : 0.55} />
        <rect x="16" y="5" width="4" height="17" rx="1" opacity={online ? 1 : 0.35} />
      </svg>
      {!online ? (
        <span className="absolute -bottom-[2px] -right-[2px] flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#e5302b] text-[16px] font-bold leading-none text-white ring-2 ring-[#0077ce]">×</span>
      ) : null}
    </span>
  );
}

/** Computer connection indicator visible in the newer field photographs. */
export function ComputerGlyph() {
  return <svg aria-label="Connection indicator" viewBox="0 0 44 36" className="h-[38px] w-[46px] text-white" fill="none" stroke="currentColor" strokeWidth="2.5">
    <rect x="5" y="3" width="34" height="23" rx="3" />
    <path d="M2 31h40M17 27v4M27 27v4M19 7h6" />
  </svg>;
}

function HomeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3Z" />
    </svg>
  );
}

/** The little "Hi" logo box at the header's left edge. */
function HiLogo({ onClick }: { onClick?: () => void }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag
      {...(onClick ? { type: "button" as const, onClick, title: "Menu", "aria-label": "Menu" } : {})}
      className="ml-3 flex h-[44px] w-[44px] flex-none items-center justify-center rounded-[6px] border-2 border-white/90 text-[26px] font-semibold leading-none text-white">
      Hi
    </Tag>
  );
}

/**
 * The real device's header: blue bar, "Hi" logo, a white home *tab* that visually merges into the
 * page below (the active tab), then screen-specific content (serial, clock, signal) on the right.
 * Used by every screen so the chrome is identical to the reference, at the stage's 2x scale.
 */
export function DeviceHeaderChrome({
  instanceId,
  onLogoClick,
  homeHref,
  homeTitle = "Home",
  onHomeClick,
  right,
  children,
}: {
  instanceId: string;
  /** When set, the "Hi" logo becomes a button (the Home screen uses it to open the menu). */
  onLogoClick?: () => void;
  homeHref?: string;
  homeTitle?: string;
  onHomeClick?: () => void;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex h-[72px] flex-none items-end text-white" style={{ background: DEVICE_BLUE }}>
      <div className="absolute inset-y-0 left-0 flex items-center">
        <HiLogo onClick={onLogoClick} />
      </div>
      <Link
        href={homeHref ?? `/instances/${instanceId}`}
        onClick={onHomeClick}
        title={homeTitle}
        aria-label={homeTitle}
        className="absolute bottom-0 left-[116px] flex h-[62px] w-[100px] items-center justify-center rounded-t-[16px] bg-[#f4f6f8]"
        style={{ clipPath: "polygon(0 100%, 8% 30%, 16% 0, 84% 0, 92% 30%, 100% 100%)" }}
      >
        <HomeGlyph className="h-[38px] w-[38px] text-[#0b72c4]" />
      </Link>
      <div className="ml-[250px] flex min-w-0 flex-1 items-center gap-6 pr-4 pb-3 pt-2">{children}</div>
      {right ? <div className="flex items-center gap-4 pr-4 pb-3">{right}</div> : null}
    </div>
  );
}
