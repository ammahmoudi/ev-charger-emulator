"use client";

import { useState } from "react";

/**
 * "Present card" popup shown when starting a session (Home screen's Charging button, and the
 * Cost screen's quick-simulate panel) — mirrors a real card swipe. Pre-filled with the instance's
 * master card, so clicking straight through behaves exactly like the old one-click "Charging"
 * button (always starts a local simulated session). Editing the code to something else routes
 * through a real CSMS `Authorize`/`StartTransaction` instead — see `src/lib/device-instances/rfid.ts`.
 */
export function RfidPromptModal({
  connectorLabel,
  masterCardIdTag,
  pending,
  error,
  onConfirm,
  onCancel,
}: {
  connectorLabel: string;
  masterCardIdTag: string | null;
  pending: boolean;
  error: string | null;
  onConfirm: (idTag: string) => void;
  onCancel: () => void;
}) {
  const [idTag, setIdTag] = useState(masterCardIdTag ?? "");
  const isMasterCard = masterCardIdTag !== null && idTag === masterCardIdTag;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rfid-prompt-title"
    >
      <div className="w-full max-w-sm rounded-xl bg-white shadow-xl dark:bg-zinc-900">
        <div className="flex flex-col items-center gap-2 border-b border-zinc-200 px-6 py-6 dark:border-zinc-800">
          <span className="text-3xl">💳</span>
          <p id="rfid-prompt-title" className="text-lg font-medium text-zinc-700 dark:text-zinc-200">
            Present card — {connectorLabel}
          </p>
        </div>

        <div className="flex flex-col gap-3 px-6 py-4 text-sm">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Card idTag</label>
            <input
              autoFocus
              value={idTag}
              onChange={(e) => setIdTag(e.target.value)}
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 font-mono text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
          </div>
          <p className="text-xs text-zinc-500">
            {isMasterCard
              ? "Master card — starts a session locally, works even without a CSMS connection."
              : "Not the master card — requires the instance to be connected to a CSMS, which will Authorize/StartTransaction this card for real."}
          </p>
          {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <div className="flex gap-2 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(idTag.trim())}
            disabled={pending || !idTag.trim()}
            className="flex-1 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {pending ? "Presenting…" : "Present card"}
          </button>
        </div>
      </div>
    </div>
  );
}
