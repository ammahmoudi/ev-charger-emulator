import { orderModelConnectors, type OrderedDeviceModelConnector } from "@/lib/device-instances/connectors";
import { listConnectorStates } from "@/lib/device-instances/connector-sessions";
import { logDeviceInstanceEvent } from "@/lib/device-instances/events";
import { buildDefaultParameterValues } from "@/lib/device-instances/parameters";
import { listDeviceInstanceEvents, listDeviceInstanceSessions } from "@/lib/device-instances/serialize";
import { prisma } from "@/lib/prisma";

/** How long a simulated firmware upgrade keeps connectors Unavailable before flipping back. */
export const FIRMWARE_UPGRADE_DURATION_MS = 2500;

/**
 * Key of the DeviceModelParameter that represents the board's firmware version (seeded on
 * PEVC3107E as "403" — see prisma/seed.ts). The Maintenance tab's "Upgrade Board Program"
 * action bumps this same instance parameter, so the version shown there always matches what
 * the Setting → Device tab (#12) displays — there is no separate firmware field.
 */
const FIRMWARE_PARAMETER_KEY = "firmwareVersion";

/** The instance's current firmware-version parameter row, if its device model defines one. */
async function getFirmwareParameter(instanceId: string) {
  return prisma.deviceInstanceParameter.findFirst({
    where: { deviceInstanceId: instanceId, key: FIRMWARE_PARAMETER_KEY },
  });
}

async function loadModelConnectors(instanceId: string): Promise<OrderedDeviceModelConnector[]> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });
  return orderModelConnectors(instance.deviceModel.connectors);
}

/** Full Maintenance-tab state: firmware version, live connector runtime state, and event/session counts. */
export async function getMaintenanceState(instanceId: string) {
  await resolveStaleFirmwareUpgrade(instanceId);

  const [firmwareParameter, connectors, events, sessions] = await Promise.all([
    getFirmwareParameter(instanceId),
    listConnectorStates(instanceId),
    listDeviceInstanceEvents(instanceId, 1, 1),
    listDeviceInstanceSessions(instanceId, 1, 1),
  ]);

  return {
    firmwareVersion: firmwareParameter?.value ?? null,
    connectors,
    eventCount: events.totalCount,
    chargingSessionCount: sessions.totalCount,
  };
}

/** Resets every parameter value on an instance back to its model parameter's default. */
export async function resetInstanceParametersToDefaults(instanceId: string): Promise<void> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { deviceModel: { include: { parameters: true } } },
  });

  const defaults = buildDefaultParameterValues(instance.deviceModel.parameters);

  await prisma.$transaction(
    instance.deviceModel.parameters.map((parameter) =>
      prisma.deviceInstanceParameter.update({
        where: {
          deviceInstanceId_deviceModelParameterId: { deviceInstanceId: instanceId, deviceModelParameterId: parameter.id },
        },
        data: { value: defaults.get(parameter.id) ?? null },
      }),
    ),
  );

  await logDeviceInstanceEvent(instanceId, "MAINTENANCE", "Restore factory setting: parameters reset to defaults");
}

/**
 * Deletes all event-log rows for an instance, then appends the "Event Clear" record the real
 * device itself logs for this action (see docs/device-reference/PEVC3107E/README.md).
 */
export async function clearInstanceEventRecord(instanceId: string): Promise<{ clearedCount: number }> {
  await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId }, select: { id: true } });
  const clearedCount = await prisma.deviceInstanceEvent.count({ where: { deviceInstanceId: instanceId } });
  await prisma.deviceInstanceEvent.deleteMany({ where: { deviceInstanceId: instanceId } });
  await logDeviceInstanceEvent(instanceId, "MAINTENANCE", "Event Clear");
  return { clearedCount };
}

/** Deletes all charging-session/cost rows for an instance. */
export async function clearInstanceConsumptionRecord(instanceId: string): Promise<{ clearedCount: number }> {
  await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId }, select: { id: true } });
  const clearedCount = await prisma.deviceInstanceSession.count({ where: { deviceInstanceId: instanceId } });
  await prisma.deviceInstanceSession.deleteMany({ where: { deviceInstanceId: instanceId } });
  return { clearedCount };
}

/**
 * Increments a dotted version string's last numeric segment, e.g. "1.0.0" -> "1.0.1".
 * Falls back to appending ".1" if the last segment isn't numeric.
 */
export function bumpFirmwareVersion(version: string): string {
  const segments = version.split(".");
  const last = segments[segments.length - 1];
  if (/^\d+$/.test(last)) {
    segments[segments.length - 1] = String(Number(last) + 1);
    return segments.join(".");
  }
  return `${version}.1`;
}

const globalForUpgrades = globalThis as unknown as {
  deviceInstanceUpgradeTimers: Map<string, ReturnType<typeof setTimeout>> | undefined;
};

// Survives Next.js dev-server hot reloads, same pattern as runtime.ts's registry.
const upgradeTimers = globalForUpgrades.deviceInstanceUpgradeTimers ?? new Map<string, ReturnType<typeof setTimeout>>();
if (process.env.NODE_ENV !== "production") {
  globalForUpgrades.deviceInstanceUpgradeTimers = upgradeTimers;
}

