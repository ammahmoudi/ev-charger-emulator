"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceTable } from "@/components/device-instances/DeviceTable";
import { ScreenPanel, VALUE_FONT } from "@/components/device-instances/DeviceScreenParts";
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

        <ScreenPanel>
          {error ? <p className="px-4 pt-2 text-[20px] text-[#e5302b]">{error}</p> : null}
          {result === null ? (
            <p className="p-6 text-[24px] text-[#888]">Loading…</p>
          ) : (
            <>
              <DeviceTable
                columns={[
                  { label: "S.N", width: "110px" },
                  { label: "Event occurrence time", width: "1fr" },
                  { label: "Event description", width: "1fr" },
                ]}
                minRows={5}
                rows={result.items.map((event, idx) => [
                  <span key="n" style={{ fontFamily: VALUE_FONT }}>{String((result.page - 1) * PAGE_SIZE + idx + 1).padStart(4, "0")}</span>,
                  <span key="t" style={{ fontFamily: VALUE_FONT }}>{formatDateTime(event.occurredAt)}</span>,
                  <span key="d">{event.description}</span>,
                ])}
              />
              <Pagination page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
            </>
          )}
        </ScreenPanel>

        <DeviceBottomNav instanceId={instanceId} active="Event" />
      </DeviceScreenFrame>
    </div>
  );
}
