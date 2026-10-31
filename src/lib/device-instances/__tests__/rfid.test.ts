import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { connectEv, listConnectorStates } from "../connector-sessions";
import { upsertLocalAuthEntry } from "../local-auth";
import { prisma } from "@/lib/prisma";
import { presentRfidCard, RfidError } from "../rfid";
import { disposeDeviceInstance, startDeviceInstance } from "../runtime";
import { MockCsmsServer } from "@/lib/ocpp/__tests__/mock-csms-server";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

/** Buffers frames so sequential `next()` calls can't drop one that arrives before the listener attaches. */
function createMessageQueue(serverSocket: WebSocket) {
  const buffered: unknown[][] = [];
  const waiters: Array<(msg: unknown[]) => void> = [];
  serverSocket.on("message", (data) => {
    const parsed = JSON.parse((data as Buffer).toString()) as unknown[];
    const waiter = waiters.shift();
    if (waiter) waiter(parsed);
    else buffered.push(parsed);
  });
  return {
    next(): Promise<unknown[]> {
      const queued = buffered.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)("presentRfidCard (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (instanceId) disposeDeviceInstance(instanceId);
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  it("authorizes the master card locally without requiring a CSMS connection", async () => {
    const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    await connectEv(instanceId, 1);

    const view = await presentRfidCard(instanceId, 1, "MASTER-1", 20);
    expect(view.status).toBe("Charging");
  });

  it("authorizes a local-auth-list idTag locally, even while disconnected", async () => {
    const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    await connectEv(instanceId, 1);
    await upsertLocalAuthEntry(instanceId, "LOCAL-CARD", "ACCEPTED");

    const view = await presentRfidCard(instanceId, 1, "LOCAL-CARD", 20);
    expect(view.status).toBe("Charging");
  });

  describe("LocalAuthListEnabled (CGP-0012/0013: a charger must not authorize from its own list when the CSMS turned that off)", () => {
    async function setLocalAuthListEnabled(value: string) {
      const model = await prisma.deviceModelParameter.create({
        data: { deviceModelId: deviceModel.id, key: "LocalAuthListEnabled", label: "Local authorization list enabled", category: "OTHER", valueType: "BOOLEAN", defaultValue: "true" },
      });
      await prisma.deviceInstanceParameter.create({ data: { deviceInstanceId: instanceId, deviceModelParameterId: model.id, key: "LocalAuthListEnabled", value } });
    }

    it("still honours the local list while the switch is on (default)", async () => {
      const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1" });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;
      await setLocalAuthListEnabled("true");
      await connectEv(instanceId, 1);
      await upsertLocalAuthEntry(instanceId, "LOCAL-CARD", "ACCEPTED");
      expect((await presentRfidCard(instanceId, 1, "LOCAL-CARD", 20)).status).toBe("Charging");
    });

    it("ignores the local list once the switch is off: the card needs the CSMS (here: unreachable -> refused)", async () => {
      const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1" });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;
      await setLocalAuthListEnabled("false");
      await connectEv(instanceId, 1);
      await upsertLocalAuthEntry(instanceId, "LOCAL-CARD", "ACCEPTED");
      await expect(presentRfidCard(instanceId, 1, "LOCAL-CARD", 20)).rejects.toThrow(RfidError);
    });

    it("does not affect the master card, which the station always accepts locally", async () => {
      const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1" });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;
      await setLocalAuthListEnabled("false");
      await connectEv(instanceId, 1);
      expect((await presentRfidCard(instanceId, 1, "MASTER-1", 20)).status).toBe("Charging");
    });
  });

  it("rejects an unknown idTag while disconnected", async () => {
    const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;

    await expect(presentRfidCard(instanceId, 1, "UNKNOWN-CARD", 20)).rejects.toThrow(RfidError);
  });

  it("authorizes an unknown idTag via a real Authorize/StartTransaction round-trip once connected", async () => {
    const server = await MockCsmsServer.start();
    try {
      const created = await createTestModelAndInstance({ masterCardIdTag: "MASTER-1", csmsUrl: server.url });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;

      await startDeviceInstance(instanceId);
      const serverSocket = await server.waitForConnection();
      const queue = createMessageQueue(serverSocket);

      // First frame is the automatic BootNotification (session.ts) — irrelevant here, left unanswered.
      await queue.next();

      await connectEv(instanceId, 1);

      // presentRfidCard blocks on the Authorize/StartTransaction round-trip below, so it must be
      // kicked off (not awaited yet) before awaiting the frames it sends.
      const cardPromise = presentRfidCard(instanceId, 1, "VISITOR-1", 15);

      const [, authId, authAction, authPayload] = await queue.next();
      expect(authAction).toBe("Authorize");
      expect(authPayload).toEqual({ idTag: "VISITOR-1" });
      serverSocket.send(JSON.stringify([3, authId, { idTagInfo: { status: "Accepted" } }]));

      const [, startId, startAction, startPayload] = await queue.next();
      expect(startAction).toBe("StartTransaction");
      expect(startPayload).toMatchObject({ connectorId: 1, idTag: "VISITOR-1" });
      serverSocket.send(JSON.stringify([3, startId, { idTagInfo: { status: "Accepted" }, transactionId: 777 }]));

      const view = await cardPromise;
      expect(view.status).toBe("Charging");
      expect(view.activeSession?.transactionId).toBe(777);

      const states = await listConnectorStates(instanceId);
      expect(states.find((c) => c.connectorId === 1)?.activeSession?.idTag).toBe("VISITOR-1");
    } finally {
      await server.close();
    }
  });
});
