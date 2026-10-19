"use client";

import Link from "next/link";

import { Cell, VALUE_FONT } from "./DeviceScreenParts";

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
  const colorClass = isAbnormal ? "text-[#e5302b]" : "text-[#333]";
  const numeric = /^[\d.\-+x]/i.test(value) && status === undefined;
  const valueStyle = numeric ? { fontFamily: VALUE_FONT } : undefined;

  return (
    <Cell label={label}>
      <span className="flex items-center gap-4">
        {onToggle ? (
          <button type="button" onClick={() => onToggle(isAbnormal ? "normal" : "abnormal")} title="Click to toggle fault injection" className={`cursor-pointer text-[30px] ${colorClass}`}>
            {value}
          </button>
        ) : (
          <span className={`text-[30px] ${colorClass}`} style={valueStyle}>
            {value}
          </span>
        )}
        {detailsHref ? (
          <Link href={detailsHref} className="text-[24px] text-[#1f7fe0]">
            Details
          </Link>
        ) : null}
      </span>
    </Cell>
  );
}
