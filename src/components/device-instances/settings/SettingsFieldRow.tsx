import type { ReactNode } from "react";

import { VALUE_FONT } from "../DeviceScreenParts";

interface SettingsFieldRowProps {
  label: string;
  unit?: string | null;
  error?: string;
  children: ReactNode;
}

/** One bordered label/value cell in the device's two-column settings layout, e.g. "Fan enable: Disable". */
export function SettingsFieldRow({ label, unit, error, children }: SettingsFieldRowProps) {
  return (
    <div className="flex min-h-[52px] items-center justify-between gap-3 border border-[#e3e6ea] bg-white px-[12px] py-[2px]">
      <span className="text-[24px] leading-[25px] text-[#4a4a4a]">
        {label}
        {unit ? <span>({unit})</span> : null}:
      </span>
      <div className="flex flex-col items-end">
        <span className="text-[30px] leading-[32px] text-[#333]" style={{ fontFamily: VALUE_FONT }}>
          {children}
        </span>
        {error ? <span className="max-w-[260px] text-right text-[18px] leading-[20px] text-[#e5302b]">{error}</span> : null}
      </div>
    </div>
  );
}

/** Inputs/selects blend into the cell like the device's tap-to-edit values; a faint underline marks them as editable. */
export const compactControlClassName =
  "w-[250px] border-0 border-b border-dashed border-[#c5cbd3] bg-transparent px-1 py-0 text-right text-[28px] leading-[32px] text-[#222] focus:border-[#1f7fe0] focus:outline-none";
