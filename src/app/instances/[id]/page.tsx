"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { ChargeMethodScreen } from "@/components/device-instances/ChargeMethodScreen";
import { CarSimulatorPanel } from "@/components/device-instances/CarSimulatorPanel";
import { ConnectorChargeCard } from "@/components/device-instances/ConnectorChargeCard";
import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { HomeHeaderBar } from "@/components/device-instances/HomeHeaderBar";
import { PostChargeSummaryModal } from "@/components/device-instances/PostChargeSummaryModal";
import { RfidPromptModal } from "@/components/device-instances/RfidPromptModal";
import { NORMAL_STOP_CAUSES } from "@/lib/device-instances/stop-causes";
import type { ConnectorRuntimeView, DeviceInstanceDetail, PostChargeSummary } from "@/lib/device-instances/types";

const CONNECTOR_POLL_INTERVAL_MS = 2000;
const CLOCK_TICK_MS = 1000;
const DEFAULT_CHARGE_RATE_KW = 7;
const MANUAL_STOP_CAUSE = NORMAL_STOP_CAUSES[0];

interface RfidPromptState {
  connectorId: number;
  connectorLabel: string;
  maxPowerKw: number | null;
  vehicleId?: boolean;
}

/**
 * The device instance's Home screen (issue #2) — the actual default page for an instance,
 * matching the real PEVC3107E's home screen (see docs/device-reference/PEVC3107E/README.md and
 * its screenshots/01-home-dual-plug.png): a charging card per connector, a header with serial
 * number + live clock, and the configured Charge Price. Sub-screens (Settings/Status/Maintenance/
 * Event/Cost/Lock/Device-test) are reached from the header/bottom-nav chrome, matching the real
 * device's navigation, rather than the previous plain edit-instance form this route used to be.
 */
