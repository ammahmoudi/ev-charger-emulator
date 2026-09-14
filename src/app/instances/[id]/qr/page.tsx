"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

import type { DeviceInstanceDetail } from "@/lib/device-instances/types";

const QR_PARAMETER_KEYS = ["qrCodeUrl1", "qrCodeUrl2"] as const;

/**
 * QR-code overlay reached from Home's header icon (matching the status/diagnostics overlay's
 * "no header/nav chrome, back-link" pattern — see status/contactor/page.tsx). Renders one QR
 * code per non-empty `qrCodeUrl1`/`qrCodeUrl2` instance parameter — the same two config keys a
 * real CSMS can set remotely via `ChangeConfiguration` (both are ordinary `DeviceModelParameter`
 * rows, so `PrismaConfigurationStore` reads/writes them like any other key), or an operator can
 * set from Settings > Other.
 */
export default function QrCodePage() {
  const params = useParams<{ id: string }>();
  const instanceId = params.id;

  const [instance, setInstance] = useState<DeviceInstanceDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/device-instances/${instanceId}`)
      .then((res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled || !data) return;
        setInstance(data.instance);
      });
    return () => {
      cancelled = true;
    };
  }, [instanceId]);

  useEffect(() => {
    if (!instance) return;
    let cancelled = false;

    (async () => {
      const images: Record<string, string> = {};
      for (const key of QR_PARAMETER_KEYS) {
        const url = instance.parameters.find((p) => p.key === key)?.value?.trim();
        if (!url) continue;
        images[key] = await QRCode.toDataURL(url, { margin: 1, width: 220 });
      }
      if (!cancelled) setQrImages(images);
    })();

    return () => {
      cancelled = true;
    };
  }, [instance]);

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

  const configuredKeys = QR_PARAMETER_KEYS.filter((key) => qrImages[key]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-1">
        <Link href={`/instances/${instanceId}`} className="text-xs text-zinc-500 hover:underline">
          ← {instance.name}
        </Link>
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">QR code</h1>
        <p className="text-sm text-zinc-500">
          Set from Settings &gt; Other (<code className="font-mono text-xs">qrCodeUrl1</code>/
          <code className="font-mono text-xs">qrCodeUrl2</code>), or remotely by the CSMS via
          <code className="font-mono text-xs"> ChangeConfiguration</code>.
        </p>
      </div>

      {configuredKeys.length === 0 ? (
        <p className="text-sm text-zinc-500">No QR codes configured for this instance yet.</p>
      ) : (
        <div className="flex flex-wrap gap-6">
          {configuredKeys.map((key) => {
            const url = instance.parameters.find((p) => p.key === key)?.value ?? "";
            return (
              <div
                key={key}
                className="flex flex-col items-center gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- data: URL, not an optimizable remote image */}
                <img src={qrImages[key]} alt={`QR code for ${url}`} width={220} height={220} />
                <p className="max-w-[220px] break-all text-center text-xs text-zinc-500">{url}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
