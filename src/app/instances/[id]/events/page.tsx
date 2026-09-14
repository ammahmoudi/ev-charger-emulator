"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { Pagination } from "@/components/device-instances/Pagination";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import type { DeviceInstanceEventView, PagedResult } from "@/lib/device-instances/types";

const PAGE_SIZE = 10;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function EventsPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PagedResult<DeviceInstanceEventView> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);

  const loadInstance = useCallback(async () => {
    const res = await fetch(`/api/device-instances/${instanceId}`);
    if (!res.ok) return;
    const data = await res.json();
    setInstanceName(data.instance.name);
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    loadInstance();
  }, [loadInstance]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/events?page=${page}&pageSize=${PAGE_SIZE}`);
      if (!res.ok) throw new Error(`Failed to load events (${res.status})`);
      setResult(await res.json());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load events");
    }
  }, [instanceId, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route/page change, not derived state
    load();
  }, [load]);

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
        ← {instanceName ?? "Instance"}
      </Link>

      <DeviceScreenFrame>
        <DeviceHeaderBar instanceId={instanceId} title={instanceName ?? "Event log"} />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Event log</h1>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          {result === null ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="px-4 py-2 font-medium">S.N</th>
                      <th className="px-4 py-2 font-medium">Event occurrence time</th>
                      <th className="px-4 py-2 font-medium">Event description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {result.items.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-zinc-500">
                          No events recorded yet.
                        </td>
                      </tr>
                    ) : (
                      result.items.map((event, idx) => (
                        <tr key={event.id}>
                          <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                            {String((result.page - 1) * PAGE_SIZE + idx + 1).padStart(4, "0")}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                            {formatDateTime(event.occurredAt)}
                          </td>
                          <td className="px-4 py-2">{event.description}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
            </div>
          )}
        </div>

        <DeviceBottomNav instanceId={instanceId} active="Event" />
      </DeviceScreenFrame>
    </div>
  );
}
