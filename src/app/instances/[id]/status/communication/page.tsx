"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ScreenPanel, VALUE_FONT } from "@/components/device-instances/DeviceScreenParts";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import { connectorDisplayLabel, type CommunicationModuleView, type HealthStatus } from "@/lib/device-instances/diagnostics-types";
import { useDeviceInstanceConnectors } from "@/lib/device-instances/useDeviceInstanceConnectors";

export default function CommunicationPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;
  const { header, connectors, notFound } = useDeviceInstanceConnectors(instanceId);

  const [modules, setModules] = useState<CommunicationModuleView[] | null>(null);
  const [plugOutputCurrents, setPlugOutputCurrents] = useState<Record<string, number>>({});

  async function load(connectorIds: string[]) {
    const query = connectorIds.map((id) => `connectorId=${encodeURIComponent(id)}`).join("&");
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/communication${query ? `?${query}` : ""}`);
    if (!res.ok) return;
    const data = await res.json();
    setModules(data.modules);
    setPlugOutputCurrents(data.plugOutputCurrents);
  }

  useEffect(() => {
    if (!connectors) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch once connector ids are known, not derived state
    load(connectors.map((c) => c.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, connectors]);

  async function toggleModule(index: number, next: HealthStatus) {
    const res = await fetch(`/api/device-instances/${instanceId}/diagnostics/communication`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleIndex: index, value: next }),
    });
    if (res.ok) setModules((await res.json()).modules);
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

  if (!header || !modules || !connectors) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <Link href={`/instances/${instanceId}/status`} className="text-xs text-zinc-500 hover:underline">
        ← Status / diagnostics
      </Link>

      {/* This drill-down screen has no bottom nav on the real device either — reached only via
          the back arrow above, not one of the bottom nav's own tabs (see
          docs/device-reference/PEVC3107E/screenshots/03-communication.png). */}
      <DeviceScreenFrame>
        <DeviceHeaderBar instanceId={instanceId} title={header.name} showSerial />

        <ScreenPanel title="Communication">
          <div className="grid flex-none grid-cols-7 gap-x-[8px] gap-y-[6px] px-[14px]">
            {modules.map((module, index) => (
              <div key={index} className="flex flex-col bg-[#f3f3f3] px-[8px] pb-[8px] pt-[2px]">
                <button
                  type="button"
                  onClick={() => toggleModule(index, module.comm === "normal" ? "abnormal" : "normal")}
                  title="Click to toggle fault injection"
                  className={`self-start text-[26px] leading-[30px] ${module.comm === "abnormal" ? "text-[#e5302b]" : "text-[#555]"}`}
                >
                  G
                </button>
                <div className="flex justify-between text-[26px] leading-[32px] text-[#555]">
                  <span>V</span>
                  <span style={{ fontFamily: VALUE_FONT }}>{module.voltage.toFixed(1)}</span>
                </div>
                <div className="flex justify-between text-[26px] leading-[32px] text-[#555]">
                  <span>A</span>
                  <span style={{ fontFamily: VALUE_FONT }}>{module.current.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>

          {connectors.length > 0 ? (
            <div className="mt-auto flex flex-none justify-between px-[24px] pb-[12px] pt-[8px] text-[24px] text-[#9a9a9a]">
              {connectors.map((connector) => (
                <div key={connector.id}>
                  {connectorDisplayLabel(connector).toLowerCase()} output current(A):{" "}
                  <span className="text-[#555]" style={{ fontFamily: VALUE_FONT }}>{(plugOutputCurrents[connector.id] ?? 0).toFixed(1)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </ScreenPanel>
      </DeviceScreenFrame>
    </div>
  );
}
