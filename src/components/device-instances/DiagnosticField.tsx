"use client";

import Link from "next/link";

interface DiagnosticFieldProps {
  label: string;
  value: string;
  /** When set, the value renders red ("abnormal") or black ("normal"). Omit for plain readouts (e.g. numeric telemetry). */
  status?: "normal" | "abnormal";
  /** When set, clicking the value toggles it and calls this with the next status. */
  onToggle?: (next: "normal" | "abnormal") => void;
  detailsHref?: string;
}

/** One label/value row for the status/diagnostics screens. Faulted fields render red per issue #4's acceptance criteria. */
export function DiagnosticField({ label, value, status, onToggle, detailsHref }: DiagnosticFieldProps) {
  const isAbnormal = status === "abnormal";
  const colorClass = status === undefined ? "text-black dark:text-zinc-50" : isAbnormal ? "text-red-600 dark:text-red-400" : "text-black dark:text-zinc-50";

  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <div className="flex items-center gap-3">
        {onToggle ? (
          <button
            type="button"
            onClick={() => onToggle(isAbnormal ? "normal" : "abnormal")}
            title="Click to toggle fault injection"
            className={`cursor-pointer font-medium hover:underline ${colorClass}`}
          >
            {value}
          </button>
        ) : (
          <span className={`font-medium ${colorClass}`}>{value}</span>
        )}
        {detailsHref ? (
          <Link href={detailsHref} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
            Details
          </Link>
        ) : null}
      </div>
    </div>
  );
}