/**
 * Sets every connector's persisted runtime status (issue #14's `DeviceInstanceConnectorState`,
 * the same table the Lock/Cost screens read/write) and logs a STATUS_CHANGE event per
 * connector, matching how `connector-sessions.ts` logs its own status transitions.
 */
async function setConnectorsStatus(
  instanceId: string,
  connectors: OrderedDeviceModelConnector[],
  status: "Available" | "Unavailable",
): Promise<void> {
  await prisma.$transaction(
    connectors.map((c) =>
      prisma.deviceInstanceConnectorState.upsert({
        where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: c.connectorId } },
        create: { deviceInstanceId: instanceId, connectorId: c.connectorId, status },
        update: { status },
      }),
    ),
  );
  for (const c of connectors) {
    await logDeviceInstanceEvent(instanceId, "STATUS_CHANGE", `${c.displayLabel} status changed to ${status}`);
  }
}

/**
 * Finishes an in-flight firmware upgrade: flips connectors back to Available and bumps the
 * firmware version. Guarded by a conditional update on `DeviceInstance.firmwareUpgradeStartedAt`
 * (cleared atomically here) so it's safe to call from both the in-memory completion timer and
 * `resolveStaleFirmwareUpgrade` without double-completing (e.g. a restart racing the original
 * timer's last moment).
 */
async function completeFirmwareUpgrade(instanceId: string, connectors: OrderedDeviceModelConnector[]): Promise<void> {
  const { count } = await prisma.deviceInstance.updateMany({
    where: { id: instanceId, firmwareUpgradeStartedAt: { not: null } },
    data: { firmwareUpgradeStartedAt: null },
  });
  if (count === 0) return;

  await setConnectorsStatus(instanceId, connectors, "Available");
  const firmwareParameter = await getFirmwareParameter(instanceId);
  let newVersion: string | null = null;
  if (firmwareParameter) {
    newVersion = bumpFirmwareVersion(firmwareParameter.value ?? "0");
    await prisma.deviceInstanceParameter.update({ where: { id: firmwareParameter.id }, data: { value: newVersion } });
  }
  await logDeviceInstanceEvent(
    instanceId,
    "MAINTENANCE",
    newVersion ? `Board upgrade completed (firmware v${newVersion})` : "Board upgrade completed",
  );
}

/**
 * Detects a firmware upgrade that was left in-flight (`DeviceInstance.firmwareUpgradeStartedAt`
 * set) with no owning in-memory timer in this process — e.g. the process restarted mid-upgrade,
 * losing `upgradeTimers`' `setTimeout` — and, once its duration has actually elapsed, completes
 * it immediately instead of leaving connectors stuck `Unavailable` forever. Called from
 * `getMaintenanceState` (the read path the Maintenance tab polls), mirroring how
 * `connector-sessions.ts`'s promotions are resolved lazily on read rather than via a background job.
 */
async function resolveStaleFirmwareUpgrade(instanceId: string): Promise<void> {
  if (upgradeTimers.has(instanceId)) return; // A timer in this process already owns completion.

  const instance = await prisma.deviceInstance.findUnique({
    where: { id: instanceId },
    select: { firmwareUpgradeStartedAt: true },
  });
  if (!instance?.firmwareUpgradeStartedAt) return;
  if (Date.now() - instance.firmwareUpgradeStartedAt.getTime() < FIRMWARE_UPGRADE_DURATION_MS) return;

  const connectors = await loadModelConnectors(instanceId);
  await completeFirmwareUpgrade(instanceId, connectors);
}

/**
 * Simulates a firmware ("board program") upgrade: connectors go Unavailable immediately, then
 * flip back to Available and the firmware version bumps once FIRMWARE_UPGRADE_DURATION_MS has
 * elapsed. Returns immediately after marking connectors Unavailable; callers should poll
 * getMaintenanceState() to observe completion. `firmwareUpgradeStartedAt` is persisted so a
 * process restart mid-upgrade can be detected and finished by `resolveStaleFirmwareUpgrade`
 * instead of leaving connectors stuck `Unavailable`.
 */
export async function startFirmwareUpgrade(instanceId: string) {
  const connectors = await loadModelConnectors(instanceId);

  const existingTimer = upgradeTimers.get(instanceId);
  if (existingTimer) clearTimeout(existingTimer);

  await setConnectorsStatus(instanceId, connectors, "Unavailable");
  await prisma.deviceInstance.update({ where: { id: instanceId }, data: { firmwareUpgradeStartedAt: new Date() } });
  await logDeviceInstanceEvent(instanceId, "MAINTENANCE", "Board upgrade started");

  const timer = setTimeout(() => {
    upgradeTimers.delete(instanceId);
    void completeFirmwareUpgrade(instanceId, connectors).catch(() => {
      // Instance may have been deleted while the upgrade delay was pending.
    });
  }, FIRMWARE_UPGRADE_DURATION_MS);

  upgradeTimers.set(instanceId, timer);

  return getMaintenanceState(instanceId);
}
