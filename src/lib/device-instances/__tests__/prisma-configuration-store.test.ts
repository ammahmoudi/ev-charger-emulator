import { afterEach, describe, expect, it } from "vitest";

import { PrismaConfigurationStore } from "../prisma-configuration-store";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";
import { prisma } from "@/lib/prisma";

describe.skipIf(!process.env.DATABASE_URL)("PrismaConfigurationStore (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  async function setup() {
    const created = await createTestModelAndInstance();
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    return new PrismaConfigurationStore(instanceId);
  }

  it("list() with no keys returns every instance parameter, all read/write", async () => {
    const store = await setup();
    const { known, unknown } = await store.list();
    expect(unknown).toEqual([]);
    expect(known.map((e) => e.key).sort()).toEqual(["currencyUnit", "firmwareVersion", "pricePerKwh", "serviceFeePerSession"]);
    expect(known.every((e) => e.readonly === false)).toBe(true);
    expect(known.find((e) => e.key === "pricePerKwh")?.value).toBe("0.35");
  });

  it("list() with keys reports unknown keys separately from known ones", async () => {
    const store = await setup();
    const { known, unknown } = await store.list(["pricePerKwh", "notARealKey"]);
    expect(known.map((e) => e.key)).toEqual(["pricePerKwh"]);
    expect(unknown).toEqual(["notARealKey"]);
  });

  it("set() writes the new value and returns Accepted for a known key", async () => {
    const store = await setup();
    const status = await store.set("pricePerKwh", "0.5");
    expect(status).toBe("Accepted");

    const { known } = await store.list(["pricePerKwh"]);
    expect(known[0].value).toBe("0.5");

    const row = await prisma.deviceInstanceParameter.findFirst({
      where: { deviceInstanceId: instanceId, deviceModelParameter: { key: "pricePerKwh" } },
    });
    expect(row?.value).toBe("0.5");
  });

  it("set() returns NotSupported for an unknown key and doesn't write anything", async () => {
    const store = await setup();
    const status = await store.set("notARealKey", "anything");
    expect(status).toBe("NotSupported");
  });
});
