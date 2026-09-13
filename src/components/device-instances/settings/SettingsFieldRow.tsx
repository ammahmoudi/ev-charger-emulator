import type { ReactNode } from "react";

interface SettingsFieldRowProps {
  label: string;
  unit?: string | null;
  error?: string;
  children: ReactNode;
}

/** One label/value row in the device's two-column settings layout, e.g. "Fan enable: Disable". */
export function SettingsFieldRow({ label, unit, error, children }: SettingsFieldRowProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 py-2 text-sm last:border-b-0 dark:border-zinc-800">
      <span className="pt-1.5 text-zinc-500 dark:text-zinc-400">
        {label}
        {unit ? <span className="text-zinc-400"> ({unit})</span> : null}
      </span>
      <div className="flex flex-col items-end gap-1">
        {children}
        {error ? <span className="max-w-40 text-right text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      </div>
    </div>
  );
}

export const compactControlClassName =
  "w-36 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
