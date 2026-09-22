import { afterEach, describe, expect, it } from "vitest";

import { listLocalAuthEntries, lookupLocalAuthEntry, removeLocalAuthEntry, upsertLocalAuthEntry } from "../local-auth";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

describe.skipIf(!process.env.DATABASE_URL)("local-auth (integration)", () => {
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

  it("upserts and looks up an ACCEPTED, unexpired entry", async () => {
    await setup();
    await upsertLocalAuthEntry(instanceId, "CARD-A", "ACCEPTED");

    const found = await lookupLocalAuthEntry(instanceId, "CARD-A");
    expect(found?.idTag).toBe("CARD-A");
    expect(found?.status).toBe("ACCEPTED");
  });

  it("does not authorize a BLOCKED entry", async () => {
    await setup();
    await upsertLocalAuthEntry(instanceId, "CARD-B", "BLOCKED");
    expect(await lookupLocalAuthEntry(instanceId, "CARD-B")).toBeNull();
  });

  it("does not authorize an entry past its cacheExpiryDateTime", async () => {
    await setup();
    await upsertLocalAuthEntry(instanceId, "CARD-C", "ACCEPTED", new Date(Date.now() - 1000));
    expect(await lookupLocalAuthEntry(instanceId, "CARD-C")).toBeNull();
  });

  it("authorizes an entry before its cacheExpiryDateTime", async () => {
    await setup();
    await upsertLocalAuthEntry(instanceId, "CARD-D", "ACCEPTED", new Date(Date.now() + 60_000));
    expect(await lookupLocalAuthEntry(instanceId, "CARD-D")).not.toBeNull();
  });

  it("returns null for an idTag never added", async () => {
    await setup();
    expect(await lookupLocalAuthEntry(instanceId, "NEVER-ADDED")).toBeNull();
  });

  it("lists every entry, and removal takes an entry back out of the list", async () => {
    await setup();
    await upsertLocalAuthEntry(instanceId, "CARD-E", "ACCEPTED");
    await upsertLocalAuthEntry(instanceId, "CARD-F", "ACCEPTED");
    expect((await listLocalAuthEntries(instanceId)).map((e) => e.idTag).sort()).toEqual(["CARD-E", "CARD-F"]);

    await removeLocalAuthEntry(instanceId, "CARD-E");
    expect((await listLocalAuthEntries(instanceId)).map((e) => e.idTag)).toEqual(["CARD-F"]);
  });

  it("upserting the same idTag again updates rather than duplicates it", async () => {
    await setup();
    await upsertLocalAuthEntry(instanceId, "CARD-G", "ACCEPTED");
    await upsertLocalAuthEntry(instanceId, "CARD-G", "BLOCKED");

    const entries = await listLocalAuthEntries(instanceId);
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("BLOCKED");
  });
});
