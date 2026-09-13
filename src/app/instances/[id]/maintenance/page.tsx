"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ConnectorAvailabilityBadge } from "@/components/device-instances/ConnectorAvailabilityBadge";
import { MaintenanceConfirmPanel } from "@/components/device-instances/MaintenanceConfirmPanel";
import type { DeviceInstanceMaintenanceState } from "@/lib/device-instances/types";

const UPGRADE_POLL_INTERVAL_MS = 700;

type TabKey = "time" | "events" | "consumption" | "factory" | "upgrade";

const TABS: { key: TabKey; label: string }[] = [
  { key: "time", label: "Time Setting" },
  { key: "events", label: "Event Record Clear" },
  { key: "consumption", label: "Consumption Record Clear" },
  { key: "factory", label: "Restore Factory Setting" },
  { key: "upgrade", label: "Upgrade Board Program" },
];

const primaryButtonClassName =
  "rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";

interface InstanceHeaderInfo {
  name: string;
  deviceModel: { manufacturer: string; model: string };
}

export default function MaintenancePage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [instance, setInstance] = useState<InstanceHeaderInfo | null>(null);
  const [instanceNotFound, setInstanceNotFound] = useState(false);
  const [maintenance, setMaintenance] = useState<DeviceInstanceMaintenanceState | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("time");
  const [message, setMessage] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadInstance = useCallback(async () => {
    const res = await fetch(`/api/device-instances/${instanceId}`);
    if (res.status === 404) {
      setInstanceNotFound(true);
      return;
    }
    const data = await res.json();
    setInstance({ name: data.instance.name, deviceModel: data.instance.deviceModel });
  }, [instanceId]);

  const loadMaintenance = useCallback(async () => {
    const res = await fetch(`/api/device-instances/${instanceId}/maintenance`);
    if (res.status === 404) {
      setInstanceNotFound(true);
      return;
    }
    const data: DeviceInstanceMaintenanceState = await res.json();
    setMaintenance(data);
  }, [instanceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    loadInstance();
    loadMaintenance();
  }, [loadInstance, loadMaintenance]);

  const upgrading = maintenance?.connectors.some((c) => c.status === "Unavailable") ?? false;

  useEffect(() => {
    if (!upgrading) return;
    const timer = setInterval(loadMaintenance, UPGRADE_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [upgrading, loadMaintenance]);

  async function runAction<T = unknown>(action: string, path: string, successMessage: string | ((data: T) => string)) {
    setPendingAction(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/maintenance/${path}`, { method: "POST" });
      if (!res.ok) {
        setMessage("Action failed. Please try again.");
        return;
      }
      const data: T = await res.json();
      setMessage(typeof successMessage === "function" ? successMessage(data) : successMessage);
      await loadMaintenance();
    } catch {
      setMessage("Action failed. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  if (instanceNotFound) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Device instance not found.</p>
        <Link href="/instances" className="text-sm underline">
          Back to instances
        </Link>
      </div>
    );
  }

  if (!instance || !maintenance) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
          ← {instance.name}
        </Link>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Maintenance</h1>
        <p className="text-sm text-zinc-500">
          {instance.deviceModel.manufacturer} {instance.deviceModel.model}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2 border-b border-zinc-200 text-sm dark:border-zinc-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => {
              setActiveTab(tab.key);
              setMessage(null);
            }}
            className={`-mb-px border-b-2 px-1 pb-2 font-medium ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-600 dark:text-blue-400"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        {activeTab === "time" ? <TimeSettingPanel /> : null}

        {activeTab === "events" ? (
          <MaintenanceConfirmPanel
            prompt="Clear event record"
            detail={`${maintenance.eventCount} event${maintenance.eventCount === 1 ? "" : "s"} currently logged.`}
          >
            <button
              type="button"
              disabled={pendingAction === "clear-events"}
              onClick={() =>
                runAction<{ clearedCount: number }>(
                  "clear-events",
                  "clear-events",
                  (data) => `Cleared ${data.clearedCount} event record(s).`,
                )
              }
              className={primaryButtonClassName}
            >
              {pendingAction === "clear-events" ? "Clearing…" : "Clear"}
            </button>
          </MaintenanceConfirmPanel>
        ) : null}

        {activeTab === "consumption" ? (
          <MaintenanceConfirmPanel
            prompt="Clear consumption record"
            detail={`${maintenance.chargingSessionCount} session${maintenance.chargingSessionCount === 1 ? "" : "s"} currently logged.`}
          >
            <button
              type="button"
              disabled={pendingAction === "clear-consumption"}
              onClick={() =>
                runAction<{ clearedCount: number }>(
                  "clear-consumption",
                  "clear-consumption",
                  (data) => `Cleared ${data.clearedCount} consumption record(s).`,
                )
              }
              className={primaryButtonClassName}
            >
              {pendingAction === "clear-consumption" ? "Clearing…" : "Clear"}
            </button>
          </MaintenanceConfirmPanel>
        ) : null}

        {activeTab === "factory" ? (
          <MaintenanceConfirmPanel
            prompt="Restore factory setting"
            detail="Restore resets this instance's parameters to the device model's defaults. OCPP closes and re-establishes the OCPP connection."
          >
            <button
              type="button"
              disabled={pendingAction === "reset-parameters"}
              onClick={() =>
                runAction("reset-parameters", "reset-parameters", "Parameters restored to factory defaults.")
              }
              className={primaryButtonClassName}
            >
              {pendingAction === "reset-parameters" ? "Restoring…" : "Restore"}
            </button>
            <button
              type="button"
              disabled={pendingAction === "reconnect"}
              onClick={() => runAction("reconnect", "reconnect", "OCPP connection reset.")}
              className={primaryButtonClassName}
            >
              {pendingAction === "reconnect" ? "Reconnecting…" : "OCPP"}
            </button>
          </MaintenanceConfirmPanel>
        ) : null}

        {activeTab === "upgrade" ? (
          <div className="flex flex-col gap-6">
            <MaintenanceConfirmPanel
              prompt="Upgrade"
              detail="Please be cautious, the upgrade process briefly makes the pile's connectors unavailable while the board program updates."
            >
              <button
                type="button"
                disabled={pendingAction === "upgrade-firmware" || upgrading}
                onClick={() =>
                  runAction<DeviceInstanceMaintenanceState>(
                    "upgrade-firmware",
                    "upgrade-firmware",
                    (data) =>
                      data.firmwareVersion
                        ? `Upgrade started. Current firmware: v${data.firmwareVersion}.`
                        : "Upgrade started.",
                  )
                }
                className={primaryButtonClassName}
              >
                {upgrading ? "Upgrading…" : pendingAction === "upgrade-firmware" ? "Starting…" : "Upgrade"}
              </button>
            </MaintenanceConfirmPanel>

            <div className="flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              {maintenance.firmwareVersion !== null ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-zinc-700 dark:text-zinc-300">Board firmware version</span>
                  <span className="font-mono text-zinc-600 dark:text-zinc-400">v{maintenance.firmwareVersion}</span>
                </div>
              ) : null}
              {maintenance.connectors.map((connector) => (
                <div key={connector.connectorId} className="flex items-center justify-between text-sm">
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {connector.label ?? `Connector ${connector.connectorId}`}
                  </span>
                  <ConnectorAvailabilityBadge status={connector.status} />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {message ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{message}</p> : null}
    </div>
  );
}

function TimeSettingPanel() {
  const [value, setValue] = useState(() => toLocalDateTimeInputValue(new Date()));
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (editing) return;
    const timer = setInterval(() => setValue(toLocalDateTimeInputValue(new Date())), 1000);
    return () => clearInterval(timer);
  }, [editing]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">System Time Setting</label>
        <input
          type="datetime-local"
          step={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setEditing(true);
            setSaved(false);
          }}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
        <p className="text-xs text-zinc-500">
          Informational only — this reflects the emulator process&apos;s own clock and has no effect on the instance.
        </p>
      </div>
      <div>
        <button
          type="button"
          onClick={() => {
            setSaved(true);
            setEditing(false);
          }}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Save
        </button>
        {saved ? <span className="ml-3 text-sm text-zinc-500">Saved.</span> : null}
      </div>
    </div>
  );
}

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
