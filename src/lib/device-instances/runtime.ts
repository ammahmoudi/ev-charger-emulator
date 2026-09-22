import { DeviceConnectionStatus, type DeviceInstance, type DeviceModel, type DeviceModelConnector } from "@prisma/client";

import { adoptRemoteSession, stopChargingSession } from "@/lib/device-instances/connector-sessions";
import { logDeviceInstanceEvent } from "@/lib/device-instances/events";
import { drainOutbox } from "@/lib/device-instances/outbox";
import { PrismaChargingProfileStore } from "@/lib/device-instances/prisma-charging-profile-store";
import { PrismaConfigurationStore } from "@/lib/device-instances/prisma-configuration-store";
import { PrismaLocalAuthListStore } from "@/lib/device-instances/prisma-local-auth-list-store";
import { PrismaReservationStore } from "@/lib/device-instances/prisma-reservation-store";
import {
  OcppChargePointSession,
  OcppClient,
  registerRemoteCommandHandlers,
  type OcppConnectionState,
  type OcppConnectorStatusInfo,
  type RemoteCommandHandlers,
} from "@/lib/ocpp";
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
  remoteCommands: RemoteCommandHandlers;
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
      // Real hardware reports the reseller-facing brand (e.g. "SINO") as chargePointVendor, not
      // the internal manufacturer code ("PEVC") — confirmed against every real PEVC3107E
      // station's BootNotification in the CitrineOS DB. Fall back to manufacturer for models
      // that don't set a brand.
      chargePointVendor: instance.deviceModel.brand ?? instance.deviceModel.manufacturer,
      chargePointModel: instance.deviceModel.model,
      chargePointSerialNumber: instance.chargePointId,
    },
    connectors: orderModelConnectors(instance.deviceModel.connectors).map((connector) => ({
      connectorId: connector.connectorId,
      label: connector.displayLabel,
    })),
  });

  const remoteCommands = registerRemoteCommandHandlers(client, session, {
    configStore: new PrismaConfigurationStore(instance.id),
    // Prisma-backed stores for ReserveNow/CancelReservation, SetChargingProfile/
    // ClearChargingProfile, and SendLocalList/GetLocalListVersion state, so each survives a
    // restart instead of falling back to src/lib/ocpp's in-memory-only defaults (round 2's job
    // per AUDIT-state.md — the OCPP-layer owner added the injectable store interfaces themselves).
    reservationStore: new PrismaReservationStore(instance.id),
    chargingProfileStore: new PrismaChargingProfileStore(instance.id),
    localAuthListStore: new PrismaLocalAuthListStore(instance.id),
    onError: (err) => {
      if (entry.manuallyStopped) return;
      void writeStatus(instance.id, { statusReason: err.message });
    },
    // Mirror a CSMS-initiated RemoteStartTransaction/RemoteStopTransaction into this instance's
    // Prisma-persisted connector state, the same state `connector-sessions.ts` drives for
    // locally-simulated sessions — otherwise the Home/Cost/Lock/Maintenance screens (which all
    // read that persisted state) never show a remote-started session at all. See
    // AUDIT-integration.md for why this lives here (the DI boundary) rather than in `src/lib/ocpp`.
    onRemoteTransactionStarted: async (connectorId, info) => {
      await adoptRemoteSession(instance.id, connectorId, info);
    },
    onRemoteTransactionStopped: async (connectorId, info) => {
      await stopChargingSession(instance.id, connectorId, {
        stopCause: info.reason === "Remote" ? "Remote Stop" : info.reason,
        skipCsmsNotify: true,
        energyWhOverride: info.meterStopWh,
      });
    },
  });

  const entry: RuntimeEntry = { client, session, remoteCommands, manuallyStopped: false };

  client.on("connecting", () => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { status: DeviceConnectionStatus.CONNECTING });
  });
  client.on("disconnected", () => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { status: DeviceConnectionStatus.DISCONNECTED });
    void logDeviceInstanceEvent(instance.id, "DISCONNECTED", "Dev off-line");
  });
  client.on("error", (err) => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { statusReason: err.message });
  });
  // `OcppChargePointSession` emits "error" for a failed BootNotification/Heartbeat/
  // StatusNotification send (e.g. the connection dropped mid-call) — Node's EventEmitter throws
  // synchronously if an "error" event has no listener, which would otherwise crash the process
  // on a transient send failure instead of just recording it like `client.on("error", ...)` does.
  session.on("error", (err) => {
    if (entry.manuallyStopped) return;
    void writeStatus(instance.id, { statusReason: err.message });
  });
  session.on("bootAccepted", () => {
    void writeStatus(instance.id, {
      status: DeviceConnectionStatus.CONNECTED,
      statusReason: null,
      lastConnectedAt: new Date(),
    });
    void logDeviceInstanceEvent(instance.id, "CONNECTED", "Connected to CSMS");
    void logDeviceInstanceEvent(instance.id, "BOOT", "BootNotification accepted");
    // Replay this instance's offline "local storage" queue (see outbox.ts) now that the CSMS
    // link is back — a real charger flushes queued Start/Stop/MeterValues on reconnect instead
    // of leaving them stranded.
    void drainOutbox(instance.id, (action, payload) => callOcpp(instance.id, action, payload)).catch((err) => {
      console.error(`Failed to drain outbox for ${instance.id}:`, err);
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
    void logDeviceInstanceEvent(instance.id, "FAULT", `BootNotification rejected, retrying in ${Math.round(retryInMs / 1000)}s`);
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

  const instance = await prisma.deviceInstance.update({
    where: { id: instanceId },
    data: { status: DeviceConnectionStatus.DISCONNECTED, statusReason: null },
  });
  void logDeviceInstanceEvent(instanceId, "DISCONNECTED", "Dev off-line");
  return instance;
}

/**
 * Forces a fresh OCPP connection: stops then starts the instance, mirroring what the
 * Maintenance tab's "Restore Factory Setting" → OCPP button does on the real device
 * (closing and re-establishing the CSMS connection, distinct from a parameter reset).
 */
export async function reconnectDeviceInstance(instanceId: string): Promise<DeviceInstance> {
  await stopDeviceInstance(instanceId);
  return startDeviceInstance(instanceId);
}

/** Tears down any in-memory runtime state for an instance. Call before/when deleting it. */
export function disposeDeviceInstance(instanceId: string): void {
  const entry = registry.get(instanceId);
  if (!entry) return;
  entry.manuallyStopped = true;
  entry.remoteCommands.dispose();
  entry.session.dispose();
  entry.client.disconnect();
  registry.delete(instanceId);
}

/** Live, locally-tracked per-connector status for a running instance; empty if never started in this process. */
export function getInstanceConnectorStatuses(instanceId: string): OcppConnectorStatusInfo[] {
  return registry.get(instanceId)?.session.listConnectorStatuses() ?? [];
}

/**
 * The live OCPP connection state for an instance that has been started in this process
 * ("disconnected" if it's never been started at all) — used by the RFID-simulation flow
 * (`src/lib/device-instances/rfid.ts`) to require a real CSMS connection before sending a real
 * `Authorize`/`StartTransaction`.
 */
export function getRuntimeConnectionState(instanceId: string): OcppConnectionState {
  return registry.get(instanceId)?.client.getState() ?? "disconnected";
}

/**
 * Sends a raw OCPP call over an instance's live connection, creating the runtime entry (but not
 * opening the WebSocket — callers must check `getRuntimeConnectionState` first) if needed. Kept
 * as a thin wrapper rather than exposing the raw `OcppClient` so callers can't reach past it into
 * connection lifecycle management (`connect`/`disconnect`), which stays `runtime.ts`'s job.
 */
export async function callOcpp(
  instanceId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });
  return getOrCreateEntry(instance).client.call(action, payload);
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

const globalForReconcile = globalThis as unknown as {
  deviceInstanceRuntimeReconciled: boolean | undefined;
};

/**
 * Re-establishes OCPP connections for every instance whose persisted `status` was `CONNECTED` or
 * `CONNECTING` when this process last stopped. A real charger reconnects to its configured CSMS
 * on power-up without user action, but `registry` above is purely in-memory (by design, for dev
 * hot-reload survival) — so on a genuine process restart nothing reconnects on its own, and
 * `DeviceInstance.status` is left stale ("CONNECTED" in the DB while actually disconnected) until
 * a user manually restarts the instance. Call once per process (e.g. from the device-instances
 * list route, hit on app load); guarded to actually run only once, and safe to call more than
 * once regardless (`startDeviceInstance` is itself idempotent per instance).
 */
export async function reconcileRuntimeOnStartup(): Promise<void> {
  if (globalForReconcile.deviceInstanceRuntimeReconciled) return;
  globalForReconcile.deviceInstanceRuntimeReconciled = true;

  const stale = await prisma.deviceInstance.findMany({
    where: { status: { in: [DeviceConnectionStatus.CONNECTED, DeviceConnectionStatus.CONNECTING] } },
    select: { id: true },
  });

  for (const { id } of stale) {
    try {
      await startDeviceInstance(id);
    } catch (err) {
      console.error(`Failed to reconnect device instance ${id} on startup:`, err);
    }
  }
}
