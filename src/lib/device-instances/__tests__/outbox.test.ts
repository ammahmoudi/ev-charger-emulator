import { afterEach, describe, expect, it, vi } from "vitest";

import { drainOutbox, listOutboxMessages, queueOutboxMessage } from "../outbox";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

describe.skipIf(!process.env.DATABASE_URL)("outbox (integration)", () => {
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

  it("queues a message and lists it back", async () => {
    await setup();
    await queueOutboxMessage(instanceId, "StopTransaction", { transactionId: 1, meterStop: 500 });

    const messages = await listOutboxMessages(instanceId);
    expect(messages).toHaveLength(1);
    expect(messages[0].action).toBe("StopTransaction");
    expect(messages[0].payload).toEqual({ transactionId: 1, meterStop: 500 });
    expect(messages[0].attempts).toBe(0);
  });

  it("drainOutbox delivers every message in order and removes them", async () => {
    await setup();
    await queueOutboxMessage(instanceId, "StartTransaction", { connectorId: 1 });
    await queueOutboxMessage(instanceId, "StopTransaction", { transactionId: 1 });

    const sender = vi.fn().mockResolvedValue({});
    const delivered = await drainOutbox(instanceId, sender);

    expect(delivered).toBe(2);
    expect(sender).toHaveBeenNthCalledWith(1, "StartTransaction", { connectorId: 1 });
    expect(sender).toHaveBeenNthCalledWith(2, "StopTransaction", { transactionId: 1 });
    expect(await listOutboxMessages(instanceId)).toHaveLength(0);
  });

  it("stops at the first failure, preserving order for the next drain", async () => {
    await setup();
    await queueOutboxMessage(instanceId, "StartTransaction", { connectorId: 1 });
    await queueOutboxMessage(instanceId, "StopTransaction", { transactionId: 1 });

    const sender = vi.fn().mockRejectedValueOnce(new Error("still offline")).mockResolvedValue({});
    const delivered = await drainOutbox(instanceId, sender);

    expect(delivered).toBe(0);
    const remaining = await listOutboxMessages(instanceId);
    expect(remaining).toHaveLength(2);
    expect(remaining[0].action).toBe("StartTransaction");
    expect(remaining[0].attempts).toBe(1);
    expect(remaining[0].lastError).toBe("still offline");

    // A second drain (e.g. the next reconnect) picks up right where it left off.
    const secondDelivered = await drainOutbox(instanceId, sender);
    expect(secondDelivered).toBe(2);
    expect(await listOutboxMessages(instanceId)).toHaveLength(0);
  });
});
