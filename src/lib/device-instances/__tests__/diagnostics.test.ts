import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getCommunicationModules,
  getInterfaceBoardReading,
  getOverallHealth,
  getPlugOutputCurrent,
  OVERALL_HEALTH_FIELDS,
  setCommunicationModuleField,
  setContactorField,
  setInterfaceBoardToggleField,
  setOverallHealthField,
} from "../diagnostics";
import { prisma } from "@/lib/prisma";

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
  // `resolveNumericConnectorId` looks the instance up in the DB; a not-found instance (as every
  // random id here is) resolves to `null`, so these fall back to the plug's baseline/defaults —
  // exercised for real against a persisted instance in the "derived from real session data" block below.
  it("defaults to normal/open and jitters numeric fields near baseline", async () => {
    const id = `instance-${Math.random()}`;
    const reading = await getInterfaceBoardReading(id, "connector-1");
    expect(reading.seccCommunication).toBe("normal");
    expect(reading.km1Status).toBe("open");
    expect(reading.temperatureSampling1).toBeGreaterThan(20);
    expect(reading.temperatureSampling1).toBeLessThan(35);
    expect(reading.energyTotal).toBe(0.444);
  });

  it("sets a plausible nonzero PLC error code when interface board communication goes abnormal", async () => {
    const id = `instance-${Math.random()}`;
    const updated = await setInterfaceBoardToggleField(id, "connector-1", "interfaceBoardCommunication", "abnormal");
    expect(updated.interfaceBoardCommunication).toBe("abnormal");
    expect(updated.plcErrorCode).not.toBe("0x00");
  });

  it("toggles KM1/KM2 contact status independently per plug", async () => {
    const id = `instance-${Math.random()}`;
    await setContactorField(id, "connector-a", "km1Status", "closed");
    const a = await getInterfaceBoardReading(id, "connector-a");
    const b = await getInterfaceBoardReading(id, "connector-b");
    expect(a.km1Status).toBe("closed");
    expect(b.km1Status).toBe("open");
  });
});

describe("getPlugOutputCurrent", () => {
  it("is zero for an unknown instance (no active session to derive from)", async () => {
    const current = await getPlugOutputCurrent(`instance-${Math.random()}`, "connector-1");
    expect(current).toBe(0);
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

describe.skipIf(!process.env.DATABASE_URL)("diagnostics derived from real session data (integration)", () => {
  let deviceModelId: string;
  let connectorRowId: string;
  let instanceId: string;

  beforeAll(async () => {
    const deviceModel = await prisma.deviceModel.create({
      data: {
        manufacturer: "TESTMFR",
        model: `DIAG-TEST-${Date.now()}`,
        ocppProtocol: "OCPP_1_6",
        connectors: {
          create: [{ evseIndex: 1, connectorIndex: 1, label: "Plug A", connectorType: "CCS2", powerType: "DC" }],
        },
      },
      include: { connectors: true },
    });
    deviceModelId = deviceModel.id;
    connectorRowId = deviceModel.connectors[0].id;

    const instance = await prisma.deviceInstance.create({
      data: {
        deviceModelId,
        name: "Diagnostics test instance",
        chargePointId: `diag-test-${Date.now()}`,
        csmsUrl: "ws://localhost:9999/CP1",
      },
    });
    instanceId = instance.id;
  });

  afterAll(async () => {
    await prisma.deviceInstance.deleteMany({ where: { deviceModelId } });
    await prisma.deviceModel.delete({ where: { id: deviceModelId } });
  });

  it("getPlugOutputCurrent is nonzero while the connector has an active Charging session", async () => {
    await prisma.deviceInstanceConnectorState.create({
      data: {
        deviceInstanceId: instanceId,
        connectorId: 1,
        status: "Charging",
        activeIdTag: "CARD-1",
        activeStartedAt: new Date(),
        activeChargeRateKw: 40,
      },
    });

    const current = await getPlugOutputCurrent(instanceId, connectorRowId);
    expect(current).toBeGreaterThan(0);
    // 40kW over the module's assumed 400V DC bus ~= 100A, jittered by +/-0.5A.
    expect(current).toBeGreaterThan(95);
    expect(current).toBeLessThan(105);
  });

  it("getInterfaceBoardReading's energyTotal accumulates from completed sessions on that connector", async () => {
    const before = await getInterfaceBoardReading(instanceId, connectorRowId);

    await prisma.deviceInstanceSession.create({
      data: {
        deviceInstanceId: instanceId,
        connectorId: 1,
        idTag: "CARD-1",
        startedAt: new Date(Date.now() - 3_600_000),
        stoppedAt: new Date(),
        energyWh: 12_000,
        cost: 0,
        stopCause: "Manu. Stop",
      },
    });

    const after = await getInterfaceBoardReading(instanceId, connectorRowId);
    expect(after.energyTotal).toBeCloseTo(before.energyTotal + 12, 3);
  });
});
