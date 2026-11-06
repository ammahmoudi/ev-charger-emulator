import { describe, expect, it, vi } from "vitest";
import { getBmsReadouts } from "../bms-readouts";
import {
  getHardwareTestState,
  startChargingTest,
  stopChargingTest,
  type HardwareTestStateDeps,
} from "../hardware-test-state";

const deps: HardwareTestStateDeps = {
  getConnectors: async () => [
    { connectorId: 1, label: "Plug A" },
    { connectorId: 2, label: "Plug B" },
  ],
  getSession: async () => ({ setConnectorStatus: vi.fn() }),
  getActiveConnectorSession: async () => null,
  loadPersistedInstanceSettings: async () => null,
  savePersistedInstanceSettings: async () => {},
  loadPersistedPlugToggles: async () => null,
  savePersistedPlugToggles: async () => {},
};

function values(plug: Parameters<typeof getBmsReadouts>[0]) {
  return Object.fromEntries(
    getBmsReadouts(plug)
      .flat(2)
      .map((row) => [row.label, row.value]),
  );
}

describe("photo-reference BMS pages", () => {
  it("shows zero and blank BMS fields before a simulated handshake", async () => {
    const state = await getHardwareTestState("bms-idle", deps);
    const readouts = values(state.plugs[0]);
    expect(readouts["Protocol version"]).toBe("0.00");
    expect(readouts["Battery type"]).toBe("");
    expect(readouts["VIN code"]).toBe("");
    expect(readouts["Test current (A)"]).toBe("0.0");
    expect(readouts["Current SOC (%)"]).toBe("0");
    expect(readouts["Battery status"]).toBe("0x0000");
  });

  it("tracks the selected plug output, isolates the other plug, and clears readings on stop", async () => {
    const active = await startChargingTest("bms-lifecycle", 1, deps);
    const reading = values(active.plugs[0]);
    expect(reading["Test voltage (V)"]).toBe(
      active.plugs[0].outputVoltageV.toFixed(1),
    );
    expect(Number(reading["Test current (A)"])).toBeGreaterThan(0);
    expect(Number(reading["Estimate time remaining (s)"])).toBeGreaterThan(0);
    expect(values(active.plugs[1])["Battery voltage (V)"]).toBe("0.0");
    const stopped = await stopChargingTest("bms-lifecycle", 1, deps);
    expect(values(stopped.plugs[0])["Test voltage (V)"]).toBe("0.0");
    expect(values(stopped.plugs[0])["Maximum temperature (°C)"]).toBe("0");
  });
});
