/**
 * Simulated per-instance status/diagnostics state (issue #4), kept in-memory alongside the
 * persisted DeviceInstance — not Prisma-backed, per the issue's acceptance criteria. Every
 * instance starts "normally healthy"; individual fields can be flipped to "abnormal" for
 * testing, matching real captures where e.g. Circuit breaker Status, Emergency, and Cabinet
 * Door each went abnormal independently while the rest of the grid stayed normal.
 *
 * Numeric readouts (temperatures, voltages, currents, error codes) are not persisted values —
 * they're recomputed with small jitter around a baseline on every read, so the screens show
 * "live" telemetry instead of frozen constants, without needing a polling/tick loop.
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
  plugOutputCurrentBaseline: Map<string, number>;
}

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

function getOrCreateState(instanceId: string): DeviceDiagnosticState {
  let state = registry.get(instanceId);
  if (!state) {
    state = {
      overall: createDefaultOverallHealth(),
      plugs: new Map(),
      modules: Array.from({ length: COMMUNICATION_MODULE_COUNT }, () => "normal"),
      plugOutputCurrentBaseline: new Map(),
    };
    registry.set(instanceId, state);
  }
  return state;
}

function getOrCreatePlug(state: DeviceDiagnosticState, connectorId: string): InterfaceBoardReading {
  let plug = state.plugs.get(connectorId);
  if (!plug) {
    plug = createDefaultInterfaceBoard();
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

export function getOverallHealth(instanceId: string): OverallHealth {
  return { ...getOrCreateState(instanceId).overall };
}

export function setOverallHealthField(instanceId: string, field: OverallHealthField, value: HealthStatus): OverallHealth {
  const state = getOrCreateState(instanceId);
  state.overall[field] = value;
  return { ...state.overall };
}

/** Returns a plug's interface-board reading with numeric fields jittered around baseline (comm/health fields are exactly as toggled). */
export function getInterfaceBoardReading(instanceId: string, connectorId: string): InterfaceBoardReading {
  const plug = getOrCreatePlug(getOrCreateState(instanceId), connectorId);
  return {
    ...plug,
    adSamplingVoltage: plug.adSamplingVoltage === 0 && plug.seccCommunication === "normal" ? 0 : jitter(plug.adSamplingVoltage, 0.3),
    temperatureSampling1: jitter(plug.temperatureSampling1, 1, 0),
    temperatureSampling2: jitter(plug.temperatureSampling2, 1, 0),
    ccVoltage: jitter(plug.ccVoltage, 0.05, 2),
  };
}

export function setInterfaceBoardToggleField(
  instanceId: string,
  connectorId: string,
  field: InterfaceBoardToggleField,
  value: HealthStatus,
): InterfaceBoardReading {
  const state = getOrCreateState(instanceId);
  const plug = getOrCreatePlug(state, connectorId);
  plug[field] = value;
  // Keep the PLC error code / EV error code consistent with the health flags that gate them,
  // mirroring the real device where a nonzero code accompanies the abnormal comm flag.
  if (field === "interfaceBoardCommunication") plug.plcErrorCode = value === "abnormal" ? "0x11" : "0x00";
  if (field === "seccCommunication") plug.evErrorCode = value === "abnormal" ? 1 : 0;
  return { ...plug };
}

export function setContactorField(instanceId: string, connectorId: string, field: ContactorField, value: ContactStatus): InterfaceBoardReading {
  const state = getOrCreateState(instanceId);
  const plug = getOrCreatePlug(state, connectorId);
  plug[field] = value;
  return { ...plug };
}

export function getCommunicationModules(instanceId: string): CommunicationModule[] {
  const state = getOrCreateState(instanceId);
  return state.modules.map((comm) => ({
    comm,
    voltage: comm === "normal" ? jitter(230, 2) : jitter(180, 15),
    current: comm === "normal" ? jitter(16, 1.5) : jitter(3, 2),
  }));
}

export function setCommunicationModuleField(instanceId: string, moduleIndex: number, value: HealthStatus): CommunicationModule[] {
  const state = getOrCreateState(instanceId);
  if (moduleIndex < 0 || moduleIndex >= state.modules.length) {
    throw new RangeError(`moduleIndex must be between 0 and ${state.modules.length - 1}`);
  }
  state.modules[moduleIndex] = value;
  return getCommunicationModules(instanceId);
}

/** Simulated per-plug output current (A) shown at the bottom of the communication screen. */
export function getPlugOutputCurrent(instanceId: string, connectorId: string): number {
  const state = getOrCreateState(instanceId);
  let baseline = state.plugOutputCurrentBaseline.get(connectorId);
  if (baseline === undefined) {
    baseline = 0;
    state.plugOutputCurrentBaseline.set(connectorId, baseline);
  }
  return baseline === 0 ? 0 : jitter(baseline, 0.5);
}
