import type { Prisma } from "@prisma/client";

import type { OcppChargePointSession } from "@/lib/ocpp";
import { prisma } from "@/lib/prisma";
import { orderModelConnectors } from "./connectors";
// Circular import with connector-sessions.ts (which imports isHardwareTestOutputRunning back
// from this file) — safe here since both directions only call functions from inside async
// function bodies, never at module-evaluation time; see the two-way collision guard below.
import { listConnectorStates } from "./connector-sessions";
import { getOrCreateChargePointSession } from "./runtime";
import type {
  AuxPowerAction,
  AuxPowerMode,
  ChargingOutputMode,
  ContactorAction,
  ContactState,
  HardwareTestState,
  LockAction,
  PileContactorTarget,
  PileTestState,
  PlugTestState,
} from "./hardware-test-types";

/**
 * Backing state/service for the bottom-nav "Device" hardware test screen (issue #16).
 *
 * Per the issue, manual test triggers here share the *same* underlying state as #9's local
 * charging simulation and #10's remote commands rather than a separate fake layer: the
 * Charging Test "start/stop test" button and each plug's "Contactor action" both flip one
 * `outputRunning` flag per connector, which is applied to the real `OcppChargePointSession`
 * for the instance via `setConnectorStatus` (issue #8/#10's shared session) — so it is
 * visible to anything else reading connector status, and produces a real `StatusNotification`
 * once the instance is connected. Fields with no real backing concept yet (assist power,
 * electronic lock, GPRS/ICCID/IMEI, temperatures, line voltages, ...) are simulated locally
 * with static/random-jitter values, per the issue's own guidance for hardware-only readouts.
 */

interface ConnectorRef {
  connectorId: number;
  label: string;
}

interface InternalPlugState {
  connectorId: number;
  label: string;
  outputRunning: boolean;
  auxPowerMode: AuxPowerMode;
  lockStatus: "Locked" | "Unlocked";
}

interface InternalPileState {
  threePhaseAcContactor: ContactState;
  powerContactor: ContactState;
  fanContactor: ContactState;
  breakerStatus: ContactState;
}

interface InternalState {
  interfaceBoardTestMode: boolean;
  outputMode: ChargingOutputMode;
  selectedConnectorId: number;
  plugs: Map<number, InternalPlugState>;
  pile: InternalPileState;
  iccid: string;
  imei: string;
}

export class HardwareTestStateError extends Error {}

/** Session statuses `connector-sessions.ts` considers "active" — a hardware output test must not start on top of one of these. */
const ACTIVE_SESSION_STATUSES = new Set(["Preparing", "Charging", "Finishing"]);

export interface HardwareTestStateDeps {
  getConnectors: (instanceId: string) => Promise<ConnectorRef[]>;
  getSession: (instanceId: string) => Promise<Pick<OcppChargePointSession, "setConnectorStatus">>;
  /**
   * Checks whether `connector-sessions.ts` already has an active (`Preparing`/`Charging`/
   * `Finishing`) real/local charging session on this connector — see the collision guard in
   * `setOutputRunning` below. Injectable so tests don't need a real instance/DB row.
   */
  getActiveConnectorSession: (instanceId: string, connectorId: number) => Promise<{ status: string } | null>;
}

async function fetchActiveConnectorSession(instanceId: string, connectorId: number): Promise<{ status: string } | null> {
  const state = (await listConnectorStates(instanceId)).find((c) => c.connectorId === connectorId);
  if (!state || !ACTIVE_SESSION_STATUSES.has(state.status)) return null;
  return { status: state.status };
}

/**
 * Uses the same `orderModelConnectors` numbering the runtime session and the instance
 * detail API agree on (issue #6), so a plug's `connectorId` here always matches the one
 * `getOrCreateChargePointSession`'s `setConnectorStatus` calls apply to.
 */
async function fetchConnectors(instanceId: string): Promise<ConnectorRef[]> {
  const instance = await prisma.deviceInstance.findUniqueOrThrow({
    where: { id: instanceId },
    include: { deviceModel: { include: { connectors: true } } },
  });
  return orderModelConnectors(instance.deviceModel.connectors).map((connector) => ({
    connectorId: connector.connectorId,
    label: connector.displayLabel,
  }));
}

