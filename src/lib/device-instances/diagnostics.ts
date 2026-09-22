import type { Prisma } from "@prisma/client";

import { orderModelConnectors } from "@/lib/device-instances/connectors";
import { prisma } from "@/lib/prisma";

/**
 * Simulated per-instance status/diagnostics state (issue #4). The *toggled* fields (the health/
 * comm flags below, `OVERALL_HEALTH_FIELDS`/`INTERFACE_BOARD_TOGGLE_FIELDS`/`CONTACTOR_FIELDS`/
 * per-module comm flags) are persisted (`DeviceInstance.diagnosticsInstanceState` for the
 * instance-level grid + modules, `DeviceInstanceConnectorDiagnosticState.diagnosticsToggles` per
 * plug) so a fault injected for testing survives a restart, matching a real device's fault flags.
 * An in-memory `Map` (`registry` below) still caches state per instance within a single process
 * (avoiding a DB round-trip on every poll), populated from Postgres on first access.
 *
 * Numeric readouts (temperatures, voltages, currents, error codes) are NOT persisted — they're
 * recomputed with small jitter around a baseline on every read, so the screens show "live"
 * telemetry instead of frozen constants, without needing a polling/tick loop. Two exceptions
 * derive from real persisted data instead of a fixed/random baseline: a plug's output current
 * comes from its connector's actual active charging session
 * (`connector-sessions.ts`/`DeviceInstanceConnectorState`), and its lifetime `energyTotal` comes
 * from summing its completed `DeviceInstanceSession` rows — see `getPlugOutputCurrent` and
 * `getInterfaceBoardReading`.
 */

export type HealthStatus = "normal" | "abnormal";
export type ContactStatus = "open" | "closed";

export interface OverallHealth {
  powerSupplyOverVoltage: HealthStatus;
  powerSupplyUnderVoltage: HealthStatus;
  equipmentTemperature: HealthStatus;
  circuitBreakerStatus: HealthStatus;
  emergency: HealthStatus;
  cardDetector: HealthStatus;
  contactorStatus: HealthStatus;
  controlSystem: HealthStatus;
  cabinetDoor: HealthStatus;
  spd: HealthStatus;
  storageState: HealthStatus;
  communicationOfChargeModule: HealthStatus;
  mainProgramVersion: string;
  interfaceProgramVersion: string;
}

export const OVERALL_HEALTH_FIELDS = [
  "powerSupplyOverVoltage",
  "powerSupplyUnderVoltage",
  "equipmentTemperature",
  "circuitBreakerStatus",
  "emergency",
  "cardDetector",
  "contactorStatus",
  "controlSystem",
  "cabinetDoor",
  "spd",
  "storageState",
  "communicationOfChargeModule",
] as const satisfies readonly (keyof OverallHealth)[];

export type OverallHealthField = (typeof OVERALL_HEALTH_FIELDS)[number];

export interface InterfaceBoardReading {
  adSamplingVoltage: number;
  seccCommunication: HealthStatus;
  temperatureSampling1: number;
  temperatureSampling2: number;
  meterCommunication: HealthStatus;
  plcErrorCode: string;
  interfaceBoardCommunication: HealthStatus;
  fuseStatus: HealthStatus;
  evErrorCode: number;
  km1Status: ContactStatus;
  km2Status: ContactStatus;
  ccVoltage: number;
  energyTotal: number;
}

export const INTERFACE_BOARD_TOGGLE_FIELDS = [
  "seccCommunication",
  "meterCommunication",
  "interfaceBoardCommunication",
  "fuseStatus",
] as const satisfies readonly (keyof InterfaceBoardReading)[];

export type InterfaceBoardToggleField = (typeof INTERFACE_BOARD_TOGGLE_FIELDS)[number];

export const CONTACTOR_FIELDS = ["km1Status", "km2Status"] as const satisfies readonly (keyof InterfaceBoardReading)[];
export type ContactorField = (typeof CONTACTOR_FIELDS)[number];

/** One power module readout in the 7x2 communication grid. "comm" is the module's own comm-health flag ("G" on the real device). */
export interface CommunicationModule {
  comm: HealthStatus;
  voltage: number;
  current: number;
}

export const COMMUNICATION_MODULE_COLUMNS = 7;
export const COMMUNICATION_MODULE_ROWS = 2;
export const COMMUNICATION_MODULE_COUNT = COMMUNICATION_MODULE_COLUMNS * COMMUNICATION_MODULE_ROWS;

