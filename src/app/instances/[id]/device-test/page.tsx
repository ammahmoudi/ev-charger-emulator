"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import { ActionButtonGroup, Readout } from "@/components/device-test/Readout";
import type {
  ChargingOutputMode,
  HardwareTestState,
  PileContactorTarget,
  PlugTestState,
} from "@/lib/device-instances/hardware-test-types";

const POLL_INTERVAL_MS = 2000;

type TabKey = "chargingTest" | "pile" | `plug:${number}`;

export default function DeviceTestPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [state, setState] = useState<HardwareTestState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("chargingTest");
  const [pending, setPending] = useState(false);
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
    const res = await fetch(`/api/device-instances/${instanceId}/device-test`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    if (!res.ok) {
      setError("Failed to load hardware test state");
      return;
    }
    const data = await res.json();
    setState(data.state);
    setError(null);
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    load();
    pollRef.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [load]);

  async function runAction(body: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/device-test/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        setError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Action failed");
      }
    } finally {
      setPending(false);
    }
  }

  async function updateSettings(body: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/device-test`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data.state);
        setError(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to update settings");
      }
    } finally {
      setPending(false);
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

  if (!state) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  const tabs: { key: TabKey; label: string }[] = [
    { key: "chargingTest", label: "Charging Test" },
    ...state.plugs.map((plug) => ({ key: `plug:${plug.connectorId}` as TabKey, label: `${plug.label} Test` })),
    { key: "pile", label: "Charging Pile Test" },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
        ← {instanceName ?? "Instance"}
      </Link>

      <DeviceScreenFrame>
        <DeviceHeaderBar instanceId={instanceId} title={instanceName ?? "Device (hardware test)"} />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold text-black dark:text-zinc-50">Device (hardware test)</h1>
            <p className="text-sm text-zinc-500">Manual hardware diagnostics.</p>
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="flex flex-wrap gap-2 border-b border-zinc-200 pb-2 dark:border-zinc-800">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  tab === t.key
                    ? "bg-black text-white dark:bg-white dark:text-black"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "chargingTest" ? (
            <ChargingTestTab state={state} pending={pending} runAction={runAction} updateSettings={updateSettings} />
          ) : tab === "pile" ? (
            <PileTestTab state={state} pending={pending} runAction={runAction} />
          ) : (
            <PlugTestTab
              plug={state.plugs.find((p) => `plug:${p.connectorId}` === tab)!}
              pending={pending}
              runAction={runAction}
            />
          )}
        </div>

        <DeviceBottomNav instanceId={instanceId} active="Device" />
      </DeviceScreenFrame>
    </div>
  );
}

interface TabProps {
  pending: boolean;
  runAction: (body: Record<string, unknown>) => Promise<void>;
}

function ChargingTestTab({
  state,
  pending,
  runAction,
  updateSettings,
}: TabProps & { state: HardwareTestState; updateSettings: (body: Record<string, unknown>) => Promise<void> }) {
  const selected = state.plugs.find((p) => p.connectorId === state.chargingTest.selectedConnectorId) ?? state.plugs[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {state.plugs.map((plug) => (
          <div key={plug.connectorId} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{plug.label}</span>
            <div className="grid grid-cols-2 gap-2">
              <Readout label="Output voltage" value={plug.outputVoltageV} unit="V" />
              <Readout label="Output current" value={plug.outputCurrentA} unit="A" />
            </div>
            <span className="text-xs text-zinc-500">{plug.outputRunning ? "Test running" : "Idle"}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-44 shrink-0 text-sm text-zinc-700 dark:text-zinc-300">Plug select</span>
          <select
            disabled={pending}
            value={state.chargingTest.selectedConnectorId}
            onChange={(e) => updateSettings({ selectedConnectorId: Number(e.target.value) })}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {state.plugs.map((plug) => (
              <option key={plug.connectorId} value={plug.connectorId}>
                {plug.label}
              </option>
            ))}
          </select>
        </div>

        <ActionButtonGroup
          label="Start/stop test"
          disabled={pending}
          activeValue={selected?.outputRunning ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => runAction({ kind: "chargingTest", connectorId: selected.connectorId, action: value })}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-44 shrink-0 text-sm text-zinc-700 dark:text-zinc-300">Interface board Test mode</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => updateSettings({ interfaceBoardTestMode: !state.chargingTest.interfaceBoardTestMode })}
            className={`rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
              state.chargingTest.interfaceBoardTestMode
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {state.chargingTest.interfaceBoardTestMode ? "On" : "Off"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-44 shrink-0 text-sm text-zinc-700 dark:text-zinc-300">Output mode</span>
          <select
            disabled={pending}
            value={state.chargingTest.outputMode}
            onChange={(e) => updateSettings({ outputMode: e.target.value as ChargingOutputMode })}
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="FullLoadOutput">Full load output</option>
            <option value="HalfLoadOutput">Half load output</option>
          </select>
        </div>
      </div>
    </div>
  );
}

