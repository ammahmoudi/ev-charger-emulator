"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConnectorStatusChips } from "@/components/device-instances/ConnectorStatusChips";
import { StatusBadge } from "@/components/device-instances/StatusBadge";
import type { DeviceInstanceSummary } from "@/lib/device-instances/types";

const POLL_INTERVAL_MS = 2000;
const RUNNING_STATUSES = new Set(["CONNECTED", "CONNECTING"]);

function isRunning(instance: DeviceInstanceSummary): boolean {
  return RUNNING_STATUSES.has(instance.status);
}

export default function DashboardPage() {
  const [instances, setInstances] = useState<DeviceInstanceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  // Selections for instances that no longer exist (e.g. deleted from another tab) are simply
  // ignored here rather than pruned from state, so bulk actions never operate on a stale id.
  const activeSelectedIds = useMemo(() => {
    if (!instances) return new Set<string>();
    const validIds = new Set(instances.map((i) => i.id));
    return new Set([...selectedIds].filter((id) => validIds.has(id)));
  }, [instances, selectedIds]);

  async function withPending(ids: string[], action: (id: string) => Promise<void>) {
    setPendingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    try {
      await Promise.all(ids.map(action));
      await load();
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }
  }

  async function handleStart(ids: string[]) {
    await withPending(ids, async (id) => {
      const res = await fetch(`/api/device-instances/${id}/start`, { method: "POST" });
      if (!res.ok) setError("Failed to start one or more instances");
    });
  }

  async function handleStop(ids: string[]) {
    await withPending(ids, async (id) => {
      const res = await fetch(`/api/device-instances/${id}/stop`, { method: "POST" });
      if (!res.ok) setError("Failed to stop one or more instances");
    });
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete device instance "${name}"? This cannot be undone.`)) return;
    await withPending([id], async () => {
      const res = await fetch(`/api/device-instances/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) setError("Failed to delete instance");
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!instances) return;
    setSelectedIds(activeSelectedIds.size === instances.length ? new Set() : new Set(instances.map((i) => i.id)));
  }

  const counts = useMemo(() => {
    const base = { total: 0, CONNECTED: 0, CONNECTING: 0, DISCONNECTED: 0, FAULTED: 0 };
    if (!instances) return base;
    base.total = instances.length;
    for (const instance of instances) base[instance.status] += 1;
    return base;
  }, [instances]);

  const selectedList = [...activeSelectedIds];
  const anySelectedRunning = instances?.some((i) => activeSelectedIds.has(i.id) && isRunning(i)) ?? false;
  const anySelectedStopped = instances?.some((i) => activeSelectedIds.has(i.id) && !isRunning(i)) ?? false;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Device dashboard</h1>
          <p className="text-sm text-zinc-500">Every emulated device instance, across all models, in one place.</p>
        </div>
        <Link
          href="/instances/new"
          className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          New device
        </Link>
      </div>

      {instances && instances.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="Total" value={counts.total} />
          <StatTile label="Connected" value={counts.CONNECTED} tone="emerald" />
          <StatTile label="Connecting" value={counts.CONNECTING} tone="amber" />
          <StatTile label="Disconnected" value={counts.DISCONNECTED} tone="zinc" />
          <StatTile label="Faulted" value={counts.FAULTED} tone="red" />
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      {instances === null ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : instances.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No device instances yet. Create one from a device model to get started.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={selectedList.length === 0 || !anySelectedStopped}
              onClick={() => handleStart(selectedList)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Start selected{selectedList.length > 0 ? ` (${selectedList.length})` : ""}
            </button>
            <button
              type="button"
              disabled={selectedList.length === 0 || !anySelectedRunning}
              onClick={() => handleStop(selectedList)}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Stop selected{selectedList.length > 0 ? ` (${selectedList.length})` : ""}
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all instances"
                      checked={instances.length > 0 && activeSelectedIds.size === instances.length}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Charge point ID</th>
                  <th className="px-4 py-2 font-medium">CSMS URL</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Connectors</th>
                  <th className="px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {instances.map((instance) => {
                  const isPending = pendingIds.has(instance.id);
                  const running = isRunning(instance);
                  return (
                    <tr key={instance.id}>
                      <td className="px-4 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${instance.name}`}
                          checked={selectedIds.has(instance.id)}
                          onChange={() => toggleSelected(instance.id)}
                        />
                      </td>
                      <td className="px-4 py-2 align-top">
                        <Link href={`/instances/${instance.id}`} className="font-medium hover:underline">
                          {instance.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 align-top text-zinc-600 dark:text-zinc-400">
                        {instance.deviceModel.manufacturer} {instance.deviceModel.model}
                      </td>
                      <td className="px-4 py-2 align-top font-mono text-xs text-zinc-600 dark:text-zinc-400">
                        {instance.chargePointId}
                      </td>
                      <td className="max-w-[16rem] truncate px-4 py-2 align-top font-mono text-xs text-zinc-600 dark:text-zinc-400" title={instance.csmsUrl}>
                        {instance.csmsUrl}
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={instance.status} />
                          {instance.statusReason ? (
                            <p className="max-w-[14rem] text-xs text-zinc-500" title={instance.statusReason}>
                              {instance.statusReason}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <ConnectorStatusChips connectors={instance.connectors} />
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex gap-2">
                          {running ? (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleStop([instance.id])}
                              className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                              Stop
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => handleStart([instance.id])}
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
        </>
      )}
    </div>
  );
}

const TILE_TONES = {
  zinc: "text-zinc-900 dark:text-zinc-50",
  emerald: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
};

function StatTile({ label, value, tone = "zinc" }: { label: string; value: number; tone?: keyof typeof TILE_TONES }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-2xl font-semibold ${TILE_TONES[tone]}`}>{value}</p>
    </div>
  );
}
