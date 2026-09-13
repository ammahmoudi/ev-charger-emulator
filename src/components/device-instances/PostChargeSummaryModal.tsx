"use client";

import type { PostChargeSummary } from "@/lib/device-instances/types";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

/**
 * Post-charge summary popup — shown immediately after a simulated session ends (issue #14).
 * Layout mirrors the real PEVC3107E's popup: cost banner, card number + stop-type indicator,
 * then a Start/Stop time + energy/duration grid. See docs/device-reference/PEVC3107E/README.md.
 */
export function PostChargeSummaryModal({ summary, onClose }: { summary: PostChargeSummary; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-charge-summary-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-2 border-b border-zinc-200 px-6 py-6 dark:border-zinc-800">
          <span className="text-3xl">💰</span>
          <p id="post-charge-summary-title" className="text-lg text-zinc-700 dark:text-zinc-200">
            Cost({summary.currency ?? "—"}):{" "}
            <span className="font-semibold text-black dark:text-zinc-50">{summary.cost.toFixed(2)}</span>
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Card number:</span>
            <span className="flex items-center gap-2 font-mono">
              {summary.idTag}
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                  summary.isFault
                    ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400"
                    : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400"
                }`}
              >
                {summary.stopCause}
              </span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <div>
              <p className="text-zinc-500">Start Time:</p>
              <p className="font-mono text-xs">{formatDateTime(summary.startedAt)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Charging Energy(kWh):</p>
              <p>{summary.energyKwh.toFixed(3)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Stop Time:</p>
              <p className="font-mono text-xs">{formatDateTime(summary.stoppedAt)}</p>
            </div>
            <div>
              <p className="text-zinc-500">Charging Time:</p>
              <p>{formatDuration(summary.durationSeconds)}</p>
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
