"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import type { CameraPreset } from "./TwinScene";
import { STATE_COLOR } from "./Station";
import { useTwinData, type TwinPlug } from "./useTwinData";

const TwinScene = dynamic(() => import("./TwinScene"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 grid place-items-center text-sm text-slate-400">Loading 3D scene…</div>,
});

const PRESET_LABELS: [CameraPreset, string][] = [
  ["overview", "Overview"],
  ["screen", "Screen"],
  ["plugA", "Plug A"],
  ["plugB", "Plug B"],
];

function PlugCard({ plug, pending, onSet }: { plug: TwinPlug; pending: boolean; onSet: (connected: boolean) => void }) {
  const color = STATE_COLOR[plug.status] ?? "#6b7280";
  return (
    <div className="w-[270px] rounded-2xl border border-white/10 bg-slate-900/70 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-slate-700 text-sm font-bold">{plug.label}</span>
          <span className="text-xs font-medium tracking-wide text-slate-400">{plug.type}</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
          <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
          {plug.status}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="Power" value={plug.charging ? plug.chargeRateKw.toFixed(1) : "—"} unit="kW" />
        <Stat label="Energy" value={plug.evConnected ? plug.energyKwh.toFixed(2) : "—"} unit="kWh" />
        <Stat label="Charge" value={plug.evConnected ? Math.round(plug.soc * 100).toString() : "—"} unit="%" />
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${plug.evConnected ? plug.soc * 100 : 0}%`, background: "linear-gradient(90deg,#22c55e,#38bdf8)" }}
        />
      </div>

      <button
        type="button"
        disabled={pending}
        onClick={() => onSet(!plug.evConnected)}
        className={`mt-3 w-full rounded-xl py-2 text-sm font-semibold transition disabled:opacity-50 ${
          plug.evConnected ? "bg-white/10 text-slate-200 hover:bg-white/15" : "bg-sky-500 text-white hover:bg-sky-400"
        }`}
      >
        {plug.evConnected ? (plug.charging ? "Unplug EV (stops session)" : "Unplug EV") : "Drive in an EV"}
      </button>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-mono text-lg tabular-nums leading-tight">
        {value}
        <span className="ml-0.5 text-[10px] text-slate-400">{unit}</span>
      </div>
    </div>
  );
}

/** Full-bleed 3D digital twin: the station + EVs, with the live device screen on the station's monitor. */
export function TwinView({ instanceId }: { instanceId: string }) {
  const { instance, plugs, pending, error, setEv } = useTwinData(instanceId);
  const [preset, setPreset] = useState<CameraPreset>("overview");
  const [lowQuality, setLowQuality] = useState(false);
  useEffect(() => {
    // Deep links: /twin?preset=screen|plugA|plugB, and ?lq for software-GL / automated screenshots.
    // Read after hydration so the server and first client render agree.
    const q = new URLSearchParams(window.location.search);
    const p = q.get("preset");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- URL is only readable client-side
    if (PRESET_LABELS.some(([k]) => k === p)) setPreset(p as CameraPreset);
    setLowQuality(q.has("lq"));
  }, []);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const portal = useMemo(() => ({ current: host }) as React.RefObject<HTMLElement>, [host]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#0b1018] text-slate-100">
      <div ref={setHost} className="absolute inset-0">
        {host ? <TwinScene instanceId={instanceId} plugs={plugs} preset={preset} onToggleEv={setEv} portal={portal} lowQuality={lowQuality} /> : null}
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-5">
        <div className="pointer-events-auto flex flex-col gap-1">
          <Link href={`/instances/${instanceId}`} className="text-xs text-slate-400 hover:text-slate-200">
            ← 2D device view
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">{instance?.name ?? "Charger"}</h1>
          <p className="text-xs text-slate-400">
            {instance ? `${instance.deviceModel.model} · ${instance.chargePointId}` : "Loading…"}
            {instance ? <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold">{instance.status}</span> : null}
          </p>
        </div>

        <div className="pointer-events-auto flex gap-1 rounded-full border border-white/10 bg-slate-900/70 p-1 backdrop-blur-xl">
          {PRESET_LABELS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPreset(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${preset === key ? "bg-sky-500 text-white" : "text-slate-300 hover:bg-white/10"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-center gap-4 p-5 transition-all duration-500 ${preset === "screen" ? "translate-y-[110%] opacity-0" : ""}`}>
        {plugs.slice(0, 2).map((p) => (
          <div key={p.connectorId} className="pointer-events-auto">
            <PlugCard plug={p} pending={pending === p.connectorId} onSet={(c) => setEv(p.connectorId, c)} />
          </div>
        ))}
      </div>
      {error ? <div className="absolute left-1/2 top-20 -translate-x-1/2 rounded-lg bg-red-500/90 px-3 py-1.5 text-xs">{error}</div> : null}
      <p className="pointer-events-none absolute bottom-2 right-4 text-[10px] text-slate-500">Drag to orbit · scroll to zoom · click the screen to use it</p>
    </div>
  );
}
