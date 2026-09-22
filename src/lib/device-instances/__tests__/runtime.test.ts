import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { queueOutboxMessage } from "../outbox";
import { disposeDeviceInstance, getRuntimeConnectionState, reconcileRuntimeOnStartup, startDeviceInstance } from "../runtime";
import { MockCsmsServer } from "@/lib/ocpp/__tests__/mock-csms-server";
import { prisma } from "@/lib/prisma";
import { createTestModelAndInstance, deleteTestDeviceModel, type TestDeviceModel } from "./test-helpers";

/** Buffers frames so sequential `next()`/`nextByAction()` calls can't drop one that arrives early. */
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
    /** Reads frames (draining any interleaved StatusNotification/Heartbeat traffic) until one matches `action`. */
    async nextByAction(action: string): Promise<unknown[]> {
      for (;;) {
        const frame = await this.next();
        if (frame[2] === action) return frame;
      }
    },
    /** Reads frames until the CALLRESULT ([3, messageId, payload]) for a CALL this test itself sent. */
    async nextResultFor(messageId: string): Promise<unknown[]> {
      for (;;) {
        const frame = await this.next();
        if (frame[0] === 3 && frame[1] === messageId) return frame;
      }
    },
  };
}

describe.skipIf(!process.env.DATABASE_URL)("runtime (integration)", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;
  let secondInstanceId: string | undefined;

  afterEach(async () => {
    if (instanceId) disposeDeviceInstance(instanceId);
    if (secondInstanceId) disposeDeviceInstance(secondInstanceId);
    secondInstanceId = undefined;
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  it("sends the device model's brand (not manufacturer) as BootNotification's chargePointVendor", async () => {
    const server = await MockCsmsServer.start();
    try {
      const created = await createTestModelAndInstance({ csmsUrl: server.url });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;
      expect(deviceModel.brand).toBe("TESTBRAND");
      expect(deviceModel.manufacturer).toBe("TESTMFR");

      await startDeviceInstance(instanceId);
      const serverSocket = await server.waitForConnection();
      const queue = createMessageQueue(serverSocket);

      const [, , action, payload] = await queue.nextByAction("BootNotification");
      expect(action).toBe("BootNotification");
      expect((payload as { chargePointVendor: string }).chargePointVendor).toBe("TESTBRAND");
    } finally {
      await server.close();
    }
  });

  it("drains the offline outbox once the instance reconnects and boot is accepted", async () => {
    const server = await MockCsmsServer.start();
    try {
      const created = await createTestModelAndInstance({ csmsUrl: server.url });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;
      await queueOutboxMessage(instanceId, "StopTransaction", { transactionId: 5, meterStop: 100 });

      await startDeviceInstance(instanceId);
      const serverSocket = await server.waitForConnection();
      const queue = createMessageQueue(serverSocket);

      const [, bootId] = await queue.nextByAction("BootNotification");
      serverSocket.send(JSON.stringify([3, bootId, { status: "Accepted", interval: 300 }]));

      const [, drainedMessageId, drainedAction, drainedPayload] = await queue.nextByAction("StopTransaction");
      expect(drainedAction).toBe("StopTransaction");
      expect(drainedPayload).toEqual({ transactionId: 5, meterStop: 100 });

      // `drainOutbox` only removes a queued message once its `callOcpp` promise resolves, i.e.
      // once the CSMS actually answers — respond, then the outbox entry should clear.
      serverSocket.send(JSON.stringify([3, drainedMessageId, { idTagInfo: { status: "Accepted" } }]));
      await expect
        .poll(async () => prisma.deviceInstanceOutboxMessage.count({ where: { deviceInstanceId: instanceId } }))
        .toBe(0);
    } finally {
      await server.close();
    }
  });

  it("reconcileRuntimeOnStartup reconnects instances left CONNECTED/CONNECTING, and leaves DISCONNECTED ones alone", async () => {
    const server = await MockCsmsServer.start();
    try {
      const created = await createTestModelAndInstance({ csmsUrl: server.url });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;
      await prisma.deviceInstance.update({ where: { id: instanceId }, data: { status: "CONNECTED" } });

      const staleInstance = await prisma.deviceInstance.create({
        data: {
          deviceModelId: deviceModel.id,
          name: "Stale disconnected instance",
          chargePointId: `stale-disconnected-${Date.now()}`,
          csmsUrl: "ws://localhost:1/unused",
          status: "DISCONNECTED",
        },
      });
      secondInstanceId = staleInstance.id;

      // Force the module's once-per-process guard to allow this test to trigger reconciliation
      // regardless of what earlier tests in this run already did.
      (globalThis as unknown as { deviceInstanceRuntimeReconciled?: boolean }).deviceInstanceRuntimeReconciled = false;
      await reconcileRuntimeOnStartup();

      await server.waitForConnection();
      // The server sees the TCP-level connection slightly before the client-side OcppClient
      // flips its own state to "connected" (that happens on the client's own "open" handler) —
      // poll rather than asserting immediately.
      await expect.poll(() => getRuntimeConnectionState(instanceId)).toBe("connected");

      const stillDisconnected = await prisma.deviceInstance.findUniqueOrThrow({ where: { id: staleInstance.id } });
      expect(stillDisconnected.status).toBe("DISCONNECTED");
    } finally {
      await server.close();
    }
  });

  // AUDIT-state.md's round-2 addendum: reservationStore/chargingProfileStore/localAuthListStore
  // are wired into registerRemoteCommandHandlers here — verify a real CSMS-initiated ReserveNow
  // actually persists via PrismaReservationStore (not just the in-memory default), proving the
  // wiring, not just the store class in isolation.
  it("a CSMS-initiated ReserveNow persists to DeviceInstanceReservation via the wired PrismaReservationStore", async () => {
    const server = await MockCsmsServer.start();
    try {
      const created = await createTestModelAndInstance({ csmsUrl: server.url });
      deviceModel = created.deviceModel;
      instanceId = created.instance.id;

      await startDeviceInstance(instanceId);
      const serverSocket = await server.waitForConnection();
      const queue = createMessageQueue(serverSocket);

      const [, bootId] = await queue.nextByAction("BootNotification");
      serverSocket.send(JSON.stringify([3, bootId, { status: "Accepted", interval: 300 }]));

      serverSocket.send(
        JSON.stringify([
          2,
          "reserve-1",
          "ReserveNow",
          { connectorId: 1, expiryDate: "2099-01-01T00:00:00Z", idTag: "RESERVED-CARD", reservationId: 42 },
        ]),
      );
      const [, , resultPayload] = await queue.nextResultFor("reserve-1");
      expect(resultPayload).toEqual({ status: "Accepted" });

      const row = await prisma.deviceInstanceReservation.findUnique({
        where: { deviceInstanceId_reservationId: { deviceInstanceId: instanceId, reservationId: 42 } },
      });
      expect(row).toMatchObject({ connectorId: 1, idTag: "RESERVED-CARD" });
    } finally {
      await server.close();
    }
  });
});
