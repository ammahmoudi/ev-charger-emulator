"use client";

import type { ReactNode } from "react";

/**
 * Red warning-icon confirm panel matching the PEVC3107E Maintenance tab's sub-tab screens
 * (docs/device-reference/PEVC3107E/manual-pages/Page12_Image3.jpg etc.): a red circled "!",
 * bold red bracketed prompt, optional detail text, and one or more action buttons.
 */
export function MaintenanceConfirmPanel({
  prompt,
  detail,
  children,
}: {
  prompt: string;
  detail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-[10px] py-[10px] text-center">
      <span className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-[#e5302b] text-[44px] font-bold leading-none text-white">!</span>
      <p className="text-[46px] leading-[50px] text-[#e5302b]">【{prompt}】</p>
      <p className="text-[30px] tracking-wide text-[#666]">whether or not?</p>
      {detail ? <div className="max-w-[760px] text-[20px] leading-[24px] text-[#999]">{detail}</div> : null}
      <div className="flex flex-wrap items-center justify-center gap-[16px] pt-[2px]">{children}</div>
    </div>
  );
}
