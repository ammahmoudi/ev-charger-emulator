"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { DiagnosticField } from "@/components/device-instances/DiagnosticField";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import {
  buildOutsideInButtons,
  connectorDisplayLabel,
  orderConnectorsByEvse,
  type HealthStatus,
  type OverallHealthView,
} from "@/lib/device-instances/diagnostics-types";
import type { ConnectorRuntimeView } from "@/lib/device-instances/types";
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
  const [runtimeConnectors, setRuntimeConnectors] = useState<ConnectorRuntimeView[] | null>(null);
  const [pendingUnlock, setPendingUnlock] = useState<number | null>(null);

  async function load() {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics`);
    if (!res.ok) return;
    const data = await res.json();
    setOverall(data.overall);
  }

  /**
   * The diagnostics screens address a connector by its DB `deviceModelConnector.id` (see
   * `useDeviceInstanceConnectors`), but the Lock action shares the numeric OCPP `connectorId`
   * scheme used everywhere else (Home/Cost/Lock) — loaded separately here and zipped with
   * `connectors` by (evseIndex, connectorIndex) order, which both endpoints agree on.
   */
  async function loadRuntimeConnectors() {
    const res = await fetch(`/api/device-instances/${instanceId}/connectors`);
    if (!res.ok) return;
    const data = await res.json();
    setRuntimeConnectors(data.connectors);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    load();
    loadRuntimeConnectors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const orderedConnectors = connectors ? orderConnectorsByEvse(connectors) : null;
  const runtimeByOrder = new Map(orderedConnectors?.map((c, i) => [c.id, runtimeConnectors?.[i]]));

  async function handleUnlock(connectorId: number) {
    setPendingUnlock(connectorId);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/lock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locked: false }),
      });
      if (res.ok) await loadRuntimeConnectors();
    } finally {
      setPendingUnlock(null);
    }
  }

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
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
        ← {header.name}
      </Link>

      <DeviceScreenFrame>
        <DeviceHeaderBar instanceId={instanceId} title={header.name} />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Status / diagnostics</h1>
            <p className="text-sm text-zinc-500">{header.deviceModelLabel}</p>
          </div>

          <p className="text-xs text-zinc-500">
            Simulated component health. Click any value below to inject/clear a fault for testing — faulted fields
            render red.
          </p>

          <div className="grid grid-cols-1 gap-x-10 divide-y divide-zinc-200 rounded-lg border border-zinc-200 bg-white px-4 sm:grid-cols-2 sm:divide-y-0 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
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
              {/* Outside-in order (details, unlock, …, unlock, details) and a uniform blue-pill
                  style for every button, matching the real device's row exactly — e.g. for two
                  connectors: "Plug A details, Plug A unlock, Plug B unlock, Plug B details" (see
                  docs/device-reference/PEVC3107E/screenshots/02-status-diagnostics.png). Degrades
                  reasonably for any other connector count (mirrors from both ends inward). */}
              {buildOutsideInButtons(connectors).map(({ connector, kind }) => {
                const runtime = runtimeByOrder.get(connector.id);
                const label = connectorDisplayLabel(connector);
                const pillClassName =
                  "rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-blue-700 dark:hover:bg-blue-600";
                if (kind === "details") {
                  return (
                    <Link key={`${connector.id}-details`} href={`/instances/${instanceId}/status/plugs/${connector.id}`} className={pillClassName}>
                      {label} details
                    </Link>
                  );
                }
                if (!runtime) return null;
                return (
                  <button
                    key={`${connector.id}-unlock`}
                    type="button"
                    disabled={!runtime.locked || pendingUnlock === runtime.connectorId}
                    onClick={() => handleUnlock(runtime.connectorId)}
                    className={pillClassName}
                  >
                    {label} unlock
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <DeviceBottomNav instanceId={instanceId} />
      </DeviceScreenFrame>
    </div>
  );
}
