"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { StatusBadge } from "@/components/device-instances/StatusBadge";
import type { DeviceInstanceSummary } from "@/lib/device-instances/types";

const POLL_INTERVAL_MS = 2000;

export default function InstancesPage() {
  const [instances, setInstances] = useState<DeviceInstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/device-instances");
      if (!res.ok) throw new Error(`Failed to load instances (${res.status})`);
      const data = await res.json();
      setInstances(data.instances);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load instances");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    load();
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function withPending(id: string, action: () => Promise<void>) {
    setPendingIds((prev) => new Set(prev).add(id));
    try {
      await action();
      await load();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function handleStart(id: string) {
    await withPending(id, async () => {
      const res = await fetch(`/api/device-instances/${id}/start`, { method: "POST" });
      if (!res.ok) setError("Failed to start instance");
    });
  }

  async function handleStop(id: string) {
    await withPending(id, async () => {
      const res = await fetch(`/api/device-instances/${id}/stop`, { method: "POST" });
      if (!res.ok) setError("Failed to stop instance");
    });
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete device instance "${name}"? This cannot be undone.`)) return;
    await withPending(id, async () => {
      const res = await fetch(`/api/device-instances/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) setError("Failed to delete instance");
    });
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Device instances</h1>
        <Link
          href="/instances/new"
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          New device
        </Link>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {instances === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : instances.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No device instances yet. Create one from a device model to get started.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 font-medium">Charge point ID</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {instances.map((instance) => {
                const isPending = pendingIds.has(instance.id);
                const isRunning = instance.status === "CONNECTED" || instance.status === "CONNECTING";
                return (
                  <tr key={instance.id}>
                    <td className="px-4 py-2">
                      <Link href={`/instances/${instance.id}`} className="font-medium hover:underline">
                        {instance.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-zinc-600 dark:text-zinc-400">
                      {instance.deviceModel.manufacturer} {instance.deviceModel.model}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                      {instance.chargePointId}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={instance.status} />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        {isRunning ? (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleStop(instance.id)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Stop
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isPending}
                            onClick={() => handleStart(instance.id)}
                            className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                          >
                            Start
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => handleDelete(instance.id, instance.name)}
                          className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