function PlugTestTab({ plug, pending, runAction }: TabProps & { plug: PlugTestState }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Readout label="CC1 status" value={plug.cc1} />
        <Readout label="CC2 status" value={plug.cc2} />
        <Readout label="KM1 status" value={plug.km1} />
        <Readout label="KM2 status" value={plug.km2} />
        <Readout label="Plug position" value={plug.plugPosition} />
        <Readout label="Fuse status" value={plug.fuseStatus} />
        <Readout label="Assist power supply status" value={plug.assistPowerStatus} />
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <ActionButtonGroup
          label="Contactor action"
          disabled={pending}
          activeValue={plug.outputRunning ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => runAction({ kind: "contactor", connectorId: plug.connectorId, action: value })}
        />
        <ActionButtonGroup
          label="Auxiliary power action"
          disabled={pending}
          activeValue={plug.auxPowerMode === "Off" ? "stop" : plug.auxPowerMode}
          options={[
            { value: "12V", label: "12V" },
            { value: "24V", label: "24V" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => runAction({ kind: "auxPower", connectorId: plug.connectorId, action: value })}
        />
        <ActionButtonGroup
          label="Electronic lock action"
          disabled={pending}
          activeValue={plug.lockStatus === "Locked" ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => runAction({ kind: "lock", connectorId: plug.connectorId, action: value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-4 sm:grid-cols-3 dark:border-zinc-800">
        <Readout label="Electronic lock status" value={plug.lockStatus} />
        <Readout label="Meter status" value={plug.meterStatus} />
        <Readout label="Communication status" value={plug.commStatus} />
        <Readout label="Insulation resistance" value={plug.insulationResistanceKOhm} unit="kΩ" />
        <Readout label="Interface temperature 1" value={plug.interfaceTemp1C} unit="°C" />
        <Readout label="Interface temperature 2" value={plug.interfaceTemp2C} unit="°C" />
        <Readout label="AD sampling voltage" value={plug.adSamplingVoltageV} unit="V" />
        <Readout label="CC voltage" value={plug.ccVoltageV} unit="V" />
      </div>
    </div>
  );
}

function PileTestTab({ state, pending, runAction }: TabProps & { state: HardwareTestState }) {
  const pile = state.pile;

  function pileAction(target: PileContactorTarget, value: string) {
    return runAction({ kind: "pileContactor", target, action: value });
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Readout label="Circuit breaker status" value={pile.breakerStatus} />
        <Readout label="Power contactor status" value={pile.powerContactor} />
        <Readout label="GPRS status" value={pile.gprsStatus} />
        <Readout label="GPRS signal" value={pile.gprsSignalPercent} unit="%" />
        <Readout label="Temperature 1" value={pile.temp1C} unit="°C" />
        <Readout label="Temperature 2" value={pile.temp2C} unit="°C" />
        <Readout label="Temperature 3" value={pile.temp3C} unit="°C" />
        <Readout label="Temperature 4" value={pile.temp4C} unit="°C" />
      </div>

      <div className="flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <ActionButtonGroup
          label="Three-phase AC contactor"
          disabled={pending}
          activeValue={pile.threePhaseAcContactor === "Closed" ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => pileAction("threePhaseAcContactor", value)}
        />
        <ActionButtonGroup
          label="Power contactor"
          disabled={pending}
          activeValue={pile.powerContactor === "Closed" ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => pileAction("powerContactor", value)}
        />
        <ActionButtonGroup
          label="Fan contactor"
          disabled={pending}
          activeValue={pile.fanContactor === "Closed" ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => pileAction("fanContactor", value)}
        />
        <ActionButtonGroup
          label="QF operate"
          disabled={pending}
          activeValue={pile.breakerStatus === "Closed" ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => pileAction("breaker", value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-4 sm:grid-cols-3 dark:border-zinc-800">
        <Readout label="Relative humidity" value={pile.humidityPercent} unit="%" />
        <Readout label="Module status" value={pile.moduleStatus} />
        <Readout label="Uab voltage" value={pile.uabVoltageV} unit="V" />
        <Readout label="Ubc voltage" value={pile.ubcVoltageV} unit="V" />
        <Readout label="Uca voltage" value={pile.ucaVoltageV} unit="V" />
        <Readout label="ICCID" value={pile.iccid} />
        <Readout label="IMEI" value={pile.imei} />
      </div>
    </div>
  );
}
