import { DeviceConnectionStatus, type DeviceInstance } from "@prisma/client";

import { OcppClient } from "@/lib/ocpp";
import { prisma } from "@/lib/prisma";

/**
 * Per-instance OCPP connection runtime, kept in-memory alongside the persisted
 * DeviceInstance.status. One entry exists per instance that has ever been started in this
 * process; the OcppClient is constructed eagerly so a later issue (#8/#9/#10) can call
 * `entry.client.connect()` in place of the stub below without changing this module's shape.
 */
interface RuntimeEntry {
  client: OcppClient;
  stubTimer: ReturnType<typeof setTimeout> | null;
}

// Issue #3 scope: no real OCPP handshake yet, just a fixed delay so the status badge
// visibly passes through CONNECTING before settling, mirroring what a real connect will do.
const STUB_CONNECT_DELAY_MS = 400;

const globalForRuntime = globalThis as unknown as {
  deviceInstanceRuntime: Map<string, RuntimeEntry> | undefined;
};

// Survives Next.js dev-server hot reloads, same pattern as src/lib/prisma.ts.
const registry = globalForRuntime.deviceInstanceRuntime ?? new Map<string, RuntimeEntry>();
if (process.env.NODE_ENV !== "production") {
  globalForRuntime.deviceInstanceRuntime = registry;
}

function getOrCreateEntry(instance: DeviceInstance): RuntimeEntry {
  let entry = registry.get(instance.id);
  if (!entry) {
    entry = { client: new OcppClient({ url: instance.csmsUrl }), stubTimer: null };
    registry.set(instance.id, entry);
  }
  return entry;
}

function clearStubTimer(entry: RuntimeEntry): void {
  if (entry.stubTimer) {
    clearTimeout(entry.stubTimer);
    entry.stubTimer = null;
  }
}

/**
 * Starts an instance's connection. Issue #3 scope: this does NOT open a real WebSocket —
 * it optimistically flips the stored status to CONNECTING then CONNECTED, while
 * constructing the OcppClient the later real-connect issues will drive. Replace the
 * setTimeout stub below with `entry.client.connect()` (and drop the direct status writes,
 * relying on the client's connecting/connected/disconnected/error events instead) once
 * boot notification / connectivity (issues #8/#9/#10) land.
 */
export async function startDeviceInstance(instanceId: string): Promise<DeviceInstance> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId } });
  const entry = getOrCreateEntry(instance);
  clearStubTimer(entry);

  const connecting = await prisma.deviceInstance.update({
    where: { id: instanceId },
    data: { status: DeviceConnectionStatus.CONNECTING, statusReason: null },
  });

  entry.stubTimer = setTimeout(() => {
    entry.stubTimer = null;
    prisma.deviceInstance
      .update({
        where: { id: instanceId },
        data: { status: DeviceConnectionStatus.CONNECTED, lastConnectedAt: new Date() },
      })
      .catch(() => {
        // Instance may have been deleted or stopped while the stub delay was pending.
      });
  }, STUB_CONNECT_DELAY_MS);

  return connecting;
}

/** Stops an instance's connection: cancels any pending stub, closes the (stub) client, and marks it disconnected. */
export async function stopDeviceInstance(instanceId: string): Promise<DeviceInstance> {
  const entry = registry.get(instanceId);
  if (entry) {
    clearStubTimer(entry);
    entry.client.disconnect();
  }

  return prisma.deviceInstance.update({
    where: { id: instanceId },
    data: { status: DeviceConnectionStatus.DISCONNECTED, statusReason: null },
  });
}

/** Tears down any in-memory runtime state for an instance. Call before/when deleting it. */
export function disposeDeviceInstance(instanceId: string): void {
  const entry = registry.get(instanceId);
  if (!entry) return;
  clearStubTimer(entry);
  entry.client.disconnect();
  registry.delete(instanceId);
}
