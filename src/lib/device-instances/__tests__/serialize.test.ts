import { afterEach, describe, expect, it } from "vitest";

import { logDeviceInstanceEvent } from "../events";
import { listDeviceInstanceEvents, listDeviceInstanceSessions, listDeviceInstances, serializeDeviceInstance } from "../serialize";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";
import { prisma } from "@/lib/prisma";

describe.skipIf(!process.env.DATABASE_URL)("serialize (integration)", () => {
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

  it("serializeDeviceInstance returns null for a nonexistent instance", async () => {
    expect(await serializeDeviceInstance("not-a-real-id")).toBeNull();
  });

  it("serializeDeviceInstance merges model topology/parameters with the instance's own values", async () => {
    await setup();
    const detail = await serializeDeviceInstance(instanceId);
    expect(detail?.id).toBe(instanceId);
    expect(detail?.deviceModel.manufacturer).toBe("TESTMFR");
    expect(detail?.connectors).toHaveLength(2);
    // Never-started instance: no live OCPP session tracked yet, so status/errorCode are null.
    expect(detail?.connectors[0]).toMatchObject({ connectorId: 1, status: null, errorCode: null });
    expect(detail?.parameters.find((p) => p.key === "pricePerKwh")?.value).toBe("0.35");
  });

  it("listDeviceInstances includes the created instance with its connector summaries", async () => {
    await setup();
    const instances = await listDeviceInstances();
    const found = instances.find((i) => i.id === instanceId);
    expect(found).toBeDefined();
    expect(found?.connectors).toHaveLength(2);
  });

  it("listDeviceInstanceEvents paginates newest-first", async () => {
    await setup();
    await logDeviceInstanceEvent(instanceId, "BOOT", "first", new Date("2026-01-01T00:00:00Z"));
    await logDeviceInstanceEvent(instanceId, "BOOT", "second", new Date("2026-01-02T00:00:00Z"));
    await logDeviceInstanceEvent(instanceId, "BOOT", "third", new Date("2026-01-03T00:00:00Z"));

    const page1 = await listDeviceInstanceEvents(instanceId, 1, 2);
    expect(page1.totalCount).toBe(3);
    expect(page1.pageCount).toBe(2);
    expect(page1.items.map((e) => e.description)).toEqual(["third", "second"]);

    const page2 = await listDeviceInstanceEvents(instanceId, 2, 2);
    expect(page2.items.map((e) => e.description)).toEqual(["first"]);
  });

  it("listDeviceInstanceSessions paginates newest-first by startedAt", async () => {
    await setup();
    await prisma.deviceInstanceSession.createMany({
      data: [
        {
          deviceInstanceId: instanceId,
          connectorId: 1,
          idTag: "CARD-1",
          startedAt: new Date("2026-01-01T00:00:00Z"),
          stoppedAt: new Date("2026-01-01T01:00:00Z"),
          energyWh: 1000,
          cost: 1,
          stopCause: "Manu. Stop",
        },
        {
          deviceInstanceId: instanceId,
          connectorId: 1,
          idTag: "CARD-1",
          startedAt: new Date("2026-01-02T00:00:00Z"),
          stoppedAt: new Date("2026-01-02T01:00:00Z"),
          energyWh: 2000,
          cost: 2,
          stopCause: "Manu. Stop",
        },
      ],
    });

    const page = await listDeviceInstanceSessions(instanceId, 1, 10);
    expect(page.totalCount).toBe(2);
    expect(page.items[0].energyWh).toBe(2000);
    expect(page.items[1].energyWh).toBe(1000);
  });
});
