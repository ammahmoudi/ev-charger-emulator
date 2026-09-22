import { afterEach, describe, expect, it } from "vitest";

import { PrismaReservationStore } from "../prisma-reservation-store";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

describe.skipIf(!process.env.DATABASE_URL)("PrismaReservationStore (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  async function setup() {
    const created = await createTestModelAndInstance();
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    return new PrismaReservationStore(instanceId);
  }

  it("set() then get() round-trips a reservation, including expiryDate as an ISO string", async () => {
    const store = await setup();
    await store.set({ reservationId: 1, connectorId: 1, idTag: "CARD-1", expiryDate: "2026-01-01T00:00:00.000Z" });

    const found = await store.get(1);
    expect(found).toEqual({
      reservationId: 1,
      connectorId: 1,
      idTag: "CARD-1",
      parentIdTag: undefined,
      expiryDate: "2026-01-01T00:00:00.000Z",
    });
  });

  it("set() preserves parentIdTag when given", async () => {
    const store = await setup();
    await store.set({
      reservationId: 2,
      connectorId: 1,
      idTag: "FLEET-CARD-1",
      parentIdTag: "FLEET-PARENT",
      expiryDate: "2026-01-01T00:00:00.000Z",
    });

    expect((await store.get(2))?.parentIdTag).toBe("FLEET-PARENT");
  });

  it("get() returns undefined for an unknown reservationId", async () => {
    const store = await setup();
    expect(await store.get(999)).toBeUndefined();
  });

  it("set() on an existing reservationId overwrites it (upsert)", async () => {
    const store = await setup();
    await store.set({ reservationId: 1, connectorId: 1, idTag: "CARD-1", expiryDate: "2026-01-01T00:00:00.000Z" });
    await store.set({ reservationId: 1, connectorId: 2, idTag: "CARD-2", expiryDate: "2026-02-01T00:00:00.000Z" });

    const found = await store.get(1);
    expect(found?.connectorId).toBe(2);
    expect(found?.idTag).toBe("CARD-2");
    expect((await store.list())).toHaveLength(1);
  });

  it("list() returns every reservation for the instance", async () => {
    const store = await setup();
    await store.set({ reservationId: 1, connectorId: 1, idTag: "CARD-1", expiryDate: "2026-01-01T00:00:00.000Z" });
    await store.set({ reservationId: 2, connectorId: 2, idTag: "CARD-2", expiryDate: "2026-01-02T00:00:00.000Z" });

    const all = await store.list();
    expect(all.map((r) => r.reservationId).sort()).toEqual([1, 2]);
  });

  it("delete() removes a reservation", async () => {
    const store = await setup();
    await store.set({ reservationId: 1, connectorId: 1, idTag: "CARD-1", expiryDate: "2026-01-01T00:00:00.000Z" });
    await store.delete(1);

    expect(await store.get(1)).toBeUndefined();
    expect(await store.list()).toHaveLength(0);
  });
});
