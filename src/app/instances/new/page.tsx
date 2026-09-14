"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { ParameterField } from "@/components/device-instances/ParameterField";
import { generateMasterCardIdTag } from "@/lib/device-instances/rfid-utils";
import {
  PARAMETER_CATEGORY_LABELS,
  PARAMETER_CATEGORY_ORDER,
  type DeviceModelDetail,
  type DeviceModelSummary,
} from "@/lib/device-instances/types";

export default function NewInstancePage() {
  const router = useRouter();
  const [models, setModels] = useState<DeviceModelSummary[] | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [model, setModel] = useState<DeviceModelDetail | null>(null);

  const [name, setName] = useState("");
  const [chargePointId, setChargePointId] = useState("");
  const [csmsUrl, setCsmsUrl] = useState("");
  const [masterCardIdTag, setMasterCardIdTag] = useState(() => generateMasterCardIdTag());
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/device-models")
      .then((res) => res.json())
      .then((data) => {
        setModels(data.deviceModels);
        if (data.deviceModels.length === 1) setSelectedModelId(data.deviceModels[0].id);
      })
      .catch(() => setError("Failed to load device models"));
  }, []);

  useEffect(() => {
    if (!selectedModelId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting on selection change, not derived state
      setModel(null);
      return;
    }
    fetch(`/api/device-models/${selectedModelId}`)
      .then((res) => res.json())
      .then((data) => {
        setModel(data.deviceModel);
        const defaults: Record<string, string> = {};
        for (const p of data.deviceModel.parameters) {
          defaults[p.key] = p.defaultValue ?? "";
        }
        setParamValues(defaults);
      })
      .catch(() => setError("Failed to load device model schema"));
  }, [selectedModelId]);

  const parametersByCategory = useMemo(() => {
    if (!model) return [];
    return PARAMETER_CATEGORY_ORDER.map((category) => ({
      category,
      parameters: model.parameters.filter((p) => p.category === category),
    })).filter((group) => group.parameters.length > 0);
  }, [model]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res = await fetch("/api/device-instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceModelId: selectedModelId,
          name,
          chargePointId,
          csmsUrl,
          masterCardIdTag,
          parameters: paramValues,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.field) setFieldErrors({ [data.field]: data.error });
        else setError(data.error ?? "Failed to create device instance");
        return;
      }
      router.push(`/instances/${data.instance.id}`);
    } catch {
      setError("Failed to create device instance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">New device</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Device model</label>
          <select
            required
            value={selectedModelId}
            onChange={(e) => setSelectedModelId(e.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            <option value="" disabled>
              Select a model…
            </option>
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.manufacturer} {m.model}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Bay 3 charger"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Charge point ID</label>
          <input
            required
            value={chargePointId}
            onChange={(e) => setChargePointId(e.target.value)}
            placeholder="e.g. CP-001"
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
            placeholder="ws://localhost:9000/CP-001"
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          {fieldErrors.csmsUrl ? <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.csmsUrl}</p> : null}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Master card idTag</label>
          <div className="flex gap-2">
            <input
              value={masterCardIdTag}
              onChange={(e) => setMasterCardIdTag(e.target.value)}
              placeholder="e.g. MASTER-A1B2C3"
              className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-black focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
            />
            <button
              type="button"
              onClick={() => setMasterCardIdTag(generateMasterCardIdTag())}
              className="shrink-0 rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              Regenerate
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            Presenting this card via the RFID-simulation flow always starts a session locally, even without a CSMS
            connection — like a real charger&apos;s factory master card. Any other card requires the instance to be
            connected.
          </p>
          {fieldErrors.masterCardIdTag ? (
            <p className="text-xs text-red-600 dark:text-red-400">{fieldErrors.masterCardIdTag}</p>
          ) : null}
        </div>

        {parametersByCategory.length > 0 ? (
          <div className="flex flex-col gap-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
            <p className="text-sm text-zinc-500">
              Parameters are seeded from the model&apos;s defaults — adjust any before creating, or edit later.
            </p>
            {parametersByCategory.map(({ category, parameters }) => (
              <fieldset key={category} className="flex flex-col gap-3">
                <legend className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {PARAMETER_CATEGORY_LABELS[category]}
                </legend>
                {parameters.map((p) => (
                  <ParameterField
                    key={p.id}
                    schema={p}
                    value={paramValues[p.key] ?? ""}
                    error={fieldErrors[p.key]}
                    onChange={(value) => setParamValues((prev) => ({ ...prev, [p.key]: value }))}
                  />
                ))}
              </fieldset>
            ))}
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !selectedModelId}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {submitting ? "Creating…" : "Create device"}
          </button>
        </div>
      </form>
    </div>
  );
}
