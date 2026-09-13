"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DiagnosticField } from "@/components/device-instances/DiagnosticField";
import { connectorDisplayLabel, type HealthStatus, type OverallHealthView } from "@/lib/device-instances/diagnostics-types";
import { useDeviceInstanceConnectors } from "@/lib/device-instances/useDeviceInstanceConnectors";

const LABELS: Record<string, string> = {
  normal: "normal",
  abnormal: "abnormal",
};

export default function StatusDiagnosticsPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;
  const { header, connectors, notFound } = useDeviceInstanceConnectors(instanceId);

  const [overall, setOverall] = useState<OverallHealthView | null>(null);

  async function load() {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics`);
    if (!res.ok) return;
    const data = await res.json();
    setOverall(data.overall);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  async function toggle(field: keyof OverallHealthView, next: HealthStatus) {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ field, value: next }),
    });
    if (res.ok) {
      const data = await res.json();
      setOverall(data.overall);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Device instance not found.</p>
        <Link href="/instances" className="text-sm underline">
          Back to instances
        </Link>
      </div>
    );
  }

  if (!header || !overall || !connectors) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
          ← {header.name}
        </Link>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Status / diagnostics</h1>
        <p className="text-sm text-zinc-500">{header.deviceModelLabel}</p>
      </div>

      <p className="text-xs text-zinc-500">
        Simulated component health. Click any value below to inject/clear a fault for testing — faulted fields render red.
      </p>

      <div className="grid grid-cols-1 gap-x-10 divide-y divide-zinc-200 rounded-lg border border-zinc-200 px-4 sm:grid-cols-2 sm:divide-y-0 dark:divide-zinc-800 dark:border-zinc-800">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          <DiagnosticField
            label="Over voltage of Power Supply"
            value={LABELS[overall.powerSupplyOverVoltage]}
            status={overall.powerSupplyOverVoltage}
            onToggle={(next) => toggle("powerSupplyOverVoltage", next)}
          />
          <DiagnosticField
            label="Under voltage of Power Supply"
            value={LABELS[overall.powerSupplyUnderVoltage]}
            status={overall.powerSupplyUnderVoltage}
            onToggle={(next) => toggle("powerSupplyUnderVoltage", next)}
          />
          <DiagnosticField
            label="Temperature of Equipment"
            value={LABELS[overall.equipmentTemperature]}
            status={overall.equipmentTemperature}
            onToggle={(next) => toggle("equipmentTemperature", next)}
          />
          <DiagnosticField
            label="Circuit breaker Status"
            value={LABELS[overall.circuitBreakerStatus]}
            status={overall.circuitBreakerStatus}
            onToggle={(next) => toggle("circuitBreakerStatus", next)}
          />
          <DiagnosticField label="Emergency" value={LABELS[overall.emergency]} status={overall.emergency} onToggle={(next) => toggle("emergency", next)} />
          <div className="flex justify-between gap-4 py-1.5 text-sm">
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Main program version: </span>
              <span className="font-medium text-black dark:text-zinc-50">{overall.mainProgramVersion}</span>
            </div>
          </div>
        </div>

        <div className="divide-y divide-zinc-200 pt-4 sm:pt-0 dark:divide-zinc-800">
          <DiagnosticField label="Card Detector" value={LABELS[overall.cardDetector]} status={overall.cardDetector} onToggle={(next) => toggle("cardDetector", next)} />
          <DiagnosticField
            label="Contactor status"
            value={LABELS[overall.contactorStatus]}
            status={overall.contactorStatus}
            onToggle={(next) => toggle("contactorStatus", next)}
            detailsHref={`/instances/${instanceId}/status/contactor`}
          />
          <DiagnosticField label="Control System" value={LABELS[overall.controlSystem]} status={overall.controlSystem} onToggle={(next) => toggle("controlSystem", next)} />
          <DiagnosticField label="Cabinet Door" value={LABELS[overall.cabinetDoor]} status={overall.cabinetDoor} onToggle={(next) => toggle("cabinetDoor", next)} />
          <DiagnosticField label="SPD" value={LABELS[overall.spd]} status={overall.spd} onToggle={(next) => toggle("spd", next)} />
          <DiagnosticField label="Storage state" value={LABELS[overall.storageState]} status={overall.storageState} onToggle={(next) => toggle("storageState", next)} />
          <DiagnosticField
            label="Communication of Charge Module"
            value={LABELS[overall.communicationOfChargeModule]}
            status={overall.communicationOfChargeModule}
            onToggle={(next) => toggle("communicationOfChargeModule", next)}
            detailsHref={`/instances/${instanceId}/status/communication`}
          />
          <div className="flex justify-between gap-4 py-1.5 text-sm">
            <div>
              <span className="text-zinc-600 dark:text-zinc-400">Interface program version: </span>
              <span className="font-medium text-black dark:text-zinc-50">{overall.interfaceProgramVersion}</span>
            </div>
          </div>
        </div>
      </div>

      {connectors.length > 0 ? (
        <div className="flex flex-wrap gap-3">
          {connectors.map((connector) => (
            <Link
              key={connector.id}
              href={`/instances/${instanceId}/status/plugs/${connector.id}`}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {connectorDisplayLabel(connector)} details
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
