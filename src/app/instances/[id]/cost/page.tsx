"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { Pagination } from "@/components/device-instances/Pagination";
import { PostChargeSummaryModal } from "@/components/device-instances/PostChargeSummaryModal";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import { STOP_CAUSE_OPTIONS } from "@/lib/device-instances/stop-causes";
import type {
  ConnectorRuntimeView,
  DeviceInstanceSessionView,
  PagedResult,
  PostChargeSummary,
} from "@/lib/device-instances/types";

const PAGE_SIZE = 10;
const POLL_INTERVAL_MS = 2000;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export default function CostPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PagedResult<DeviceInstanceSessionView> | null>(null);
  const [connectors, setConnectors] = useState<ConnectorRuntimeView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [summary, setSummary] = useState<PostChargeSummary | null>(null);
  const [idTagByConnector, setIdTagByConnector] = useState<Record<number, string>>({});
  const [rateByConnector, setRateByConnector] = useState<Record<number, string>>({});
  const [stopCauseByConnector, setStopCauseByConnector] = useState<Record<number, string>>({});
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

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/sessions?page=${page}&pageSize=${PAGE_SIZE}`);
      if (!res.ok) throw new Error(`Failed to load sessions (${res.status})`);
      setResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    }
  }, [instanceId, page]);

  const loadConnectors = useCallback(async () => {
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors`);
      if (!res.ok) throw new Error(`Failed to load connectors (${res.status})`);
      const data = await res.json();
      setConnectors(data.connectors);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    }
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    loadConnectors();
    pollRef.current = setInterval(loadConnectors, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadConnectors]);

  async function handleStart(connectorId: number) {
    const idTag = (idTagByConnector[connectorId] ?? "").trim();
    const chargeRateKw = Number(rateByConnector[connectorId] ?? "7");
    if (!idTag) {
      setError("A card number (idTag) is required to start a session");
      return;
    }
    setPending(connectorId);
    setError(null);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idTag, chargeRateKw }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start session");
        return;
      }
      await loadConnectors();
    } finally {
      setPending(null);
    }
  }

  async function handleStop(connectorId: number) {
    const stopCause = stopCauseByConnector[connectorId] ?? STOP_CAUSE_OPTIONS[0];
    setPending(connectorId);
    setError(null);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/session/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopCause }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to stop session");
        return;
      }
      setSummary(data.summary);
      await Promise.all([loadConnectors(), loadSessions()]);
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
        <DeviceHeaderBar instanceId={instanceId} title={instanceName ?? "Cost / session history"} />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Cost / session history</h1>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Simulate a charging session</h2>
            <p className="text-xs text-zinc-500">
              Start a session on a connector, then stop it to see the Cost row and post-charge popup.
            </p>
            {connectors === null ? (
              <p className="text-sm text-zinc-500">Loading connectors…</p>
            ) : (
              <div className="flex flex-col gap-3">
                {connectors.map((connector) => (
                  <div
                    key={connector.connectorId}
                    className="flex flex-wrap items-center gap-3 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                  >
                    <span className="font-medium">{connector.label ?? `Connector ${connector.connectorId}`}</span>
                    <span className="text-xs text-zinc-500">{connector.status}</span>

                    {connector.activeSession ? (
                      <>
                        <span className="text-xs text-zinc-500">
                          card {connector.activeSession.idTag} ·{" "}
                          {(connector.activeSession.currentEnergyWh / 1000).toFixed(3)} kWh so far
                        </span>
                        <select
                          value={stopCauseByConnector[connector.connectorId] ?? STOP_CAUSE_OPTIONS[0]}
                          onChange={(e) =>
                            setStopCauseByConnector((prev) => ({ ...prev, [connector.connectorId]: e.target.value }))
                          }
                          className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        >
                          {STOP_CAUSE_OPTIONS.map((cause) => (
                            <option key={cause} value={cause}>
                              {cause}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={pending === connector.connectorId}
                          onClick={() => handleStop(connector.connectorId)}
                          className="rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                        >
                          Stop
                        </button>
                      </>
                    ) : connector.status === "Available" ? (
                      <>
                        <input
                          type="text"
                          placeholder="Card number (idTag)"
                          value={idTagByConnector[connector.connectorId] ?? ""}
                          onChange={(e) =>
                            setIdTagByConnector((prev) => ({ ...prev, [connector.connectorId]: e.target.value }))
                          }
                          className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <input
                          type="number"
                          min="0.1"
                          step="0.1"
                          placeholder="kW"
                          value={rateByConnector[connector.connectorId] ?? "7"}
                          onChange={(e) =>
                            setRateByConnector((prev) => ({ ...prev, [connector.connectorId]: e.target.value }))
                          }
                          className="w-20 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                        />
                        <button
                          type="button"
                          disabled={pending === connector.connectorId}
                          onClick={() => handleStart(connector.connectorId)}
                          className="rounded-md bg-black px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                        >
                          Start
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-zinc-400">
                        Not available for a new session — see the Lock screen if it&apos;s Faulted or locked.
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {result === null ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-50 text-xs uppercase text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                    <tr>
                      <th className="px-3 py-2 font-medium">S.N</th>
                      <th className="px-3 py-2 font-medium">Gun ID</th>
                      <th className="px-3 py-2 font-medium">User Card NO.</th>
                      <th className="px-3 py-2 font-medium">Start Time</th>
                      <th className="px-3 py-2 font-medium">Stop Time</th>
                      <th className="px-3 py-2 font-medium">Charging Energy(kWh)</th>
                      <th className="px-3 py-2 font-medium">Power Usage({result.items[0]?.currency ?? "currency"})</th>
                      <th className="px-3 py-2 font-medium">Stop Cause</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {result.items.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                          No completed sessions yet.
                        </td>
                      </tr>
                    ) : (
                      result.items.map((session, idx) => (
                        <tr key={session.id}>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-500">
                            {String((result.page - 1) * PAGE_SIZE + idx + 1).padStart(4, "0")}
                          </td>
                          <td className="px-3 py-2">{session.connectorLabel ?? session.connectorId}</td>
                          <td className="px-3 py-2 font-mono text-xs">{session.idTag}</td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                            {formatDateTime(session.startedAt)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                            {formatDateTime(session.stoppedAt)}
                          </td>
                          <td className="px-3 py-2">{(session.energyWh / 1000).toFixed(3)}</td>
                          <td className="px-3 py-2">{session.cost.toFixed(2)}</td>
                          <td className="px-3 py-2">{session.stopCause}</td>
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

        <DeviceBottomNav instanceId={instanceId} active="Cost" />
      </DeviceScreenFrame>

      {summary ? <PostChargeSummaryModal summary={summary} onClose={() => setSummary(null)} /> : null}
    </div>
  );
}