interface DeviceDiagnosticState {
  overall: OverallHealth;
  plugs: Map<string, InterfaceBoardReading>;
  modules: HealthStatus[];
}

/** Nominal DC bus voltage assumed when deriving a plausible output current from a charge rate (kW). */
const NOMINAL_DC_VOLTAGE = 400;

function createDefaultOverallHealth(): OverallHealth {
  return {
    powerSupplyOverVoltage: "normal",
    powerSupplyUnderVoltage: "normal",
    equipmentTemperature: "normal",
    circuitBreakerStatus: "normal",
    emergency: "normal",
    cardDetector: "normal",
    contactorStatus: "normal",
    controlSystem: "normal",
    cabinetDoor: "normal",
    spd: "normal",
    storageState: "normal",
    communicationOfChargeModule: "normal",
    mainProgramVersion: "0xb220",
    interfaceProgramVersion: "V2.1.2",
  };
}

function createDefaultInterfaceBoard(): InterfaceBoardReading {
  return {
    adSamplingVoltage: 0,
    seccCommunication: "normal",
    temperatureSampling1: 27,
    temperatureSampling2: 28,
    meterCommunication: "normal",
    plcErrorCode: "0x00",
    interfaceBoardCommunication: "normal",
    fuseStatus: "normal",
    evErrorCode: 0,
    km1Status: "open",
    km2Status: "open",
    ccVoltage: 12.33,
    energyTotal: 0.444,
  };
}

const globalForDiagnostics = globalThis as unknown as {
  deviceDiagnosticsRegistry: Map<string, DeviceDiagnosticState> | undefined;
};

// Survives Next.js dev-server hot reloads, same pattern as runtime.ts / prisma.ts.
const registry = globalForDiagnostics.deviceDiagnosticsRegistry ?? new Map<string, DeviceDiagnosticState>();
if (process.env.NODE_ENV !== "production") {
  globalForDiagnostics.deviceDiagnosticsRegistry = registry;
}

interface PersistedInstanceDiagnostics {
  overall?: Partial<OverallHealth>;
  modules?: HealthStatus[];
}

async function loadPersistedInstanceState(instanceId: string): Promise<PersistedInstanceDiagnostics | null> {
  const row = await prisma.deviceInstance.findUnique({
    where: { id: instanceId },
    select: { diagnosticsInstanceState: true },
  });
  return (row?.diagnosticsInstanceState as PersistedInstanceDiagnostics | null) ?? null;
}

