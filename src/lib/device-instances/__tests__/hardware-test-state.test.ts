import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  disposeHardwareTestState,
  getHardwareTestState,
  HardwareTestStateError,
  isHardwareTestOutputRunning,
  setAuxPowerAction,
  setChargingTestSettings,
  setContactorAction,
  setLockAction,
  setPileContactorAction,
  startChargingTest,
  stopChargingTest,
  type HardwareTestStateDeps,
} from "../hardware-test-state";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

const CONNECTORS = [
  { connectorId: 1, label: "Plug A" },
  { connectorId: 2, label: "Plug B" },
];

function createDeps(overrides: Partial<HardwareTestStateDeps> = {}) {
  const setConnectorStatus = vi.fn();
  const deps: HardwareTestStateDeps = {
    getConnectors: vi.fn().mockResolvedValue(CONNECTORS),
    getSession: vi.fn().mockResolvedValue({ setConnectorStatus }),
    getActiveConnectorSession: vi.fn().mockResolvedValue(null),
    // No persisted state by default (fresh instance) and no-op writes — these tests exercise
    // pure in-memory state transitions, not persistence itself (see prisma-backed coverage in
    // "hardware-test-state persistence (integration)" below).
    loadPersistedInstanceSettings: vi.fn().mockResolvedValue(null),
    savePersistedInstanceSettings: vi.fn().mockResolvedValue(undefined),
    loadPersistedPlugToggles: vi.fn().mockResolvedValue(null),
    savePersistedPlugToggles: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { deps, setConnectorStatus };
}

const INSTANCE_ID = "instance-1";

describe("hardware-test-state", () => {
  beforeEach(() => {
    // Each instanceId gets its own registry entry, so use a fresh one per test to avoid
    // cross-test bleed from the module-level in-memory registry.
  });

  it("returns default state for both connectors on first read", async () => {
    const { deps } = createDeps();
    const state = await getHardwareTestState(`${INSTANCE_ID}-defaults`, deps);

    expect(state.chargingTest).toEqual({
      interfaceBoardTestMode: false,
      outputMode: "FullLoadOutput",
      selectedConnectorId: 1,
    });
    expect(state.plugs).toHaveLength(2);
    for (const plug of state.plugs) {
      expect(plug.outputRunning).toBe(false);
      expect(plug.cc1).toBe("Open");
      expect(plug.km1).toBe("Open");
      expect(plug.plugPosition).toBe("Disconnected");
      expect(plug.outputVoltageV).toBe(0);
      expect(plug.outputCurrentA).toBe(0);
      expect(plug.lockStatus).toBe("Locked");
      expect(plug.assistPowerStatus).toBe("Open");
    }
    expect(state.pile.breakerStatus).toBe("Closed");
    expect(state.pile.threePhaseAcContactor).toBe("Open");
    expect(state.pile.iccid).toMatch(/^89\d{18}$/);
    expect(state.pile.imei).toMatch(/^\d{15}$/);
  });

  it("startChargingTest flips connector output state and the real OCPP session status", async () => {
    const { deps, setConnectorStatus } = createDeps();
    const instanceId = `${INSTANCE_ID}-charging-test`;

    const state = await startChargingTest(instanceId, 1, deps);

    expect(setConnectorStatus).toHaveBeenCalledWith(1, "Charging");
    const plugA = state.plugs.find((p) => p.connectorId === 1)!;
    expect(plugA.outputRunning).toBe(true);
    expect(plugA.cc1).toBe("Closed");
    expect(plugA.km1).toBe("Closed");
    expect(plugA.plugPosition).toBe("Connected");
    expect(plugA.outputVoltageV).toBeGreaterThan(0);
    expect(plugA.outputCurrentA).toBeGreaterThan(0);

    const plugB = state.plugs.find((p) => p.connectorId === 2)!;
    expect(plugB.outputRunning).toBe(false);

    const stopped = await stopChargingTest(instanceId, 1, deps);
    expect(setConnectorStatus).toHaveBeenCalledWith(1, "Available");
    expect(stopped.plugs.find((p) => p.connectorId === 1)!.outputRunning).toBe(false);
  });

  it("refuses to start a hardware output test when connector-sessions already has an active session on that connector", async () => {
    const { deps } = createDeps({ getActiveConnectorSession: vi.fn().mockResolvedValue({ status: "Charging" }) });
    const instanceId = `${INSTANCE_ID}-collision`;

    await expect(startChargingTest(instanceId, 1, deps)).rejects.toThrow(HardwareTestStateError);
    await expect(startChargingTest(instanceId, 1, deps)).rejects.toThrow(/active charging session/);
  });

  it("still allows stopping a hardware output test even if connector-sessions reports an active session", async () => {
    const getActiveConnectorSession = vi.fn().mockResolvedValue(null);
    const { deps } = createDeps({ getActiveConnectorSession });
    const instanceId = `${INSTANCE_ID}-collision-stop`;

    await startChargingTest(instanceId, 1, deps);
    getActiveConnectorSession.mockResolvedValue({ status: "Charging" });

    const stopped = await stopChargingTest(instanceId, 1, deps);
    expect(stopped.plugs.find((p) => p.connectorId === 1)!.outputRunning).toBe(false);
  });

  it("setContactorAction is equivalent to the Charging Test start/stop control", async () => {
    const { deps, setConnectorStatus } = createDeps();
    const instanceId = `${INSTANCE_ID}-contactor`;

    const state = await setContactorAction(instanceId, 2, "start", deps);
    expect(setConnectorStatus).toHaveBeenCalledWith(2, "Charging");
    expect(state.plugs.find((p) => p.connectorId === 2)!.outputRunning).toBe(true);
  });

  it("setAuxPowerAction updates mode and derived assist-power status without touching the session", async () => {
    const { deps, setConnectorStatus } = createDeps();
    const instanceId = `${INSTANCE_ID}-aux`;

    const state = await setAuxPowerAction(instanceId, 1, "12V", deps);
    expect(state.plugs.find((p) => p.connectorId === 1)!.auxPowerMode).toBe("12V");
    expect(state.plugs.find((p) => p.connectorId === 1)!.assistPowerStatus).toBe("Closed");
    expect(setConnectorStatus).not.toHaveBeenCalled();

    const stopped = await setAuxPowerAction(instanceId, 1, "stop", deps);
    expect(stopped.plugs.find((p) => p.connectorId === 1)!.auxPowerMode).toBe("Off");
    expect(stopped.plugs.find((p) => p.connectorId === 1)!.assistPowerStatus).toBe("Open");
  });

  it("setLockAction toggles lock status", async () => {
    const { deps } = createDeps();
    const instanceId = `${INSTANCE_ID}-lock`;

    const unlocked = await setLockAction(instanceId, 1, "stop", deps);
    expect(unlocked.plugs.find((p) => p.connectorId === 1)!.lockStatus).toBe("Unlocked");

    const locked = await setLockAction(instanceId, 1, "start", deps);
    expect(locked.plugs.find((p) => p.connectorId === 1)!.lockStatus).toBe("Locked");
  });

  it("setPileContactorAction toggles the targeted pile field only", async () => {
    const { deps } = createDeps();
    const instanceId = `${INSTANCE_ID}-pile`;

    const state = await setPileContactorAction(instanceId, "fanContactor", "start", deps);
    expect(state.pile.fanContactor).toBe("Closed");
    expect(state.pile.threePhaseAcContactor).toBe("Open");
    expect(state.pile.powerContactor).toBe("Open");

    const opened = await setPileContactorAction(instanceId, "breaker", "stop", deps);
    expect(opened.pile.breakerStatus).toBe("Open");
  });

  it("setChargingTestSettings validates the selected connector", async () => {
    const { deps } = createDeps();
    const instanceId = `${INSTANCE_ID}-settings`;

    const state = await setChargingTestSettings(instanceId, { outputMode: "HalfLoadOutput", selectedConnectorId: 2 }, deps);
    expect(state.chargingTest).toEqual({ interfaceBoardTestMode: false, outputMode: "HalfLoadOutput", selectedConnectorId: 2 });

    await expect(setChargingTestSettings(instanceId, { selectedConnectorId: 99 }, deps)).rejects.toThrow(
      "Unknown connectorId 99",
    );
  });
});

describe.skipIf(!process.env.DATABASE_URL)("hardware-test-state persistence (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  async function setup() {
    const created = await createTestModelAndInstance();
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
  }

  // `disposeHardwareTestState` clears this module's in-memory cache for an instance — calling it
  // and then re-reading is exactly what happens on a real restart, used here to simulate one
  // without needing a second process (mirrors diagnostics.test.ts's same technique).
  it("per-plug toggles and instance-level settings survive a simulated restart", async () => {
    await setup();

    await setLockAction(instanceId, 1, "stop");
    await setAuxPowerAction(instanceId, 1, "12V");
    await setChargingTestSettings(instanceId, { interfaceBoardTestMode: true, outputMode: "HalfLoadOutput" });
    await setPileContactorAction(instanceId, "fanContactor", "start");

    disposeHardwareTestState(instanceId);

    const state = await getHardwareTestState(instanceId);
    expect(state.plugs.find((p) => p.connectorId === 1)!.lockStatus).toBe("Unlocked");
    expect(state.plugs.find((p) => p.connectorId === 1)!.auxPowerMode).toBe("12V");
    expect(state.chargingTest.interfaceBoardTestMode).toBe(true);
    expect(state.chargingTest.outputMode).toBe("HalfLoadOutput");
    expect(state.pile.fanContactor).toBe("Closed");
    // Untouched fields still default normally.
    expect(state.plugs.find((p) => p.connectorId === 2)!.lockStatus).toBe("Locked");
    expect(state.pile.breakerStatus).toBe("Closed");
  });

  it("outputRunning survives a simulated restart, and isHardwareTestOutputRunning reflects it once the cache is warmed", async () => {
    await setup();

    await startChargingTest(instanceId, 1);
    disposeHardwareTestState(instanceId);

    const state = await getHardwareTestState(instanceId);
    expect(state.plugs.find((p) => p.connectorId === 1)!.outputRunning).toBe(true);
    expect(isHardwareTestOutputRunning(instanceId, 1)).toBe(true);
  });
});
