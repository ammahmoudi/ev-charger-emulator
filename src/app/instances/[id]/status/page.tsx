"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { BlueButton, Cell, ScreenPanel } from "@/components/device-instances/DeviceScreenParts";
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
        <DeviceHeaderBar instanceId={instanceId} title={header.name} showSerial />

        <ScreenPanel>
          <div className="grid flex-1 grid-cols-2 content-start gap-x-[16px] px-[16px] pt-[16px]">
            <div className="flex flex-col">
              <DiagnosticField label="Over voltage of Power Supply:" value={LABELS[overall.powerSupplyOverVoltage]} status={overall.powerSupplyOverVoltage} onToggle={(next) => toggle("powerSupplyOverVoltage", next)} />
              <DiagnosticField label="Under voltage of Power Supply:" value={LABELS[overall.powerSupplyUnderVoltage]} status={overall.powerSupplyUnderVoltage} onToggle={(next) => toggle("powerSupplyUnderVoltage", next)} />
              <DiagnosticField label="Temperature of Equipment:" value={LABELS[overall.equipmentTemperature]} status={overall.equipmentTemperature} onToggle={(next) => toggle("equipmentTemperature", next)} />
              <DiagnosticField label="Circuit breaker Status:" value={LABELS[overall.circuitBreakerStatus]} status={overall.circuitBreakerStatus} onToggle={(next) => toggle("circuitBreakerStatus", next)} />
              <DiagnosticField label="Emergency:" value={LABELS[overall.emergency]} status={overall.emergency} onToggle={(next) => toggle("emergency", next)} />
              <div className="grid grid-cols-2">
                <Cell label="Main program version:" className="flex-col !items-start !justify-center !gap-0">
                  <span className="text-[26px]">{overall.mainProgramVersion}</span>
                </Cell>
                <Cell label="Interface program version:" className="flex-col !items-start !justify-center !gap-0">
                  <span className="text-[26px]">{overall.interfaceProgramVersion}</span>
                </Cell>
              </div>
            </div>
            <div className="flex flex-col">
              <DiagnosticField label="Card Detector:" value={LABELS[overall.cardDetector]} status={overall.cardDetector} onToggle={(next) => toggle("cardDetector", next)} />
              <Cell label="Contactor status:">
                <Link href={`/instances/${instanceId}/status/contactor`} className="text-[26px] text-[#1f7fe0]" style={{ fontFamily: "inherit" }}>
                  Details
                </Link>
              </Cell>
              <DiagnosticField label="Control System:" value={LABELS[overall.controlSystem]} status={overall.controlSystem} onToggle={(next) => toggle("controlSystem", next)} />
              <DiagnosticField label="Cabinet Door:" value={LABELS[overall.cabinetDoor]} status={overall.cabinetDoor} onToggle={(next) => toggle("cabinetDoor", next)} />
              <div className="grid grid-cols-2">
                <DiagnosticField label="SPD:" value={LABELS[overall.spd]} status={overall.spd} onToggle={(next) => toggle("spd", next)} />
                <DiagnosticField label="Storage state:" value={LABELS[overall.storageState]} status={overall.storageState} onToggle={(next) => toggle("storageState", next)} />
              </div>
              <DiagnosticField label="Communication of Charge Module:" value={LABELS[overall.communicationOfChargeModule]} status={overall.communicationOfChargeModule} onToggle={(next) => toggle("communicationOfChargeModule", next)} detailsHref={`/instances/${instanceId}/status/communication`} />
            </div>
          </div>

          {connectors.length > 0 ? (
            <div className="flex flex-none justify-center gap-[18px] pb-[18px] pt-[6px]">
              {/* Outside-in order (details, unlock, …, unlock, details) — matches the real device's row
                  (screenshots/02-status-diagnostics.png): outlined "details" pills outside, filled "unlock" pills inside. */}
              {buildOutsideInButtons(connectors).map(({ connector, kind }) => {
                const runtime = runtimeByOrder.get(connector.id);
                const label = connectorDisplayLabel(connector);
                if (kind === "details") {
                  return (
                    <Link key={`${connector.id}-details`} href={`/instances/${instanceId}/status/plugs/${connector.id}`} className="rounded-[8px] border-2 border-[#3b8fe8] bg-white px-[22px] py-[6px] text-[26px] font-medium text-[#1f7fe0]">
                      {label} details
                    </Link>
                  );
                }
                if (!runtime) return null;
                return (
                  <BlueButton key={`${connector.id}-unlock`} disabled={!runtime.locked || pendingUnlock === runtime.connectorId} onClick={() => handleUnlock(runtime.connectorId)}>
                    {label} unlock
                  </BlueButton>
                );
              })}
            </div>
          ) : null}
        </ScreenPanel>
      </DeviceScreenFrame>
    </div>
  );
}
