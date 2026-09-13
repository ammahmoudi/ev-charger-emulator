import { DeviceConnectionStatus, type DeviceInstance, type DeviceModel, type DeviceModelConnector } from "@prisma/client";

import { OcppChargePointSession, OcppClient, type OcppConnectorStatusInfo } from "@/lib/ocpp";
import { orderModelConnectors } from "./connectors";
import { prisma } from "@/lib/prisma";

/**
 * Per-instance OCPP connection runtime, kept in-memory alongside the persisted
 * DeviceInstance.status: an OcppClient/OcppChargePointSession pair per instance that has
 * ever been started in this process. `manuallyStopped` distinguishes a user-requested stop
 * (suppress status writes from the resulting "disconnected"/"error" events, since stop()
 * already writes the final DISCONNECTED status) from an unexpected drop (let the client's
 * built-in reconnect and the event handlers below drive status).
 */
interface RuntimeEntry {
  client: OcppClient;
  session: OcppChargePointSession;
  manuallyStopped: boolean;
}

const globalForRuntime = globalThis as unknown as {
  deviceInstanceRuntime: Map<string, RuntimeEntry> | undefined;
};

// Survives Next.js dev-server hot reloads, same pattern as src/lib/prisma.ts.
const registry = globalForRuntime.deviceInstanceRuntime ?? new Map<string, RuntimeEntry>();
if (process.env.NODE_ENV !== "production") {
  globalForRuntime.deviceInstanceRuntime = registry;
}

type InstanceWithConnectors = DeviceInstance & { deviceModel: DeviceModel & { connectors: DeviceModelConnector[] } };

async function writeStatus(
  instanceId: string,
  data: { status?: DeviceConnectionStatus; statusReason?: string | null; lastConnectedAt?: Date },
): Promise<void> {
  try {
    await prisma.deviceInstance.update({ where: { id: instanceId }, data });
  } catch {
    // Instance may have been deleted while an async runtime event was in flight.
  }
}

function createEntry(instance: InstanceWithConnectors): RuntimeEntry {
  const client = new OcppClient({ url: instance.csmsUrl });
  const session = new OcppChargePointSession(client, {
    identity: {
      chargePointVendor: instance.deviceModel.manufacturer,
      chargePointModel: instance.deviceModel.model,
      chargePointSerialNumber: instance.chargePointId,
    },
    connectors: orderModelConnectors(instance.deviceModel.connectors).map((connector) => ({
      connectorId: connector.connectorId,
      label: connector.displayLabel,
    })),
  });

  const entry: RuntimeEntry = { client, session, manuallyStopped: false };

  client.on("connecting", () => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { status: DeviceConnectionStatus.CONNECTING });
  });
  client.on("disconnected", () => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { status: DeviceConnectionStatus.DISCONNECTED });
  });
  client.on("error", (err) => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { statusReason: err.message });
  });
  session.on("bootAccepted", () => {
    void writeStatus(instance.id, {
      status: DeviceConnectionStatus.CONNECTED,
      statusReason: null,
      lastConnectedAt: new Date(),
    });
  });
  session.on("bootPending", ({ retryInMs }) => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { statusReason: `CSMS boot pending, retrying in ${Math.round(retryInMs / 1000)}s` });
  });
  session.on("bootRejected", ({ retryInMs }) => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, {
      status: DeviceConnectionStatus.FAULTED,
      statusReason: `CSMS rejected boot notification, retrying in ${Math.round(retryInMs / 1000)}s`,
    });
  });

  registry.set(instance.id, entry);
  return entry;
}

function getOrCreateEntry(instance: InstanceWithConnectors): RuntimeEntry {
  return registry.get(instance.id) ?? createEntry(instance);
}

/**
 * Starts an instance's real OCPP connection: opens the WebSocket to its CSMS URL and, once
 * connected, runs the BootNotification/Heartbeat/StatusNotification lifecycle via
 * OcppChargePointSession. Persisted status then tracks the client/session events (see
 * `createEntry`) rather than being written here beyond the optimistic CONNECTING flip.
 */
export async function startDeviceInstance(instanceId: string): Promise<DeviceInstance> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });
  const entry = getOrCreateEntry(instance);
  entry.manuallyStopped = false;

  const connecting = await prisma.deviceInstance.update({
    where: { id: instanceId },
    data: { status: DeviceConnectionStatus.CONNECTING, statusReason: null },
  });

  entry.client.connect();

  return connecting;
}

/** Stops an instance's connection: closes the client (cancelling any pending reconnect) and marks it disconnected. */
export async function stopDeviceInstance(instanceId: string): Promise<DeviceInstance> {
  const entry = registry.get(instanceId);
  if (entry) {
    entry.manuallyStopped = true;
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
  entry.manuallyStopped = true;
  entry.session.dispose();
  entry.client.disconnect();
  registry.delete(instanceId);
}

/** Live, locally-tracked per-connector status for a running instance; empty if never started in this process. */
export function getInstanceConnectorStatuses(instanceId: string): OcppConnectorStatusInfo[] {
  return registry.get(instanceId)?.session.listConnectorStatuses() ?? [];
}

/**
 * Returns (creating if needed) the {@link OcppChargePointSession} wrapping an instance's
 * `OcppClient` — the same session `startDeviceInstance`/`createEntry` use, so local
 * connector-status changes made through it (e.g. from the device-test hardware UI, issue
 * #16) are visible to anything else reading connector status (e.g. `getInstanceConnectorStatuses`,
 * the dashboard's connector chips) and are tracked immediately regardless of connection
 * state — matching real hardware, where a local panel action always updates the panel even
 * when the CSMS link is down. Never opens the WebSocket itself; that's `startDeviceInstance`'s job.
 */
export async function getOrCreateChargePointSession(instanceId: string): Promise<OcppChargePointSession> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });
  return getOrCreateEntry(instance).session;
}
