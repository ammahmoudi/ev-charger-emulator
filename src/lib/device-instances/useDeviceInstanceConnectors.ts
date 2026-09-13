"use client";

import { useEffect, useState } from "react";

import type { ConnectorView } from "@/lib/device-instances/diagnostics-types";

interface InstanceHeader {
  name: string;
  deviceModelId: string;
  deviceModelLabel: string;
}

/** Loads an instance's name/model plus its device model's connectors (e.g. "Plug A"/"Plug B"), for the diagnostics screens. */
export function useDeviceInstanceConnectors(instanceId: string) {
  const [header, setHeader] = useState<InstanceHeader | null>(null);
  const [connectors, setConnectors] = useState<ConnectorView[] | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const instanceRes = await fetch(`/api/device-instances/${instanceId}`);
      if (instanceRes.status === 404) {
        if (!cancelled) setNotFound(true);
        return;
      }
      const instanceData = await instanceRes.json();
      if (cancelled) return;
      setHeader({
        name: instanceData.instance.name,
        deviceModelId: instanceData.instance.deviceModel.id,
        deviceModelLabel: `${instanceData.instance.deviceModel.manufacturer} ${instanceData.instance.deviceModel.model}`,
      });

      const modelRes = await fetch(`/api/device-models/${instanceData.instance.deviceModel.id}`);
      const modelData = await modelRes.json();
      if (cancelled) return;
      setConnectors(
        (modelData.deviceModel.connectors as { id: string; evseIndex: number; connectorIndex: number; label: string | null }[]).map((c) => ({
          id: c.id,
          evseIndex: c.evseIndex,
          connectorIndex: c.connectorIndex,
          label: c.label,
        })),
      );
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  return { header, connectors, notFound };
}