export default function InstanceHomePage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [instance, setInstance] = useState<DeviceInstanceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [connectors, setConnectors] = useState<ConnectorRuntimeView[] | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectionPending, setConnectionPending] = useState(false);
  const [pendingConnectorId, setPendingConnectorId] = useState<number | null>(null);
  const [evPendingConnectorId, setEvPendingConnectorId] = useState<number | null>(null);
  const [connectorErrors, setConnectorErrors] = useState<Record<number, string>>({});
  const [summary, setSummary] = useState<PostChargeSummary | null>(null);
  const [rfidPrompt, setRfidPrompt] = useState<RfidPromptState | null>(null);
  const [methodPrompt, setMethodPrompt] = useState<(RfidPromptState & { expiresAt: number }) | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInstance = useCallback(async () => {
    const res = await fetch(`/api/device-instances/${instanceId}`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setInstance(data.instance);
  }, [instanceId]);

  const loadConnectors = useCallback(async () => {
    const res = await fetch(`/api/device-instances/${instanceId}/connectors`);
    if (!res.ok) return;
    const data = await res.json();
    setConnectors(data.connectors);
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    loadInstance();
  }, [loadInstance]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch + poll, not derived state
    loadConnectors();
    pollRef.current = setInterval(loadConnectors, CONNECTOR_POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadConnectors]);

  useEffect(() => {
    const clockRef = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(clockRef);
  }, []);

  async function handleToggleConnection() {
    if (!instance) return;
    const isRunning = instance.status === "CONNECTED" || instance.status === "CONNECTING";
    setConnectionPending(true);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/${isRunning ? "stop" : "start"}`, { method: "POST" });
      if (res.ok) setInstance((await res.json()).instance);
    } finally {
      setConnectionPending(false);
    }
  }

  function openRfidPrompt(connectorId: number, connectorLabel: string, maxPowerKw: number | null) {
    setConnectorErrors((prev) => ({ ...prev, [connectorId]: "" }));
    setMethodPrompt({ connectorId, connectorLabel, maxPowerKw, expiresAt: now.getTime() + 60_000 });
  }

  async function handlePresentCard(idTag: string) {
    if (!rfidPrompt) return;
    const { connectorId, maxPowerKw } = rfidPrompt;
    setPendingConnectorId(connectorId);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idTag, chargeRateKw: maxPowerKw ?? DEFAULT_CHARGE_RATE_KW }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectorErrors((prev) => ({ ...prev, [connectorId]: data.error ?? "Failed to start charging" }));
        return;
      }
      setRfidPrompt(null);
      setMethodPrompt(null);
      await loadConnectors();
    } finally {
      setPendingConnectorId(null);
    }
  }

  async function handleStopCharging(connectorId: number) {
    setPendingConnectorId(connectorId);
    setConnectorErrors((prev) => ({ ...prev, [connectorId]: "" }));
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/session/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stopCause: MANUAL_STOP_CAUSE }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectorErrors((prev) => ({ ...prev, [connectorId]: data.error ?? "Failed to stop charging" }));
        return;
      }
      setSummary(data.summary);
      await loadConnectors();
    } finally {
      setPendingConnectorId(null);
    }
  }

  async function handleToggleEv(connectorId: number, connected: boolean) {
    setEvPendingConnectorId(connectorId);
    setConnectorErrors((prev) => ({ ...prev, [connectorId]: "" }));
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/ev`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connected }),
      });
      const data = await res.json();
      if (!res.ok) {
        setConnectorErrors((prev) => ({ ...prev, [connectorId]: data.error ?? "Failed to update the EV connection" }));
        return;
      }
      await loadConnectors();
    } finally {
      setEvPendingConnectorId(null);
    }
  }

  async function handleClearFault(connectorId: number) {
    setPendingConnectorId(connectorId);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/connectors/${connectorId}/clear-fault`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setConnectorErrors((prev) => ({ ...prev, [connectorId]: data.error ?? "Failed to clear fault" }));
        return;
      }
      await loadConnectors();
    } finally {
      setPendingConnectorId(null);
    }
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Device instance not found.</p>
        <Link href="/" className="text-sm underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  const priceParam = instance.parameters.find((p) => p.key === "pricePerKwh");
  const currencyParam = instance.parameters.find((p) => p.key === "currencyUnit");
  const price = Number(priceParam?.value ?? 0) || 0;
  const currency = currencyParam?.value ?? "—";

  const connectorByIdConnectorId = new Map((connectors ?? []).map((c) => [c.connectorId, c]));

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-xs text-zinc-500 hover:underline">
          ← All devices
        </Link>
        <Link href={`/instances/${instanceId}/twin`} className="rounded-full bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500">
          Open 3D twin →
        </Link>
      </div>

      <DeviceScreenFrame>
        {methodPrompt ? <ChargeMethodScreen
          instanceId={instanceId} serialNumber={instance.chargePointId} price={price} currency={currency}
          expiresAt={methodPrompt.expiresAt}
          onCard={() => setRfidPrompt(methodPrompt)}
          onVehicleId={() => setRfidPrompt({ ...methodPrompt, vehicleId: true })}
          onClose={() => { setMethodPrompt(null); setRfidPrompt(null); }}
        /> : <>
        <HomeHeaderBar
          instanceId={instanceId}
          name={instance.name}
          serialNumber={instance.chargePointId}
          now={now}
          status={instance.status}
          statusReason={instance.statusReason}
          connectionPending={connectionPending}
          onToggleConnection={handleToggleConnection}
          onMenu={() => setMenuOpen((v) => !v)}
        />

        <div className="flex min-h-0 flex-1 flex-col justify-between gap-2 overflow-y-auto bg-[#f4f6f8] px-[20px] pb-[12px] pt-[14px]">
          {connectors === null ? (
            <p className="text-center text-sm text-zinc-500">Loading…</p>
          ) : instance.connectors.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">This device model has no connectors configured.</p>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-[22px]">
              {instance.connectors.map((connector) => (
                <ConnectorChargeCard
                  key={connector.connectorId}
                  connector={connector}
                  runtime={connectorByIdConnectorId.get(connector.connectorId) ?? null}
                  now={now}
                  pending={pendingConnectorId === connector.connectorId}
                  error={connectorErrors[connector.connectorId] || null}
                  onStartCharging={() => openRfidPrompt(connector.connectorId, connector.label, connector.maxPowerKw)}
                  onStopCharging={() => handleStopCharging(connector.connectorId)}
                  onClearFault={() => handleClearFault(connector.connectorId)}
                />
              ))}
            </div>
          )}

          <p className="text-center text-[26px] text-[#8a8f95]">
            Charge Prices: <span className="mx-2 text-[34px] tabular-nums text-[#9a9fa5]">{price.toFixed(4)}</span> {currency}/kWh
          </p>
        </div>

        {menuOpen ? (
          <>
            <button type="button" aria-label="Close menu" className="absolute inset-0 z-20 cursor-default bg-black/10" onClick={() => setMenuOpen(false)} />
            <div className="absolute inset-x-0 bottom-0 z-30 shadow-[0_-6px_18px_rgba(0,0,0,0.25)]">
              <DeviceBottomNav instanceId={instanceId} />
            </div>
          </>
        ) : null}
        </>}
      </DeviceScreenFrame>

      <CarSimulatorPanel
        connectors={instance.connectors.map((connector) => {
          const runtime = connectorByIdConnectorId.get(connector.connectorId);
          return {
            connectorId: connector.connectorId,
            label: connector.label,
            evConnected: runtime?.evConnected ?? false,
            isCharging: runtime?.status === "Charging" && runtime.activeSession !== null,
          };
        })}
        pendingConnectorId={evPendingConnectorId}
        onToggle={handleToggleEv}
      />

      {summary ? <PostChargeSummaryModal summary={summary} onClose={() => setSummary(null)} /> : null}

      {rfidPrompt ? (
        <RfidPromptModal
          connectorLabel={rfidPrompt.connectorLabel}
          vehicleId={rfidPrompt.vehicleId}
          masterCardIdTag={instance.masterCardIdTag}
          pending={pendingConnectorId === rfidPrompt.connectorId}
          error={connectorErrors[rfidPrompt.connectorId] || null}
          onConfirm={handlePresentCard}
          onCancel={() => setRfidPrompt(null)}
        />
      ) : null}
    </div>
  );
}
