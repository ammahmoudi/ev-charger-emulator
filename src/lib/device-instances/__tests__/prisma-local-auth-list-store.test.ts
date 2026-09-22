import { afterEach, describe, expect, it } from "vitest";

import { lookupLocalAuthEntry } from "../local-auth";
import { PrismaLocalAuthListStore } from "../prisma-local-auth-list-store";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

describe.skipIf(!process.env.DATABASE_URL)("PrismaLocalAuthListStore (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  async function setup() {
    const created = await createTestModelAndInstance();
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    return new PrismaLocalAuthListStore(instanceId);
  }

  it("version defaults to 0 and round-trips through setVersion/getVersion", async () => {
    const store = await setup();
    expect(await store.getVersion()).toBe(0);

    await store.setVersion(3);
    expect(await store.getVersion()).toBe(3);
  });

  it("setEntry then listEntries round-trips idTagInfo, mapping OcppIdTagStatus <-> LocalAuthEntryStatus", async () => {
    const store = await setup();
    await store.setEntry("CARD-1", { status: "Accepted", parentIdTag: "FLEET-1" });
    await store.setEntry("CARD-2", { status: "Blocked" });
    await store.setEntry("CARD-3", { status: "ConcurrentTx" });

    const entries = await store.listEntries();
    expect(entries.find((e) => e.idTag === "CARD-1")?.idTagInfo).toEqual({
      status: "Accepted",
      parentIdTag: "FLEET-1",
      expiryDate: undefined,
    });
    expect(entries.find((e) => e.idTag === "CARD-2")?.idTagInfo.status).toBe("Blocked");
    expect(entries.find((e) => e.idTag === "CARD-3")?.idTagInfo.status).toBe("ConcurrentTx");
  });

  it("setEntry preserves expiryDate as an ISO string round-trip", async () => {
    const store = await setup();
    await store.setEntry("CARD-1", { status: "Accepted", expiryDate: "2026-06-01T00:00:00.000Z" });

    const [entry] = await store.listEntries();
    expect(entry.idTagInfo.expiryDate).toBe("2026-06-01T00:00:00.000Z");
  });

  it("setEntry on an existing idTag overwrites it (upsert)", async () => {
    const store = await setup();
    await store.setEntry("CARD-1", { status: "Accepted" });
    await store.setEntry("CARD-1", { status: "Blocked" });

    const entries = await store.listEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].idTagInfo.status).toBe("Blocked");
  });

  it("deleteEntry removes one entry", async () => {
    const store = await setup();
    await store.setEntry("CARD-1", { status: "Accepted" });
    await store.setEntry("CARD-2", { status: "Accepted" });
    await store.deleteEntry("CARD-1");

    const entries = await store.listEntries();
    expect(entries.map((e) => e.idTag)).toEqual(["CARD-2"]);
  });

  it("clearEntries removes every entry", async () => {
    const store = await setup();
    await store.setEntry("CARD-1", { status: "Accepted" });
    await store.setEntry("CARD-2", { status: "Accepted" });
    await store.clearEntries();

    expect(await store.listEntries()).toHaveLength(0);
  });

  // This table is shared with local-auth.ts (rfid.ts's own lookup) — an entry written via the
  // OCPP-facing store must be visible to that side too, and vice versa (round-trip integration).
  it("an entry written via setEntry (SendLocalList's path) is visible to rfid.ts's lookupLocalAuthEntry", async () => {
    const store = await setup();
    await store.setEntry("CARD-1", { status: "Accepted" });

    const looked = await lookupLocalAuthEntry(instanceId, "CARD-1");
    expect(looked?.status).toBe("ACCEPTED");
  });
});
