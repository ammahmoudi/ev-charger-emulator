import { afterEach, describe, expect, it } from "vitest";

import { logDeviceInstanceEvent } from "../events";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";
import { prisma } from "@/lib/prisma";

describe.skipIf(!process.env.DATABASE_URL)("logDeviceInstanceEvent (integration)", () => {
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

  it("persists an event row with the given type/description/occurredAt", async () => {
    await setup();
    const occurredAt = new Date("2026-01-01T00:00:00Z");
    await logDeviceInstanceEvent(instanceId, "STATUS_CHANGE", "Plug A status changed to Charging", occurredAt);

    const rows = await prisma.deviceInstanceEvent.findMany({ where: { deviceInstanceId: instanceId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "STATUS_CHANGE", description: "Plug A status changed to Charging" });
    expect(rows[0].occurredAt.toISOString()).toBe(occurredAt.toISOString());
  });

  it("defaults occurredAt to now when omitted", async () => {
    await setup();
    const before = Date.now();
    await logDeviceInstanceEvent(instanceId, "BOOT", "BootNotification accepted");
    const after = Date.now();

    const [row] = await prisma.deviceInstanceEvent.findMany({ where: { deviceInstanceId: instanceId } });
    expect(row.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(row.occurredAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("swallows (rather than throws) a failure to log, e.g. a deleted instance", async () => {
    await expect(logDeviceInstanceEvent("not-a-real-instance-id", "FAULT", "should not throw")).resolves.toBeUndefined();
  });
});
