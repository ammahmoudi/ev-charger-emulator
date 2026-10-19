import Link from "next/link";
import type { ReactNode } from "react";

/** Reference blue sampled from docs/device-reference/PEVC3107E/screenshots (#0077ce). */
export const DEVICE_BLUE = "#0077ce";

function HomeGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 3 2 12h3v8h5v-5h4v5h5v-8h3L12 3Z" />
    </svg>
  );
}

/** The little "Hi" logo box at the header's left edge. */
function HiLogo() {
  return (
    <span className="ml-3 flex h-[44px] w-[44px] flex-none items-center justify-center rounded-[6px] border-2 border-white/90 text-[26px] font-semibold leading-none text-white">
      Hi
    </span>
  );
}

/**
 * The real device's header: blue bar, "Hi" logo, a white home *tab* that visually merges into the
 * page below (the active tab), then screen-specific content (serial, clock, signal) on the right.
 * Used by every screen so the chrome is identical to the reference, at the stage's 2x scale.
 */
export function DeviceHeaderChrome({
  instanceId,
  homeHref,
  homeTitle = "Home",
  right,
  children,
}: {
  instanceId: string;
  homeHref?: string;
  homeTitle?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative flex h-[72px] flex-none items-end text-white" style={{ background: DEVICE_BLUE }}>
      <div className="absolute inset-y-0 left-0 flex items-center">
        <HiLogo />
      </div>
      <Link
        href={homeHref ?? `/instances/${instanceId}`}
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
