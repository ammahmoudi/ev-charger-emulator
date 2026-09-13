"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { InstanceSubNav } from "@/components/device-instances/InstanceSubNav";
import type { ConnectorRuntimeView } from "@/lib/device-instances/types";

const POLL_INTERVAL_MS = 2000;

const STATUS_STYLES: Record<string, string> = {
  Available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  Charging: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  Faulted: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

export default function LockPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [connectors, setConnectors] = useState<ConnectorRuntimeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors`);
      if (!res.ok) throw new Error(`Failed to load connectors (${res.status})`);
      setConnectors((await res.json()).connectors);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    }
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    load();
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function handleSetLock(connectorId: number, locked: boolean) {
    setPending(connectorId);
    setError(null);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update lock state");
        return;
      }
      await load();
    } finally {
      setPending(null);
    }
  }

  async function handleClearFault(connectorId: number) {
    setPending(connectorId);
    setError(null);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/clear-fault`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to clear fault");
        return;
      }
      await load();
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
          ← Instance
        </Link>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Lock</h1>
        <p className="text-sm text-zinc-500">
          Manual per-connector lock/unlock. Unlocking mid-session mirrors a real connector&apos;s cable release —
          it ends the session (stop cause &quot;UnlockConnector&quot;), the same as a CSMS-initiated{" "}
          <code className="font-mono text-xs">UnlockConnector</code> would (issue #10), but triggered locally.
        </p>
      </div>

      <InstanceSubNav instanceId={instanceId} />

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {connectors === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {connectors.map((connector) => {
            const isPending = pending === connector.connectorId;
            return (
              <div
                key={connector.connectorId}
                className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
                    {connector.label ?? `Connector ${connector.connectorId}`}
                  </h2>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      STATUS_STYLES[connector.status] ??
                      "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                    }`}
                  >
                    {connector.status}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm">
                  <span
                    className={`inline-flex h-2 w-2 rounded-full ${connector.locked ? "bg-zinc-800 dark:bg-zinc-200" : "bg-zinc-300 dark:bg-zinc-600"}`}
                  />
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {connector.locked ? "Locked" : "Unlocked"}
                  </span>
                  {connector.activeSession ? (
                    <span className="text-xs text-zinc-500">· session in progress (card {connector.activeSession.idTag})</span>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={isPending || connector.locked}
                    onClick={() => handleSetLock(connector.connectorId, true)}
                    className="flex-1 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Lock
                  </button>
                  <button
                    type="button"
                    disabled={isPending || !connector.locked}
                    onClick={() => handleSetLock(connector.connectorId, false)}
                    className="flex-1 rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                  >
                    Unlock
                  </button>
                </div>

                {connector.status === "Faulted" ? (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleClearFault(connector.connectorId)}
                    className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                  >
                    Clear fault
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
