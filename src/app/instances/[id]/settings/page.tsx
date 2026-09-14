"use client";

import type { ParameterCategory } from "@prisma/client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { renderParameterControl } from "@/components/device-instances/ParameterField";
import { DeviceBottomNav } from "@/components/device-instances/DeviceBottomNav";
import { DeviceScreenFrame } from "@/components/device-instances/DeviceScreenFrame";
import { DeviceHeaderBar } from "@/components/device-instances/settings/DeviceHeaderBar";
import { compactControlClassName, SettingsFieldRow } from "@/components/device-instances/settings/SettingsFieldRow";
import { SettingsPager } from "@/components/device-instances/settings/SettingsPager";
import { SettingsTabs } from "@/components/device-instances/settings/SettingsTabs";
import { paginateBySortOrder, splitIntoColumns } from "@/lib/device-instances/settings-pages";
import { PARAMETER_CATEGORY_ORDER, type DeviceInstanceDetail, type DeviceInstanceParameterView } from "@/lib/device-instances/types";

/**
 * The Networks tab's "Domain name" field is the same concept as the instance's top-level
 * csmsUrl (both hold the full OCPP WebSocket URL) — bind it to csmsUrl instead of rendering
 * the DeviceInstanceParameter, so there's one editable source of truth instead of two.
 */
const DOMAIN_NAME_KEY = "domainName";

