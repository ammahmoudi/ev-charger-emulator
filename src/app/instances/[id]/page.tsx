"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { InstanceSubNav } from "@/components/device-instances/InstanceSubNav";
import { StatusBadge } from "@/components/device-instances/StatusBadge";
import type { DeviceInstanceDetail } from "@/lib/device-instances/types";

export default function InstanceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const instanceId = params.id;

  const [instance, setInstance] = useState<DeviceInstanceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [name, setName] = useState("");
  const [chargePointId, setChargePointId] = useState("");
  const [csmsUrl, setCsmsUrl] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  async function load() {
    const res = await fetch(`/api/device-instances/${instanceId}`);
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const data = await res.json();
    setInstance(data.instance);
    setName(data.instance.name);
    setChargePointId(data.instance.chargePointId);
    setCsmsUrl(data.instance.csmsUrl);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, chargePointId, csmsUrl }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.field) setFieldErrors({ [data.field]: data.error });
        else setError(data.error ?? "Failed to save changes");
        return;
      }
      setInstance(data.instance);
    } catch {
      setError("Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleStartStop() {
    if (!instance) return;
    const isRunning = instance.status === "CONNECTED" || instance.status === "CONNECTING";
    setActionPending(true);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}/${isRunning ? "stop" : "start"}`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setInstance(data.instance);
      }
    } finally {
      setActionPending(false);
    }
  }

  async function handleDelete() {
    if (!instance) return;
    if (!confirm(`Delete device instance "${instance.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/device-instances/${instanceId}`, { method: "DELETE" });
    if (res.ok || res.status === 204) router.push("/instances");
  }

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-10">
        <p className="text-sm text-zinc-500">Device instance not found.</p>
        <Link href="/instances" className="text-sm underline">
          Back to instances
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

  const isRunning = instance.status === "CONNECTED" || instance.status === "CONNECTING";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Link href="/instances" className="text-xs text-zinc-500 hover:underline">
            ← Instances
          </Link>
          <h1 className="text-xl font-semibold text-black dark:text-zinc-50">{instance.name}</h1>
          <p className="text-sm text-zinc-500">
            {instance.deviceModel.manufacturer} {instance.deviceModel.model}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <StatusBadge status={instance.status} />
          {instance.statusReason ? <p className="text-xs text-red-600 dark:text-red-400">{instance.statusReason}</p> : null}
        </div>
      </div>

      <InstanceSubNav instanceId={instanceId} />

      <div className="flex gap-3">
        <button
          type="button"
          disabled={actionPending}
          onClick={handleStartStop}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {isRunning ? "Stop" : "Start"}
        </button>
        <Link
          href={`/instances/${instanceId}/settings`}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Settings
        </Link>
        <Link
          href={`/instances/${instanceId}/status`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Status / diagnostics
        </Link>
        <Link
          href={`/instances/${instanceId}/device-test`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Device (hardware test)
        </Link>
        <Link
          href={`/instances/${instanceId}/maintenance`}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Maintenance
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
        >
          Delete
        </button>
      </div>

      <form onSubmit={handleSave} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Charge point ID</label>
          <input
            required
            value={chargePointId}
            onChange={(e) => setChargePointId(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {fieldErrors.chargePointId ? (
            <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.chargePointId}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">CSMS OCPP WebSocket URL</label>
          <input
            required
            value={csmsUrl}
            onChange={(e) => setCsmsUrl(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {fieldErrors.csmsUrl ? <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.csmsUrl}</p> : null}
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
