"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DiagnosticField } from "@/components/device-instances/DiagnosticField";
import { connectorDisplayLabel, type ConnectorView, type ContactStatus, type InterfaceBoardView } from "@/lib/device-instances/diagnostics-types";
import { useDeviceInstanceConnectors } from "@/lib/device-instances/useDeviceInstanceConnectors";

/** Contactor status "Details" drill-down: KM1/KM2 relay state per plug, sourced from the same interface-board state shown on each plug's detail screen. */
export default function ContactorStatusPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;
  const { connectors, notFound } = useDeviceInstanceConnectors(instanceId);

  const [boards, setBoards] = useState<Record<string, InterfaceBoardView>>({});

  async function loadBoard(connectorId: string) {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/plugs/${connectorId}`);
    if (!res.ok) return;
    const data = await res.json();
    setBoards((prev) => ({ ...prev, [connectorId]: data.interfaceBoard }));
  }

  useEffect(() => {
    if (!connectors) return;
    for (const connector of connectors) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch once connector ids are known, not derived state
      loadBoard(connector.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, connectors]);

  async function toggle(connectorId: string, field: "km1Status" | "km2Status", current: ContactStatus) {
    const next: ContactStatus = current === "open" ? "closed" : "open";
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/plugs/${connectorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value: next }),
    });
    if (res.ok) {
      const data = await res.json();
      setBoards((prev) => ({ ...prev, [connectorId]: data.interfaceBoard }));
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Device instance not found.</p>
        <Link href="/instances" className="text-sm underline">
          Back to instances
        </Link>
      </div>
    );
  }

  if (!connectors) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link href={`/instances/${instanceId}/status`} className="text-xs text-zinc-500 hover:underline">
          ← Status / diagnostics
        </Link>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Contactor status</h1>
        <p className="text-sm text-zinc-500">KM1/KM2 relay state per plug. Click a value to toggle it.</p>
      </div>

      <div className="flex flex-col gap-4">
        {connectors.map((connector: ConnectorView) => {
          const board = boards[connector.id];
          return (
            <div key={connector.id} className="rounded-lg border border-zinc-200 px-4 dark:border-zinc-800">
              <h2 className="pt-3 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{connectorDisplayLabel(connector)}</h2>
              {board ? (
                <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
                  <DiagnosticField label="KM1 status" value={board.km1Status} onToggle={() => toggle(connector.id, "km1Status", board.km1Status)} />
                  <DiagnosticField label="KM2 status" value={board.km2Status} onToggle={() => toggle(connector.id, "km2Status", board.km2Status)} />
                </div>
              ) : (
                <p className="py-3 text-sm text-zinc-500">Loading…</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
