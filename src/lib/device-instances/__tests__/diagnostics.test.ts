import { describe, expect, it } from "vitest";

import {
  getCommunicationModules,
  getInterfaceBoardReading,
  getOverallHealth,
  OVERALL_HEALTH_FIELDS,
  setCommunicationModuleField,
  setContactorField,
  setInterfaceBoardToggleField,
  setOverallHealthField,
} from "../diagnostics";

describe("getOverallHealth", () => {
  it("defaults every health field to normal for a fresh instance", () => {
    const overall = getOverallHealth(`instance-${Math.random()}`);
    for (const field of OVERALL_HEALTH_FIELDS) {
      expect(overall[field]).toBe("normal");
    }
  });
});

describe("setOverallHealthField", () => {
  it("flips one field to abnormal without affecting the others", () => {
    const id = `instance-${Math.random()}`;
    const updated = setOverallHealthField(id, "circuitBreakerStatus", "abnormal");
    expect(updated.circuitBreakerStatus).toBe("abnormal");
    expect(updated.emergency).toBe("normal");
    expect(updated.cabinetDoor).toBe("normal");

    expect(getOverallHealth(id).circuitBreakerStatus).toBe("abnormal");
  });
});

describe("interface board readings", () => {
  it("defaults to normal/open and jitters numeric fields near baseline", () => {
    const id = `instance-${Math.random()}`;
    const reading = getInterfaceBoardReading(id, "connector-1");
    expect(reading.seccCommunication).toBe("normal");
    expect(reading.km1Status).toBe("open");
    expect(reading.temperatureSampling1).toBeGreaterThan(20);
    expect(reading.temperatureSampling1).toBeLessThan(35);
  });

  it("sets a plausible nonzero PLC error code when interface board communication goes abnormal", () => {
    const id = `instance-${Math.random()}`;
    const updated = setInterfaceBoardToggleField(id, "connector-1", "interfaceBoardCommunication", "abnormal");
    expect(updated.interfaceBoardCommunication).toBe("abnormal");
    expect(updated.plcErrorCode).not.toBe("0x00");
  });

  it("toggles KM1/KM2 contact status independently per plug", () => {
    const id = `instance-${Math.random()}`;
    setContactorField(id, "connector-a", "km1Status", "closed");
    const a = getInterfaceBoardReading(id, "connector-a");
    const b = getInterfaceBoardReading(id, "connector-b");
    expect(a.km1Status).toBe("closed");
    expect(b.km1Status).toBe("open");
  });
});

describe("communication modules", () => {
  it("returns 14 modules, all normal by default", () => {
    const id = `instance-${Math.random()}`;
    const modules = getCommunicationModules(id);
    expect(modules).toHaveLength(14);
    expect(modules.every((m) => m.comm === "normal")).toBe(true);
  });

  it("flips a single module to abnormal by index", () => {
    const id = `instance-${Math.random()}`;
    const modules = setCommunicationModuleField(id, 3, "abnormal");
    expect(modules[3].comm).toBe("abnormal");
    expect(modules[2].comm).toBe("normal");
  });

  it("rejects an out-of-range module index", () => {
    const id = `instance-${Math.random()}`;
    expect(() => setCommunicationModuleField(id, 99, "abnormal")).toThrow(RangeError);
  });
});
