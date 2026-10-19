"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ConnectorRuntimeView, DeviceInstanceDetail } from "@/lib/device-instances/types";

const POLL_MS = 1500;
/** Nominal pack size used only to turn delivered kWh into a believable state-of-charge on the 3D car. */
export const BATTERY_KWH = 64;
const START_SOC = 0.18;

export interface TwinPlug {
  connectorId: number;
  label: string;
  type: string;
  evConnected: boolean;
  status: string;
  charging: boolean;
  chargeRateKw: number;
  energyKwh: number;
  /** 0..1 */
  soc: number;
  idTag: string | null;
}

function toPlug(detail: DeviceInstanceDetail, runtime: ConnectorRuntimeView | undefined, connectorId: number, now: number): TwinPlug {
  const c = detail.connectors.find((x) => x.connectorId === connectorId)!;
  const session = runtime?.activeSession ?? null;
  const charging = runtime?.status === "Charging" && session !== null;
  // Mirror the Home screen: live energy from the session clock, not just the last poll.
  const energyKwh = session ? (session.chargeRateKw * Math.max(0, now - new Date(session.startedAt).getTime())) / 3_600_000 : 0;
  return {
    connectorId,
    label: c.label.trim().slice(-1).toUpperCase() || String(connectorId),
    type: c.connectorType,
    evConnected: runtime?.evConnected ?? false,
    status: runtime?.status ?? "Available",
    charging,
    chargeRateKw: session?.chargeRateKw ?? 0,
    energyKwh,
    soc: Math.min(1, START_SOC + energyKwh / BATTERY_KWH),
    idTag: session?.idTag ?? null,
  };
}

/** Polls the same endpoints the 2D Home screen uses, and exposes plug/unplug through the existing EV route. */
export function useTwinData(instanceId: string) {
  const [instance, setInstance] = useState<DeviceInstanceDetail | null>(null);
  const [runtime, setRuntime] = useState<ConnectorRuntimeView[] | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([fetch(`/api/device-instances/${instanceId}`), fetch(`/api/device-instances/${instanceId}/connectors`)]);
      if (a.ok) setInstance((await a.json()).instance);
      if (b.ok) setRuntime((await b.json()).connectors);
    } catch {
      /* transient — next poll retries */
    }
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    load();
    timer.current = setInterval(load, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 500);
    return () => {
      if (timer.current) clearInterval(timer.current);
      clearInterval(clock);
    };
  }, [load]);

  const setEv = useCallback(
    async (connectorId: number, connected: boolean) => {
      setPending(connectorId);
      setError(null);
      try {
        const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/ev`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connected }),
        });
        if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Could not change the EV connection");
        await load();
      } finally {
        setPending(null);
      }
    },
    [instanceId, load],
  );

  const plugs: TwinPlug[] = instance
    ? instance.connectors.map((c) => toPlug(instance, runtime?.find((r) => r.connectorId === c.connectorId), c.connectorId, now))
    : [];

  return { instance, plugs, pending, error, setEv };
}