const defaultDeps: HardwareTestStateDeps = {
  getConnectors: fetchConnectors,
  getSession: getOrCreateChargePointSession,
  getActiveConnectorSession: fetchActiveConnectorSession,
};

const globalForHardwareTest = globalThis as unknown as {
  deviceInstanceHardwareTestState: Map<string, InternalState> | undefined;
};

const registry = globalForHardwareTest.deviceInstanceHardwareTestState ?? new Map<string, InternalState>();
if (process.env.NODE_ENV !== "production") {
  globalForHardwareTest.deviceInstanceHardwareTestState = registry;
}

/** FNV-1a — a fast, stable string hash used to seed per-field jitter/pseudo-random values. */
function hashSeed(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededDigits(key: string, length: number): string {
  const rand = mulberry32(hashSeed(key));
  let out = "";
  for (let i = 0; i < length; i++) out += Math.floor(rand() * 10).toString();
  return out;
}

/** Smoothly-varying pseudo-random reading: a sine wave (deterministic per `key`) plus light noise. */
function jitter(key: string, base: number, amplitude: number, periodMs = 5000): number {
  const seed = hashSeed(key);
  const phase = ((seed % 1000) / 1000) * Math.PI * 2;
  const noiseRand = mulberry32(seed ^ Math.floor(Date.now() / 1000));
  const wave = Math.sin(Date.now() / periodMs + phase);
  const noise = (noiseRand() - 0.5) * 0.3;
  return base + amplitude * (wave + noise);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** `InternalState`'s persisted-only fields — chargingTest settings + pile contactor/breaker positions. Everything else (plugs, iccid/imei) is handled separately. */
interface PersistedInstanceSettings {
  chargingTest?: { interfaceBoardTestMode?: boolean; outputMode?: ChargingOutputMode; selectedConnectorId?: number };
  pile?: Partial<InternalPileState>;
}

async function loadPersistedInstanceSettings(instanceId: string): Promise<PersistedInstanceSettings | null> {
  const row = await prisma.deviceInstance.findUnique({ where: { id: instanceId }, select: { hardwareTestInstanceState: true } });
  return (row?.hardwareTestInstanceState as PersistedInstanceSettings | null) ?? null;
}

async function persistInstanceSettings(instanceId: string, state: InternalState): Promise<void> {
  const data: PersistedInstanceSettings = {
    chargingTest: {
      interfaceBoardTestMode: state.interfaceBoardTestMode,
      outputMode: state.outputMode,
      selectedConnectorId: state.selectedConnectorId,
    },
    pile: state.pile,
  };
  try {
    await prisma.deviceInstance.update({
      where: { id: instanceId },
      data: { hardwareTestInstanceState: data as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error(`Failed to persist hardware-test instance settings for ${instanceId}:`, err);
  }
}

interface PersistedPlugToggles {
  outputRunning?: boolean;
  auxPowerMode?: AuxPowerMode;
  lockStatus?: "Locked" | "Unlocked";
}

async function loadPersistedPlugToggles(instanceId: string, connectorId: number): Promise<PersistedPlugToggles | null> {
  const row = await prisma.deviceInstanceConnectorDiagnosticState.findUnique({
    where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId } },
  });
  return (row?.hardwareTestToggles as PersistedPlugToggles | null) ?? null;
}

async function persistPlugToggles(instanceId: string, plug: InternalPlugState): Promise<void> {
  const toggles: PersistedPlugToggles = {
    outputRunning: plug.outputRunning,
    auxPowerMode: plug.auxPowerMode,
    lockStatus: plug.lockStatus,
  };
  try {
    await prisma.deviceInstanceConnectorDiagnosticState.upsert({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: plug.connectorId } },
      create: { deviceInstanceId: instanceId, connectorId: plug.connectorId, hardwareTestToggles: toggles as Prisma.InputJsonValue },
      update: { hardwareTestToggles: toggles as Prisma.InputJsonValue },
    });
  } catch (err) {
    console.error(`Failed to persist hardware-test toggles for ${instanceId} connector ${plug.connectorId}:`, err);
  }
}

/**
 * Loads (creating default rows as needed) this instance's in-memory state, populated from
 * Postgres (`DeviceInstance.hardwareTestInstanceState` / `DeviceInstanceConnectorDiagnosticState
 * .hardwareTestToggles`) on first access per process — the toggled boolean/enum fields
 * (fault-injection-adjacent test-panel positions) survive a restart; the `registry` Map below is
 * just a same-process cache over that, avoiding a DB round-trip on every poll.
 */
async function getOrCreateInternalState(instanceId: string, connectors: ConnectorRef[]): Promise<InternalState> {
  let state = registry.get(instanceId);
  if (!state) {
    const persisted = await loadPersistedInstanceSettings(instanceId);
    state = {
      interfaceBoardTestMode: persisted?.chargingTest?.interfaceBoardTestMode ?? false,
      outputMode: persisted?.chargingTest?.outputMode ?? "FullLoadOutput",
      selectedConnectorId: persisted?.chargingTest?.selectedConnectorId ?? connectors[0]?.connectorId ?? 1,
      plugs: new Map(),
      pile: {
        threePhaseAcContactor: persisted?.pile?.threePhaseAcContactor ?? "Open",
        powerContactor: persisted?.pile?.powerContactor ?? "Open",
        fanContactor: persisted?.pile?.fanContactor ?? "Open",
        breakerStatus: persisted?.pile?.breakerStatus ?? "Closed",
      },
      iccid: `89${seededDigits(`${instanceId}:iccid`, 18)}`,
      imei: seededDigits(`${instanceId}:imei`, 15),
    };
    registry.set(instanceId, state);
  }

  for (const connector of connectors) {
    if (!state.plugs.has(connector.connectorId)) {
      const persistedPlug = await loadPersistedPlugToggles(instanceId, connector.connectorId);
      state.plugs.set(connector.connectorId, {
        connectorId: connector.connectorId,
        label: connector.label,
        outputRunning: persistedPlug?.outputRunning ?? false,
        auxPowerMode: persistedPlug?.auxPowerMode ?? "Off",
        lockStatus: persistedPlug?.lockStatus ?? "Locked",
      });
    }
  }

  return state;
}

function renderPlug(instanceId: string, plug: InternalPlugState, outputMode: ChargingOutputMode): PlugTestState {
  const key = `${instanceId}:${plug.connectorId}`;
  const running = plug.outputRunning;
  const contact: ContactState = running ? "Closed" : "Open";
  const plugPosition: "Connected" | "Disconnected" = running ? "Connected" : "Disconnected";
  const targetCurrentA = outputMode === "FullLoadOutput" ? 125 : 62.5;

  return {
    connectorId: plug.connectorId,
    label: plug.label,
    outputRunning: running,
    auxPowerMode: plug.auxPowerMode,
    lockStatus: plug.lockStatus,
    cc1: contact,
    cc2: contact,
    km1: contact,
    km2: contact,
    plugPosition,
    fuseStatus: "Normal",
    assistPowerStatus: plug.auxPowerMode !== "Off" ? "Closed" : "Open",
    meterStatus: "Normal",
    commStatus: "Normal",
    insulationResistanceKOhm: round(clamp(jitter(`${key}:ins`, 2000, 150), 500, 9999), 0),
    interfaceTemp1C: round(jitter(`${key}:t1`, running ? 38 : 27, 2), 1),
    interfaceTemp2C: round(jitter(`${key}:t2`, running ? 39 : 28, 2), 1),
    adSamplingVoltageV: round(clamp(jitter(`${key}:ad`, running ? 3.3 : 0.2, 0.15), 0, 5), 2),
    ccVoltageV: round(clamp(jitter(`${key}:cc`, plugPosition === "Connected" ? 6 : 0.1, 0.5), 0, 12), 2),
    outputVoltageV: running ? round(clamp(jitter(`${key}:ov`, 400, 3), 0, 500), 1) : 0,
    outputCurrentA: running ? round(clamp(jitter(`${key}:oc`, targetCurrentA, 1.5), 0, 200), 1) : 0,
  };
}

function renderPile(instanceId: string, pile: InternalPileState, iccid: string, imei: string): PileTestState {
  const anyContactorClosed =
    pile.threePhaseAcContactor === "Closed" || pile.powerContactor === "Closed" || pile.fanContactor === "Closed";
  const tempBase = anyContactorClosed ? 42 : 30;

  return {
    threePhaseAcContactor: pile.threePhaseAcContactor,
    powerContactor: pile.powerContactor,
    fanContactor: pile.fanContactor,
    breakerStatus: pile.breakerStatus,
    gprsStatus: "Online",
    gprsSignalPercent: round(clamp(jitter(`${instanceId}:gprs`, 80, 10), 0, 100), 0),
    temp1C: round(jitter(`${instanceId}:pt1`, tempBase, 2), 1),
    temp2C: round(jitter(`${instanceId}:pt2`, tempBase + 1, 2), 1),
    temp3C: round(jitter(`${instanceId}:pt3`, tempBase - 1, 2), 1),
    temp4C: round(jitter(`${instanceId}:pt4`, tempBase + 2, 2), 1),
    humidityPercent: round(clamp(jitter(`${instanceId}:hum`, 45, 8), 0, 100), 0),
    moduleStatus: "Normal",
    uabVoltageV: round(jitter(`${instanceId}:uab`, 380, 4), 1),
    ubcVoltageV: round(jitter(`${instanceId}:ubc`, 380, 4), 1),
    ucaVoltageV: round(jitter(`${instanceId}:uca`, 380, 4), 1),
    iccid,
    imei,
  };
}

function renderState(instanceId: string, state: InternalState, connectors: ConnectorRef[]): HardwareTestState {
  return {
    chargingTest: {
      interfaceBoardTestMode: state.interfaceBoardTestMode,
      outputMode: state.outputMode,
      selectedConnectorId: state.selectedConnectorId,
    },
    plugs: connectors.map((connector) => renderPlug(instanceId, state.plugs.get(connector.connectorId)!, state.outputMode)),
    pile: renderPile(instanceId, state.pile, state.iccid, state.imei),
  };
}

function requirePlug(state: InternalState, connectorId: number): InternalPlugState {
  const plug = state.plugs.get(connectorId);
  if (!plug) throw new Error(`Unknown connectorId ${connectorId}`);
  return plug;
}

/** Current hardware test state for an instance, with all readouts freshly (re)computed. */
export async function getHardwareTestState(instanceId: string, deps: HardwareTestStateDeps = defaultDeps): Promise<HardwareTestState> {
  const connectors = await deps.getConnectors(instanceId);
  const state = await getOrCreateInternalState(instanceId, connectors);
  return renderState(instanceId, state, connectors);
}

/** Updates the Charging Test tab's global settings (test mode / output mode / selected plug). */
export async function setChargingTestSettings(
  instanceId: string,
  updates: { interfaceBoardTestMode?: boolean; outputMode?: ChargingOutputMode; selectedConnectorId?: number },
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  const connectors = await deps.getConnectors(instanceId);
  const state = await getOrCreateInternalState(instanceId, connectors);

  if (updates.interfaceBoardTestMode !== undefined) state.interfaceBoardTestMode = updates.interfaceBoardTestMode;
  if (updates.outputMode !== undefined) state.outputMode = updates.outputMode;
  if (updates.selectedConnectorId !== undefined) {
    requirePlug(state, updates.selectedConnectorId);
    state.selectedConnectorId = updates.selectedConnectorId;
  }
  await persistInstanceSettings(instanceId, state);

  return renderState(instanceId, state, connectors);
}

/**
 * Starts/stops a connector's simulated power output — shared by the Charging Test tab's
 * "start/stop test" button and the corresponding Plug A/B Test tab's "Contactor action",
 * since both represent the same physical action (closing the output contactor). Reflects
 * the change on the instance's real `OcppChargePointSession` connector status.
 *
 * Starting (not stopping) refuses when `connector-sessions.ts` already has an active
 * (`Preparing`/`Charging`/`Finishing`) real/local charging session on this connector — a
 * hardware output test and a real session must not run concurrently on the same connector,
 * each blind to the other (see `startChargingSession`/`adoptRemoteSession`'s matching guard the
 * other direction, and AUDIT-state.md's round-2 addendum).
 */
async function setOutputRunning(
  instanceId: string,
  connectorId: number,
  running: boolean,
  deps: HardwareTestStateDeps,
): Promise<HardwareTestState> {
  const connectors = await deps.getConnectors(instanceId);
  const state = await getOrCreateInternalState(instanceId, connectors);
  const plug = requirePlug(state, connectorId);

  if (running && !plug.outputRunning) {
    const activeSession = await deps.getActiveConnectorSession(instanceId, connectorId);
    if (activeSession) {
      throw new HardwareTestStateError(
        `Connector ${connectorId} already has an active charging session (status: ${activeSession.status}) — stop it before starting a hardware output test`,
      );
    }
  }

  plug.outputRunning = running;
  await persistPlugToggles(instanceId, plug);
  const session = await deps.getSession(instanceId);
  session.setConnectorStatus(connectorId, running ? "Charging" : "Available");

  return renderState(instanceId, state, connectors);
}

/**
 * Read-only check: is this connector's hardware output test currently running? Purely in-memory
 * (no DB), synchronous. Used by `connector-sessions.ts` to refuse starting a real/local charging
 * session on top of a running hardware test — the other half of the two-way collision guard.
 *
 * Only reflects state already loaded into `registry` this process — after a real restart (empty
 * cache), it returns `false` for a connector whose `outputRunning: true` is only in Postgres
 * until something calls `getOrCreateInternalState` for that instance (e.g. any of this module's
 * other exports) to warm the cache. Acceptable for this guard (a hardware test being started is
 * itself always such a call), but worth knowing if this function is reused elsewhere.
 */
export function isHardwareTestOutputRunning(instanceId: string, connectorId: number): boolean {
  return registry.get(instanceId)?.plugs.get(connectorId)?.outputRunning ?? false;
}

/** Tears down any in-memory hardware-test state cache for an instance. Call when deleting it (mirrors `diagnostics.ts::disposeDiagnosticState`). */
export function disposeHardwareTestState(instanceId: string): void {
  registry.delete(instanceId);
}

export function startChargingTest(
  instanceId: string,
  connectorId: number,
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  return setOutputRunning(instanceId, connectorId, true, deps);
}

export function stopChargingTest(
  instanceId: string,
  connectorId: number,
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  return setOutputRunning(instanceId, connectorId, false, deps);
}

export function setContactorAction(
  instanceId: string,
  connectorId: number,
  action: ContactorAction,
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  return setOutputRunning(instanceId, connectorId, action === "start", deps);
}

export async function setAuxPowerAction(
  instanceId: string,
  connectorId: number,
  action: AuxPowerAction,
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  const connectors = await deps.getConnectors(instanceId);
  const state = await getOrCreateInternalState(instanceId, connectors);
  const plug = requirePlug(state, connectorId);
  plug.auxPowerMode = action === "stop" ? "Off" : action;
  await persistPlugToggles(instanceId, plug);
  return renderState(instanceId, state, connectors);
}

/** "Electronic lock action": Start engages the lock, Stop releases it. */
export async function setLockAction(
  instanceId: string,
  connectorId: number,
  action: LockAction,
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  const connectors = await deps.getConnectors(instanceId);
  const state = await getOrCreateInternalState(instanceId, connectors);
  const plug = requirePlug(state, connectorId);
  plug.lockStatus = action === "start" ? "Locked" : "Unlocked";
  await persistPlugToggles(instanceId, plug);
  return renderState(instanceId, state, connectors);
}

/** Charging Pile Test tab's contactor/breaker manual actions (three-phase AC, power, fan, QF operate). */
export async function setPileContactorAction(
  instanceId: string,
  target: PileContactorTarget,
  action: ContactorAction,
  deps: HardwareTestStateDeps = defaultDeps,
): Promise<HardwareTestState> {
  const connectors = await deps.getConnectors(instanceId);
  const state = await getOrCreateInternalState(instanceId, connectors);
  const value: ContactState = action === "start" ? "Closed" : "Open";
  if (target === "breaker") state.pile.breakerStatus = value;
  else state.pile[target] = value;
  await persistInstanceSettings(instanceId, state);
  return renderState(instanceId, state, connectors);
}
