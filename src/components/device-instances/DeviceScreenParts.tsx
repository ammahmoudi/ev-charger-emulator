import type { ReactNode } from "react";

/**
 * Shared building blocks for the device's secondary screens, sized for the 2x stage and styled from
 * the reference captures: a light-grey page, a white rounded panel inset ~10px (5px native), grey
 * hairline cells, tall condensed-ish numerals for values, and the glossy blue pill buttons.
 */

/** LCD-style numeral stack used for values (the real screen renders numbers in a slab/digital face). */
export const VALUE_FONT = '"Share Tech Mono", "DejaVu Sans Mono", "Courier New", monospace';

/** Page body between the header and bottom nav: grey ground + the white panel. */
export function ScreenPanel({ children, title, className = "" }: { children: ReactNode; title?: string; className?: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#e9eef4] p-[14px]">
      <div className={`relative flex min-h-0 flex-1 flex-col overflow-y-auto rounded-[10px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)] ${className}`}>
        {title ? <ScreenTitle>{title}</ScreenTitle> : null}
        {children}
      </div>
    </div>
  );
}

/** "▌Communication" style heading with the blue marker bar. */
export function ScreenTitle({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-none items-center gap-3 px-[20px] pb-[8px] pt-[14px] text-[34px] font-semibold text-[#444]">
      <span className="h-[30px] w-[6px] rounded-sm bg-[#1f7fe0]" />
      {children}
    </div>
  );
}

/** Two-column grid of bordered label/value cells (Status / Plug interface board / Settings). */
export function CellGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-2 gap-x-[16px] px-[16px] pb-[10px] ${className}`}>{children}</div>;
}

export function Cell({ label, children, className = "" }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-[58px] items-center justify-between gap-3 border border-[#e3e6ea] bg-white px-[12px] py-[4px] ${className}`}>
      <span className="text-[24px] leading-[26px] text-[#4a4a4a]">{label}</span>
      <span className="text-right text-[32px] leading-[34px] text-[#333]" style={{ fontFamily: VALUE_FONT }}>
        {children}
      </span>
    </div>
  );
}

/** Glossy blue pill, as the real Save / Clear / Plug details buttons. */
export function BlueButton({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-[8px] px-[26px] py-[6px] text-[26px] font-semibold text-white shadow-[inset_0_-3px_0_rgba(0,0,0,0.15)] disabled:opacity-50 ${className}`}
      style={{ background: "linear-gradient(#3ca0ff, #1a6fd8)", ...rest.style }}
    >
      {children}
    </button>
  );
}

/** Outlined pill (the unselected "Plug A details" style on the status screen). */
export function OutlineButton({ children, className = "", ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className={`rounded-[8px] border-2 border-[#3b8fe8] bg-white px-[22px] py-[6px] text-[26px] font-medium text-[#1f7fe0] disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

/** Equal-width tab strip at the top of a panel (Maintenance / Device test): active tab in blue on a lifted white tab. */
export function TabStrip<K extends string>({ tabs, active, onSelect }: { tabs: { key: K; label: string }[]; active: K; onSelect: (key: K) => void }) {
  return (
    <div className="flex flex-none items-stretch bg-[#f3f5f8]">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={`flex flex-1 items-center justify-center px-[8px] py-[8px] text-center text-[26px] leading-[28px] ${
            active === t.key ? "bg-white font-medium text-[#2f8cf0] shadow-[0_-1px_4px_rgba(0,0,0,0.1)]" : "text-[#444]"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
