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
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-2xl font-bold text-white">
        !
      </span>
      <p className="text-lg font-bold text-red-600 dark:text-red-400">【{prompt}】whether or not?</p>
      {detail ? <div className="max-w-sm text-sm text-zinc-500">{detail}</div> : null}
      <div className="flex flex-wrap items-center justify-center gap-3 pt-2">{children}</div>
    </div>
  );
}
