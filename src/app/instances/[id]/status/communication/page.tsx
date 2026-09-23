"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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
        <DeviceHeaderBar instanceId={instanceId} title={header.name} />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Communication</h1>
            <p className="text-sm text-zinc-500">Per power-module communication status, voltage, and current.</p>
          </div>

          <p className="text-xs text-zinc-500">Click a module&apos;s status (&ldquo;G&rdquo;) to inject/clear a fault for testing — faulted modules render red.</p>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {modules.map((module, index) => (
              <div key={index} className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-900">
                <button
                  type="button"
                  onClick={() => toggleModule(index, module.comm === "normal" ? "abnormal" : "normal")}
                  title="Click to toggle fault injection"
                  className={`text-left font-semibold hover:underline ${module.comm === "abnormal" ? "text-red-600 dark:text-red-400" : "text-black dark:text-zinc-50"}`}
                >
                  G
                </button>
                <div className="text-zinc-600 dark:text-zinc-400">
                  V <span className="font-mono text-black dark:text-zinc-50">{module.voltage.toFixed(1)}</span>
                </div>
                <div className="text-zinc-600 dark:text-zinc-400">
                  A <span className="font-mono text-black dark:text-zinc-50">{module.current.toFixed(1)}</span>
                </div>
              </div>
            ))}
          </div>

          {connectors.length > 0 ? (
            <div className="flex flex-wrap gap-6 border-t border-zinc-200 pt-4 text-sm dark:border-zinc-800">
              {connectors.map((connector) => (
                <div key={connector.id} className="text-zinc-600 dark:text-zinc-400">
                  {connectorDisplayLabel(connector)} output current (A):{" "}
                  <span className="font-medium text-black dark:text-zinc-50">{(plugOutputCurrents[connector.id] ?? 0).toFixed(1)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DeviceScreenFrame>
    </div>
  );
}
