"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DiagnosticField } from "@/components/device-instances/DiagnosticField";
import { connectorDisplayLabel, type ContactStatus, type HealthStatus, type InterfaceBoardView } from "@/lib/device-instances/diagnostics-types";
import { useDeviceInstanceConnectors } from "@/lib/device-instances/useDeviceInstanceConnectors";

type ToggleField = "seccCommunication" | "meterCommunication" | "interfaceBoardCommunication" | "fuseStatus";
type ContactorField = "km1Status" | "km2Status";

export default function PlugInterfaceBoardPage() {
  const params = useParams<{ id: string; connectorId: string }>();
  const instanceId = params.id;
  const connectorId = params.connectorId;
  const { connectors, notFound } = useDeviceInstanceConnectors(instanceId);

  const [board, setBoard] = useState<InterfaceBoardView | null>(null);
  const [boardMissing, setBoardMissing] = useState(false);

  async function load() {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/plugs/${connectorId}`);
    if (res.status === 404) {
      setBoardMissing(true);
      return;
    }
    const data = await res.json();
    setBoard(data.interfaceBoard);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, connectorId]);

  async function toggleHealth(field: ToggleField, next: HealthStatus) {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/plugs/${connectorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value: next }),
    });
    if (res.ok) setBoard((await res.json()).interfaceBoard);
  }

  async function toggleContact(field: ContactorField, current: ContactStatus) {
    const next: ContactStatus = current === "open" ? "closed" : "open";
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/plugs/${connectorId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value: next }),
    });
    if (res.ok) setBoard((await res.json()).interfaceBoard);
  }

  const connector = connectors?.find((c) => c.id === connectorId) ?? null;
  const plugLabel = connector ? connectorDisplayLabel(connector) : "Plug";

  if (notFound || boardMissing) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Connector not found on this instance.</p>
        <Link href={`/instances/${instanceId}/status`} className="text-sm underline">
          Back to status
        </Link>
      </div>
    );
  }

  if (!board) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link href={`/instances/${instanceId}/status`} className="text-xs text-zinc-500 hover:underline">
          ← Status / diagnostics
        </Link>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">{plugLabel} interface board</h1>
      </div>

      <p className="text-xs text-zinc-500">
        Click any status value to inject/clear a fault for testing — faulted fields render red. KM1/KM2 toggle between open and closed.
      </p>

      <div className="grid grid-cols-1 gap-x-10 divide-y divide-zinc-200 rounded-lg border border-zinc-200 px-4 sm:grid-cols-2 sm:divide-y-0 dark:divide-zinc-800 dark:border-zinc-800">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <DiagnosticField label="AD Sampling voltage (V)" value={board.adSamplingVoltage.toFixed(1)} />
          <DiagnosticField
            label="SECC communication"
            value={board.seccCommunication}
            status={board.seccCommunication}
            onToggle={(next) => toggleHealth("seccCommunication", next)}
          />
          <DiagnosticField label="Temperature sampling1 (°C)" value={String(board.temperatureSampling1)} />
          <DiagnosticField label="Temperature sampling2 (°C)" value={String(board.temperatureSampling2)} />
          <DiagnosticField
            label="Meter communication"
            value={board.meterCommunication}
            status={board.meterCommunication}
            onToggle={(next) => toggleHealth("meterCommunication", next)}
          />
          <DiagnosticField label="PLC Error code" value={board.plcErrorCode} />
        </div>

        <div className="divide-y divide-zinc-200 pt-4 sm:pt-0 dark:divide-zinc-800">
          <DiagnosticField
            label="Interface board communication"
            value={board.interfaceBoardCommunication}
            status={board.interfaceBoardCommunication}
            onToggle={(next) => toggleHealth("interfaceBoardCommunication", next)}
          />
          <DiagnosticField label="Fuse status" value={board.fuseStatus} status={board.fuseStatus} onToggle={(next) => toggleHealth("fuseStatus", next)} />
          <DiagnosticField label="EV Error code" value={String(board.evErrorCode)} />
          <DiagnosticField label="KM1 status" value={board.km1Status} onToggle={() => toggleContact("km1Status", board.km1Status)} />
          <DiagnosticField label="KM2 status" value={board.km2Status} onToggle={() => toggleContact("km2Status", board.km2Status)} />
          <DiagnosticField label="CC voltage (V)" value={board.ccVoltage.toFixed(2)} />
          <DiagnosticField label="Energy total (kWh)" value={board.energyTotal.toFixed(3)} />
        </div>
      </div>
    </div>
  );
}
