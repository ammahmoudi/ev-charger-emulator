import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  disposeDiagnosticState,
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

// getOverallHealth/setOverallHealthField now read/write DeviceInstance.diagnosticsInstanceState
// (round 2's toggle-state persistence, see AUDIT-state.md) via a real Prisma call even for a
// not-found instance — same DB-gate reasoning as "interface board readings" below.
describe.skipIf(!process.env.DATABASE_URL)("getOverallHealth", () => {
  it("defaults every health field to normal for a fresh instance", async () => {
    const overall = await getOverallHealth(`instance-${Math.random()}`);
    for (const field of OVERALL_HEALTH_FIELDS) {
      expect(overall[field]).toBe("normal");
    }
  });
});

describe.skipIf(!process.env.DATABASE_URL)("setOverallHealthField", () => {
  it("flips one field to abnormal without affecting the others", async () => {
    const id = `instance-${Math.random()}`;
    const updated = await setOverallHealthField(id, "circuitBreakerStatus", "abnormal");
    expect(updated.circuitBreakerStatus).toBe("abnormal");
    expect(updated.emergency).toBe("normal");
    expect(updated.cabinetDoor).toBe("normal");

    expect((await getOverallHealth(id)).circuitBreakerStatus).toBe("abnormal");
  });
});

// `resolveNumericConnectorId` (called by `getInterfaceBoardReading`/`setInterfaceBoardToggleField`/
// `setContactorField`/`getPlugOutputCurrent`) does a real Prisma lookup even for a not-found
// instance/connector — it only handles "not found", not "DATABASE_URL unset" (Prisma throws a
// validation error before ever reaching the network in that case). So these need the same DB gate
// as the "derived from real session data" block below, even though they don't create any rows.
describe.skipIf(!process.env.DATABASE_URL)("interface board readings", () => {
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

describe.skipIf(!process.env.DATABASE_URL)("getPlugOutputCurrent", () => {
  it("is zero for an unknown instance (no active session to derive from)", async () => {
    const current = await getPlugOutputCurrent(`instance-${Math.random()}`, "connector-1");
    expect(current).toBe(0);
  });
});

// Also touches DeviceInstance.diagnosticsInstanceState now — same reasoning as above.
describe.skipIf(!process.env.DATABASE_URL)("communication modules", () => {
  it("returns 14 modules, all normal by default", async () => {
    const id = `instance-${Math.random()}`;
    const modules = await getCommunicationModules(id);
    expect(modules).toHaveLength(14);
    expect(modules.every((m) => m.comm === "normal")).toBe(true);
  });

  it("flips a single module to abnormal by index", async () => {
    const id = `instance-${Math.random()}`;
    const modules = await setCommunicationModuleField(id, 3, "abnormal");
    expect(modules[3].comm).toBe("abnormal");
    expect(modules[2].comm).toBe("normal");
  });

  it("rejects an out-of-range module index", async () => {
    const id = `instance-${Math.random()}`;
    await expect(setCommunicationModuleField(id, 99, "abnormal")).rejects.toThrow(RangeError);
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

  // `disposeDiagnosticState` clears this module's in-memory cache for an instance — calling it
  // and then re-reading is exactly what happens on a real restart (a fresh process has no cache
  // and must load from Postgres), so it's used here to simulate one without needing a second process.
  it("overall health and communication-module toggles survive a simulated restart", async () => {
    await setOverallHealthField(instanceId, "cabinetDoor", "abnormal");
    await setCommunicationModuleField(instanceId, 5, "abnormal");

    disposeDiagnosticState(instanceId);

    const overall = await getOverallHealth(instanceId);
    expect(overall.cabinetDoor).toBe("abnormal");
    expect(overall.circuitBreakerStatus).toBe("normal");

    const modules = await getCommunicationModules(instanceId);
    expect(modules[5].comm).toBe("abnormal");
    expect(modules[0].comm).toBe("normal");
  });

  it("per-plug toggle fields survive a simulated restart", async () => {
    await setInterfaceBoardToggleField(instanceId, connectorRowId, "meterCommunication", "abnormal");
    await setContactorField(instanceId, connectorRowId, "km2Status", "closed");

    disposeDiagnosticState(instanceId);

    const reading = await getInterfaceBoardReading(instanceId, connectorRowId);
    expect(reading.meterCommunication).toBe("abnormal");
    expect(reading.km2Status).toBe("closed");
    // Untouched toggle fields still default normally.
    expect(reading.seccCommunication).toBe("normal");
  });
});