export default function InstanceSettingsPage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [instance, setInstance] = useState<DeviceInstanceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [activeTab, setActiveTab] = useState<ParameterCategory>("DEVICE");
  const [pageIndexByTab, setPageIndexByTab] = useState<Partial<Record<ParameterCategory, number>>>({});

  const [name, setName] = useState("");
  const [chargePointId, setChargePointId] = useState("");
  const [csmsUrl, setCsmsUrl] = useState("");
  const [masterCardIdTag, setMasterCardIdTag] = useState("");
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
    setMasterCardIdTag(data.instance.masterCardIdTag ?? "");
    const values: Record<string, string> = {};
    for (const p of data.instance.parameters as DeviceInstanceParameterView[]) values[p.key] = p.value ?? "";
    setParamValues(values);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on route param change, not derived state
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const parametersByCategory = useMemo(() => {
    const map = new Map<ParameterCategory, DeviceInstanceParameterView[]>();
    if (!instance) return map;
    for (const category of PARAMETER_CATEGORY_ORDER) {
      map.set(
        category,
        instance.parameters.filter((p) => p.category === category).sort((a, b) => a.sortOrder - b.sortOrder),
      );
    }
    return map;
  }, [instance]);

  const activeParameters = useMemo(() => parametersByCategory.get(activeTab) ?? [], [parametersByCategory, activeTab]);
  const activePages = useMemo(() => paginateBySortOrder(activeParameters), [activeParameters]);
  const pageIndex = Math.min(pageIndexByTab[activeTab] ?? 0, Math.max(activePages.length - 1, 0));
  const currentPageParameters = activePages[pageIndex] ?? [];

  function selectTab(category: ParameterCategory) {
    setActiveTab(category);
  }

  function setPageIndex(index: number) {
    setPageIndexByTab((prev) => ({ ...prev, [activeTab]: index }));
  }

  async function handleSave() {
    setError(null);
    setFieldErrors({});
    setSaving(true);
    try {
      const res = await fetch(`/api/device-instances/${instanceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, chargePointId, csmsUrl, masterCardIdTag, parameters: paramValues }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.field) setFieldErrors({ [data.field]: data.error });
        else setError(data.error ?? "Failed to save settings");
        return;
      }
      setInstance(data.instance);
    } catch {
      setError("Failed to save settings");
    } finally {
      setSaving(false);
    }
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

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-6 py-10">
      <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
        ← {instance.name}
      </Link>

      <DeviceScreenFrame>
        <DeviceHeaderBar instanceId={instanceId} title={instance.name} />
        <SettingsTabs active={activeTab} onSelect={selectTab} />

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
          <div className="rounded-xl bg-white p-4 shadow-sm dark:bg-zinc-900">
            {activeTab === "DEVICE" ? (
              <DeviceTabContent
                instance={instance}
                parameters={activeParameters}
                name={name}
                chargePointId={chargePointId}
                masterCardIdTag={masterCardIdTag}
                fieldErrors={fieldErrors}
                onNameChange={setName}
                onChargePointIdChange={setChargePointId}
                onMasterCardIdTagChange={setMasterCardIdTag}
              />
            ) : (
              <>
                <ParameterPage
                  parameters={currentPageParameters}
                  paramValues={paramValues}
                  csmsUrl={csmsUrl}
                  fieldErrors={fieldErrors}
                  onParamChange={(key, value) => setParamValues((prev) => ({ ...prev, [key]: value }))}
                  onCsmsUrlChange={setCsmsUrl}
                />
                <SettingsPager pageIndex={pageIndex} pageCount={activePages.length} onChange={setPageIndex} />
              </>
            )}
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <button
            type="button"
            disabled={saving}
            onClick={handleSave}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>

        <DeviceBottomNav instanceId={instanceId} active="Setting" />
      </DeviceScreenFrame>
    </div>
  );
}

function DeviceTabContent({
  instance,
  parameters,
  name,
  chargePointId,
  masterCardIdTag,
  fieldErrors,
  onNameChange,
  onChargePointIdChange,
  onMasterCardIdTagChange,
}: {
  instance: DeviceInstanceDetail;
  parameters: DeviceInstanceParameterView[];
  name: string;
  chargePointId: string;
  masterCardIdTag: string;
  fieldErrors: Record<string, string>;
  onNameChange: (value: string) => void;
  onChargePointIdChange: (value: string) => void;
  onMasterCardIdTagChange: (value: string) => void;
}) {
  const byKey = new Map(parameters.map((p) => [p.key, p]));
  const readOnlyRows = [
    { label: "Model", value: `${instance.deviceModel.manufacturer} ${instance.deviceModel.model}` },
    { label: "Firmware", value: byKey.get("firmwareVersion")?.value ?? "—" },
    { label: "UI", value: byKey.get("uiVersion")?.value ?? "—" },
    { label: "CRC", value: byKey.get("crc")?.value ?? "—" },
    { label: "Plug A Firmware", value: byKey.get("plugAFirmwareVersion")?.value ?? "—" },
    { label: "Plug B Firmware", value: byKey.get("plugBFirmwareVersion")?.value ?? "—" },
  ];
  const [left, right] = splitIntoColumns(readOnlyRows);

  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      <div className="flex flex-col">
        <SettingsFieldRow label="Name" error={fieldErrors.name}>
          <input
            required
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            className={compactControlClassName}
          />
        </SettingsFieldRow>
        <SettingsFieldRow label="SN" error={fieldErrors.chargePointId}>
          <input
            required
            value={chargePointId}
            onChange={(e) => onChargePointIdChange(e.target.value)}
            className={`${compactControlClassName} font-mono`}
          />
        </SettingsFieldRow>
        <SettingsFieldRow label="Master card idTag" error={fieldErrors.masterCardIdTag}>
          <input
            value={masterCardIdTag}
            onChange={(e) => onMasterCardIdTagChange(e.target.value)}
            placeholder="e.g. MASTER-A1B2C3"
            className={`${compactControlClassName} font-mono`}
          />
        </SettingsFieldRow>
        {left.map((row) => (
          <SettingsFieldRow key={row.label} label={row.label}>
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.value}</span>
          </SettingsFieldRow>
        ))}
      </div>
      <div className="flex flex-col">
        {right.map((row) => (
          <SettingsFieldRow key={row.label} label={row.label}>
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.value}</span>
          </SettingsFieldRow>
        ))}
      </div>
    </div>
  );
}

function ParameterPage({
  parameters,
  paramValues,
  csmsUrl,
  fieldErrors,
  onParamChange,
  onCsmsUrlChange,
}: {
  parameters: DeviceInstanceParameterView[];
  paramValues: Record<string, string>;
  csmsUrl: string;
  fieldErrors: Record<string, string>;
  onParamChange: (key: string, value: string) => void;
  onCsmsUrlChange: (value: string) => void;
}) {
  const [left, right] = splitIntoColumns(parameters);

  return (
    <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
      {[left, right].map((column, i) => (
        <div key={i} className="flex flex-col">
          {column.map((p) =>
            p.key === DOMAIN_NAME_KEY ? (
              <SettingsFieldRow key={p.key} label="Domain name" error={fieldErrors.csmsUrl}>
                <input
                  type="text"
                  value={csmsUrl}
                  onChange={(e) => onCsmsUrlChange(e.target.value)}
                  placeholder="ws://host/chargePointId"
                  className={compactControlClassName}
                />
              </SettingsFieldRow>
            ) : (
              <SettingsFieldRow key={p.key} label={p.label} unit={p.unit} error={fieldErrors[p.key]}>
                {renderParameterControl(
                  p,
                  paramValues[p.key] ?? "",
                  (value) => onParamChange(p.key, value),
                  compactControlClassName,
                )}
              </SettingsFieldRow>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
