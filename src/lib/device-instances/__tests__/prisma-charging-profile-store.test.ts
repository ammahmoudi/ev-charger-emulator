import { afterEach, describe, expect, it } from "vitest";

import { PrismaChargingProfileStore } from "../prisma-charging-profile-store";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

describe.skipIf(!process.env.DATABASE_URL)("PrismaChargingProfileStore (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  async function setup() {
    const created = await createTestModelAndInstance();
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    return new PrismaChargingProfileStore(instanceId);
  }

  const PROFILE = {
    chargingProfileId: 7,
    stackLevel: 0,
    chargingProfilePurpose: "TxDefaultProfile",
    chargingProfileKind: "Absolute",
    chargingSchedule: { chargingRateUnit: "A", chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }] },
  };

  it("set() then list() round-trips a profile, including the full JSON blob", async () => {
    const store = await setup();
    await store.set(7, { connectorId: 1, profile: PROFILE });

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual({ connectorId: 1, profile: PROFILE });
  });

  it("set() on an existing chargingProfileId overwrites it (upsert)", async () => {
    const store = await setup();
    await store.set(7, { connectorId: 1, profile: PROFILE });
    await store.set(7, { connectorId: 2, profile: { ...PROFILE, stackLevel: 1 } });

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].connectorId).toBe(2);
    expect(all[0].profile.stackLevel).toBe(1);
  });

  it("list() returns every profile for the instance", async () => {
    const store = await setup();
    await store.set(7, { connectorId: 1, profile: PROFILE });
    await store.set(8, { connectorId: 2, profile: { ...PROFILE, chargingProfileId: 8 } });

    const all = await store.list();
    expect(all).toHaveLength(2);
  });

  it("delete() removes a profile", async () => {
    const store = await setup();
    await store.set(7, { connectorId: 1, profile: PROFILE });
    await store.delete(7);

    expect(await store.list()).toHaveLength(0);
  });
});