async function persistInstanceState(instanceId: string, state: DeviceDiagnosticState): Promise<void> {
  const data: PersistedInstanceDiagnostics = { overall: state.overall, modules: state.modules };
  try {
    await prisma.deviceInstance.update({
      where: { id: instanceId },
      data: { diagnosticsInstanceState: data as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error(`Failed to persist diagnostics instance state for ${instanceId}:`, err);
  }
}

async function getOrCreateState(instanceId: string): Promise<DeviceDiagnosticState> {
  let state = registry.get(instanceId);
  if (!state) {
    const persisted = await loadPersistedInstanceState(instanceId);
    state = {
      overall: { ...createDefaultOverallHealth(), ...persisted?.overall },
      plugs: new Map(),
      modules: persisted?.modules ?? Array.from({ length: COMMUNICATION_MODULE_COUNT }, () => "normal"),
    };
    registry.set(instanceId, state);
  }
  return state;
}

/** `InterfaceBoardReading`'s toggle-only fields — everything persisted for a plug (`renderInterfaceBoard` fills in jittered/derived fields on read). */
type PersistedPlugDiagnostics = Pick<
  InterfaceBoardReading,
  "seccCommunication" | "meterCommunication" | "interfaceBoardCommunication" | "fuseStatus" | "km1Status" | "km2Status" | "plcErrorCode" | "evErrorCode"
>;

function extractPersistedPlugFields(plug: InterfaceBoardReading): PersistedPlugDiagnostics {
  return {
    seccCommunication: plug.seccCommunication,
    meterCommunication: plug.meterCommunication,
    interfaceBoardCommunication: plug.interfaceBoardCommunication,
    fuseStatus: plug.fuseStatus,
    km1Status: plug.km1Status,
    km2Status: plug.km2Status,
    plcErrorCode: plug.plcErrorCode,
    evErrorCode: plug.evErrorCode,
  };
}

async function persistPlugToggles(instanceId: string, connectorId: string, plug: InterfaceBoardReading): Promise<void> {
  const numericConnectorId = await resolveNumericConnectorId(instanceId, connectorId);
  if (numericConnectorId == null) return;
  const toggles = extractPersistedPlugFields(plug);
  try {
    await prisma.deviceInstanceConnectorDiagnosticState.upsert({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: numericConnectorId } },
      create: { deviceInstanceId: instanceId, connectorId: numericConnectorId, diagnosticsToggles: toggles as Prisma.InputJsonValue },
      update: { diagnosticsToggles: toggles as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error(`Failed to persist diagnostics toggles for ${instanceId} connector ${connectorId}:`, err);
  }
}

async function getOrCreatePlug(instanceId: string, state: DeviceDiagnosticState, connectorId: string): Promise<InterfaceBoardReading> {
  let plug = state.plugs.get(connectorId);
  if (!plug) {
    const numericConnectorId = await resolveNumericConnectorId(instanceId, connectorId);
    let persisted: Partial<PersistedPlugDiagnostics> | null = null;
    if (numericConnectorId != null) {
      const row = await prisma.deviceInstanceConnectorDiagnosticState.findUnique({
        where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: numericConnectorId } },
      });
      persisted = (row?.diagnosticsToggles as Partial<PersistedPlugDiagnostics> | null) ?? null;
    }
    plug = { ...createDefaultInterfaceBoard(), ...persisted };
    state.plugs.set(connectorId, plug);
  }
  return plug;
}

function jitter(base: number, spread: number, decimals = 1): number {
  const value = base + (Math.random() * 2 - 1) * spread;
  return Number(value.toFixed(decimals));
}

/** Tears down any in-memory diagnostic state for an instance. Call when deleting it. */
export function disposeDiagnosticState(instanceId: string): void {
  registry.delete(instanceId);
}

export async function getOverallHealth(instanceId: string): Promise<OverallHealth> {
  const state = await getOrCreateState(instanceId);
  return { ...state.overall };
}

export async function setOverallHealthField(instanceId: string, field: OverallHealthField, value: HealthStatus): Promise<OverallHealth> {
  const state = await getOrCreateState(instanceId);
  state.overall[field] = value;
  await persistInstanceState(instanceId, state);
  return { ...state.overall };
}

/**
 * Maps a plug's `DeviceModelConnector.id` (the string id the diagnostics API routes key
 * readings by) to the flat, sequential OCPP `connectorId` (1-based) that
 * `DeviceInstanceConnectorState`/`DeviceInstanceSession` are keyed by elsewhere in the app (see
 * `connectors.ts::orderModelConnectors`). Returns `null` if the instance or connector doesn't
 * exist (e.g. a not-yet-persisted instance in a unit test) — callers fall back to defaults.
 */
async function resolveNumericConnectorId(instanceId: string, connectorId: string): Promise<number | null> {
  const instance = await prisma.deviceInstance.findUnique({
    where: { id: instanceId },
    select: { deviceModel: { select: { connectors: true } } },
  });
  if (!instance) return null;
  const connector = orderModelConnectors(instance.deviceModel.connectors).find((c) => c.id === connectorId);
  return connector?.connectorId ?? null;
}

/**
 * A plug's lifetime energy counter: `energyTotal` isn't a hardcoded constant, it's the factory
 * baseline (a plug ships having already delivered some energy during production testing) plus
 * every completed `DeviceInstanceSession`'s energy for that connector — so it actually
 * accumulates as sessions run, like the real device's Setting-screen counter does.
 */
async function computeEnergyTotal(instanceId: string, connectorId: string, baselineKwh: number): Promise<number> {
  const numericConnectorId = await resolveNumericConnectorId(instanceId, connectorId);
  if (numericConnectorId == null) return baselineKwh;

  const { _sum } = await prisma.deviceInstanceSession.aggregate({
    where: { deviceInstanceId: instanceId, connectorId: numericConnectorId },
    _sum: { energyWh: true },
  });
  const sessionsKwh = (_sum.energyWh ?? 0) / 1000;
  return Number((baselineKwh + sessionsKwh).toFixed(3));
}

async function renderInterfaceBoard(instanceId: string, connectorId: string, plug: InterfaceBoardReading): Promise<InterfaceBoardReading> {
  return {
    ...plug,
    adSamplingVoltage: plug.adSamplingVoltage === 0 && plug.seccCommunication === "normal" ? 0 : jitter(plug.adSamplingVoltage, 0.3),
    temperatureSampling1: jitter(plug.temperatureSampling1, 1, 0),
    temperatureSampling2: jitter(plug.temperatureSampling2, 1, 0),
    ccVoltage: jitter(plug.ccVoltage, 0.05, 2),
    energyTotal: await computeEnergyTotal(instanceId, connectorId, plug.energyTotal),
  };
}

/** Returns a plug's interface-board reading with numeric fields jittered around baseline (comm/health fields are exactly as toggled). */
export async function getInterfaceBoardReading(instanceId: string, connectorId: string): Promise<InterfaceBoardReading> {
  const state = await getOrCreateState(instanceId);
  const plug = await getOrCreatePlug(instanceId, state, connectorId);
  return renderInterfaceBoard(instanceId, connectorId, plug);
}

export async function setInterfaceBoardToggleField(
  instanceId: string,
  connectorId: string,
  field: InterfaceBoardToggleField,
  value: HealthStatus,
): Promise<InterfaceBoardReading> {
  const state = await getOrCreateState(instanceId);
  const plug = await getOrCreatePlug(instanceId, state, connectorId);
  plug[field] = value;
  // Keep the PLC error code / EV error code consistent with the health flags that gate them,
  // mirroring the real device where a nonzero code accompanies the abnormal comm flag.
  if (field === "interfaceBoardCommunication") plug.plcErrorCode = value === "abnormal" ? "0x11" : "0x00";
  if (field === "seccCommunication") plug.evErrorCode = value === "abnormal" ? 1 : 0;
  await persistPlugToggles(instanceId, connectorId, plug);
  return renderInterfaceBoard(instanceId, connectorId, plug);
}

export async function setContactorField(
  instanceId: string,
  connectorId: string,
  field: ContactorField,
  value: ContactStatus,
): Promise<InterfaceBoardReading> {
  const state = await getOrCreateState(instanceId);
  const plug = await getOrCreatePlug(instanceId, state, connectorId);
  plug[field] = value;
  await persistPlugToggles(instanceId, connectorId, plug);
  return renderInterfaceBoard(instanceId, connectorId, plug);
}

export async function getCommunicationModules(instanceId: string): Promise<CommunicationModule[]> {
  const state = await getOrCreateState(instanceId);
  return state.modules.map((comm) => ({
    comm,
    voltage: comm === "normal" ? jitter(230, 2) : jitter(180, 15),
    current: comm === "normal" ? jitter(16, 1.5) : jitter(3, 2),
  }));
}

export async function setCommunicationModuleField(instanceId: string, moduleIndex: number, value: HealthStatus): Promise<CommunicationModule[]> {
  const state = await getOrCreateState(instanceId);
  if (moduleIndex < 0 || moduleIndex >= state.modules.length) {
    throw new RangeError(`moduleIndex must be between 0 and ${state.modules.length - 1}`);
  }
  state.modules[moduleIndex] = value;
  await persistInstanceState(instanceId, state);
  return getCommunicationModules(instanceId);
}

/**
 * Simulated per-plug output current (A) shown at the bottom of the communication screen —
 * derived from the connector's actual active charging session (`DeviceInstanceConnectorState`),
 * not a fixed baseline: zero while `Available`/`Preparing`/idle, and a plausible current
 * (session's charge rate over a nominal DC bus voltage) while `Charging`, jittered like the
 * rest of this module's "live" readouts.
 */
export async function getPlugOutputCurrent(instanceId: string, connectorId: string): Promise<number> {
  const numericConnectorId = await resolveNumericConnectorId(instanceId, connectorId);
  if (numericConnectorId == null) return 0;

  const connectorState = await prisma.deviceInstanceConnectorState.findUnique({
    where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: numericConnectorId } },
  });
  if (connectorState?.status !== "Charging" || !connectorState.activeChargeRateKw) return 0;

  const baseline = (connectorState.activeChargeRateKw * 1000) / NOMINAL_DC_VOLTAGE;
  return jitter(baseline, 0.5);
}
