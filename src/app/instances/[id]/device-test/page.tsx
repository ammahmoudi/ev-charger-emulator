"use client";

import Link from "next/link";
import { getBmsReadouts } from "@/lib/device-instances/bms-readouts";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { ScreenPanel, TabStrip } from "@/components/device-instances/DeviceScreenParts";
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
    const refresh = () => load().catch(() => setError("Unable to load hardware test state. Retrying…"));
    refresh();
    pollRef.current = setInterval(refresh, POLL_INTERVAL_MS);
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
    } catch {
      setError("Unable to reach the device. Please try again.");
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
    } catch {
      setError("Unable to reach the device. Please try again.");
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
        <p role="status" className="text-sm text-zinc-500">{error ?? "Loading…"}</p>
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

        <ScreenPanel>
          {error ? <p role="alert" className="px-4 pt-1 text-[18px] text-[#e5302b]">{error}</p> : null}
          <TabStrip tabs={tabs} active={tab} onSelect={setTab} />
          <div className="min-h-0 flex-1 overflow-y-auto px-[14px] pt-[10px]">
          {tab === "chargingTest" ? (
            <ChargingTestTab state={state} pending={pending} runAction={runAction} updateSettings={updateSettings} />
          ) : tab === "pile" ? (
            <PileTestTab state={state} pending={pending} runAction={runAction} />
          ) : (
            <PlugTestTab
              key={tab}
              plug={state.plugs.find((p) => `plug:${p.connectorId}` === tab)!}
              pending={pending}
              runAction={runAction}
            />
          )}
          </div>
        </ScreenPanel>

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

      <div className="flex flex-col gap-3 border-t border-[#e3e6ea] pt-[10px]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-[230px] shrink-0 text-[22px] text-[#4a4a4a]">Plug select</span>
          <select
            disabled={pending}
            value={state.chargingTest.selectedConnectorId}
            onChange={(e) => updateSettings({ selectedConnectorId: Number(e.target.value) })}
            className="border-0 border-b border-dashed border-[#c5cbd3] bg-transparent px-2 py-0 text-[26px] text-[#222] focus:outline-none"
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
          <span className="w-[230px] shrink-0 text-[22px] text-[#4a4a4a]">Interface board Test mode</span>
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
          <span className="w-[230px] shrink-0 text-[22px] text-[#4a4a4a]">Output mode</span>
          <select
            disabled={pending}
            value={state.chargingTest.outputMode}
            onChange={(e) => updateSettings({ outputMode: e.target.value as ChargingOutputMode })}
            className="border-0 border-b border-dashed border-[#c5cbd3] bg-transparent px-2 py-0 text-[26px] text-[#222] focus:outline-none"
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
  const [page, setPage] = useState(0);
  const bmsPages = getBmsReadouts(plug);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[16px] text-slate-600">{page === 0 ? "Hardware controls" : `BMS · ${page === 1 ? "Battery parameters" : "Charging demand"}`} · Simulated test data</span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPage(page === 0 ? 1 : 0)} className="rounded border border-sky-700 px-3 py-1 text-[18px] text-sky-800 hover:bg-white">{page === 0 ? "BMS" : "Hardware"}</button>
          <button type="button" aria-label="Previous plug test page" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-10 w-10 rounded text-xl text-sky-700 hover:bg-white disabled:opacity-30">‹</button>
          <span className="text-[18px] tabular-nums">{page + 1} / 3</span>
          <button type="button" aria-label="Next plug test page" disabled={page === 2} onClick={() => setPage(page + 1)} className="h-10 w-10 rounded text-xl text-sky-700 hover:bg-white disabled:opacity-30">›</button>
        </div>
      </div>
      {page > 0 ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {bmsPages[page - 1].map((rows, index) => (
            <dl key={index} className="overflow-hidden rounded border border-slate-300 bg-white/60">
              {rows.map((row) => (
                <div key={row.label} className="grid min-h-[45px] grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 px-3 py-1 last:border-0">
                  <dt className="text-[20px] leading-[22px]">{row.label}:</dt>
                  <dd className="min-w-8 text-right font-mono text-[28px] tabular-nums text-slate-800">{row.value || "—"}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      ) : <PlugHardwarePanel plug={plug} pending={pending} runAction={runAction} />}
    </div>
  );
}

function PlugHardwarePanel({ plug, pending, runAction }: TabProps & { plug: PlugTestState }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <div className="flex flex-col">
        <Readout compact label="CC1 status" value={plug.cc1} />
        <Readout compact label="CC2 status" value={plug.cc2} />
        <Readout compact label="KM1 status" value={plug.km1} />
        <Readout compact label="KM2 status" value={plug.km2} />
        <Readout compact label="Plug position" value={plug.plugPosition} />
        <Readout compact label="Fuse status" value={plug.fuseStatus} />
        <Readout compact label="Assist power supply status" value={plug.assistPowerStatus} />
      </div>

      <div className="flex flex-col justify-center gap-5 px-2">
        <ActionButtonGroup
          compact
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
          compact
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
          compact
          label="Electronic lock action"
          disabled={pending}
          activeValue={plug.lockStatus === "Locked" ? "start" : "stop"}
          options={[
            { value: "start", label: "Start" },
            { value: "stop", label: "Stop" },
          ]}
          onAction={(value) => runAction({ kind: "lock", connectorId: plug.connectorId, action: value })}
        />
        <Readout compact label="CC voltage" value={plug.ccVoltageV.toFixed(2)} unit="V" />
      </div>

      <div className="flex flex-col">
        <Readout compact label="Electronic lock status" value={plug.lockStatus} />
        <Readout compact label="Meter status" value={plug.meterStatus} />
        <Readout compact label="Communication status" value={plug.commStatus} />
        <Readout compact label="Insulation resistance" value={plug.insulationResistanceKOhm} unit="kΩ" />
        <Readout compact label="Interface temperature 1" value={plug.interfaceTemp1C} unit="°C" />
        <Readout compact label="Interface temperature 2" value={plug.interfaceTemp2C} unit="°C" />
        <Readout compact label="AD sampling voltage" value={plug.adSamplingVoltageV} unit="V" />

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
      <div className="grid grid-cols-2 gap-2 ">
        <Readout label="Circuit breaker status" value={pile.breakerStatus} />
        <Readout label="Power contactor status" value={pile.powerContactor} />
        <Readout label="GPRS status" value={pile.gprsStatus} />
        <Readout label="GPRS signal" value={pile.gprsSignalPercent} unit="%" />
        <Readout label="Temperature 1" value={pile.temp1C} unit="°C" />
        <Readout label="Temperature 2" value={pile.temp2C} unit="°C" />
        <Readout label="Temperature 3" value={pile.temp3C} unit="°C" />
        <Readout label="Temperature 4" value={pile.temp4C} unit="°C" />
      </div>

      <div className="flex flex-col gap-3 border-t border-[#e3e6ea] pt-[10px]">
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

      <div className="grid grid-cols-2 gap-2 border-t border-zinc-200 pt-4  dark:border-zinc-800">
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
