"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { BlueButton, ScreenPanel } from "@/components/device-instances/DeviceScreenParts";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import type { ConnectorRuntimeView } from "@/lib/device-instances/types";

const POLL_INTERVAL_MS = 2000;

const STATUS_STYLES: Record<string, string> = {
  Available: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400",
  Preparing: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400",
  Charging: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400",
  Faulted: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
};

export default function LockPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [connectors, setConnectors] = useState<ConnectorRuntimeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [instanceName, setInstanceName] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
        ← {instanceName ?? "Instance"}
      </Link>

      <DeviceScreenFrame>
        <DeviceHeaderBar instanceId={instanceId} title={instanceName ?? "Lock"} />

        <ScreenPanel>
          {error ? <p className="px-4 pt-2 text-[20px] text-[#e5302b]">{error}</p> : null}
          {connectors === null ? (
            <p className="p-6 text-[24px] text-[#888]">Loading…</p>
          ) : (
            <div className="grid flex-1 grid-cols-2 gap-[16px] p-[16px]">
              {connectors.map((connector) => {
                const isPending = pending === connector.connectorId;
                const letter = (connector.label ?? "").trim().slice(-1).toUpperCase() || String(connector.connectorId);
                return (
                  <div key={connector.connectorId} className="flex flex-col items-center justify-between gap-[8px] border border-[#e3e6ea] bg-white px-[16px] py-[14px]">
                    <div className="flex w-full items-center justify-between">
                      <span className="flex h-[44px] w-[44px] items-center justify-center rounded-[8px] bg-[#9aa3ad] text-[28px] font-bold text-white">{letter}</span>
                      <span className={`rounded-full px-[14px] py-[2px] text-[22px] font-medium ${STATUS_STYLES[connector.status] ?? "bg-zinc-100 text-zinc-600"}`}>{connector.status}</span>
                    </div>
                    <svg viewBox="0 0 24 24" className={`h-[84px] w-[84px] ${connector.locked ? "text-[#2f8cf0]" : "text-[#b9b9b9]"}`} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="9" rx="2" />
                      <path d={connector.locked ? "M8 11V8a4 4 0 0 1 8 0v3" : "M8 11V8a4 4 0 0 1 7.5-1.9"} />
                    </svg>
                    <p className="text-[26px] text-[#444]">
                      {connector.locked ? "Locked" : "Unlocked"}
                      {connector.activeSession ? <span className="text-[20px] text-[#888]"> · card {connector.activeSession.idTag}</span> : null}
                    </p>
                    <div className="flex gap-[12px]">
                      <BlueButton disabled={isPending || connector.locked} onClick={() => handleSetLock(connector.connectorId, true)}>
                        Lock
                      </BlueButton>
                      <BlueButton disabled={isPending || !connector.locked} onClick={() => handleSetLock(connector.connectorId, false)}>
                        Unlock
                      </BlueButton>
                    </div>
                    {connector.status === "Faulted" ? (
                      <button type="button" disabled={isPending} onClick={() => handleClearFault(connector.connectorId)} className="rounded-[8px] border-2 border-[#e5302b] px-[20px] py-[2px] text-[22px] font-medium text-[#e5302b] disabled:opacity-50">
                        Clear fault
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </ScreenPanel>

        <DeviceBottomNav instanceId={instanceId} active="Lock" />
      </DeviceScreenFrame>
    </div>
  );
}
