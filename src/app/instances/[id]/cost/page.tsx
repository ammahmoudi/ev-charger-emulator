"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceTable } from "@/components/device-instances/DeviceTable";
import { ScreenPanel, VALUE_FONT } from "@/components/device-instances/DeviceScreenParts";
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
  const [showSim, setShowSim] = useState(false);
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

        <ScreenPanel>
          {error ? <p className="px-4 pt-2 text-[20px] text-[#e5302b]">{error}</p> : null}
          {showSim ? (
          <div className="mx-[14px] mb-[8px] flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 text-[20px]">
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
          ) : null}
          {result === null ? (
            <p className="p-6 text-[24px] text-[#888]">Loading…</p>
          ) : (
            <>
              <DeviceTable
                minRows={5}
                columns={[
                  { label: "S.N", width: "76px" },
                  { label: "Gun ID", width: "70px" },
                  { label: "User Card NO.", width: "1.2fr" },
                  { label: "Start Time", width: "1.3fr" },
                  { label: "Stop Time", width: "1.3fr" },
                  { label: "Charging Energy(kWh)", width: "1fr" },
                  { label: `Power Usage(${result.items[0]?.currency ?? "currency"})`, width: "1fr" },
                  { label: "Stop Cause", width: "1fr" },
                ]}
                rows={result.items.map((session, idx) => [
                  <span key="n" style={{ fontFamily: VALUE_FONT }}>{String((result.page - 1) * PAGE_SIZE + idx + 1).padStart(4, "0")}</span>,
                  <span key="g">{session.connectorLabel?.trim().slice(-1) ?? session.connectorId}</span>,
                  <span key="c" className="text-[22px]">{session.idTag}</span>,
                  <span key="s" className="text-[20px]" style={{ fontFamily: VALUE_FONT }}>{formatDateTime(session.startedAt)}</span>,
                  <span key="e" className="text-[20px]" style={{ fontFamily: VALUE_FONT }}>{formatDateTime(session.stoppedAt)}</span>,
                  <span key="k" style={{ fontFamily: VALUE_FONT }}>{(session.energyWh / 1000).toFixed(3)}</span>,
                  <span key="p" style={{ fontFamily: VALUE_FONT }}>{session.cost.toFixed(2)}</span>,
                  <span key="x" className="text-[22px]">{session.stopCause}</span>,
                ])}
              />
              <Pagination page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
            </>
          )}
          <button type="button" onClick={() => setShowSim((v) => !v)} className="absolute bottom-[8px] left-[40px] text-[16px] text-[#b5bcc5] hover:text-[#1f7fe0]">
            {showSim ? "hide simulator" : "simulate session…"}
          </button>
        </ScreenPanel>

        <DeviceBottomNav instanceId={instanceId} active="Cost" />
      </DeviceScreenFrame>

      {summary ? <PostChargeSummaryModal summary={summary} onClose={() => setSummary(null)} /> : null}
    </div>
  );
}
