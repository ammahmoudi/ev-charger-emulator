import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { OcppChargePointSession, OcppClient, registerRemoteCommandHandlers } from "../index";
import type { RemoteCommandHandlers } from "../remote-command-types";
import { MockCsmsServer } from "./mock-csms-server";

/**
 * Buffers every message frame the server socket receives from the moment it's created,
 * so sequentially-awaited `next()` calls can't drop a frame that arrives before the next
 * `next()` call attaches its listener (frames can arrive back-to-back within a tick).
 */
function createMessageQueue(serverSocket: WebSocket) {
  const buffered: unknown[][] = [];
  const waiters: Array<(msg: unknown[]) => void> = [];

  serverSocket.on("message", (data) => {
    const parsed = JSON.parse((data as Buffer).toString()) as unknown[];
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
    } else {
      buffered.push(parsed);
    }
  });

  return {
    next(): Promise<unknown[]> {
      const queued = buffered.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

const IDENTITY = { chargePointVendor: "Acme", chargePointModel: "X1" };
const CONNECTORS = [
  { connectorId: 1, label: "Plug A" },
  { connectorId: 2, label: "Plug B" },
];

describe("registerRemoteCommandHandlers", () => {
  let server: MockCsmsServer;
  let client: OcppClient;
  let session: OcppChargePointSession;
  let controller: RemoteCommandHandlers;
  let serverSocket: WebSocket;
  let queue: ReturnType<typeof createMessageQueue>;

  /** Boots the session (accepting BootNotification) and drains the two initial StatusNotifications. */
  async function bootAndDrain(): Promise<void> {
    client.connect();
    serverSocket = await server.waitForConnection();
    queue = createMessageQueue(serverSocket);

    const [, bootMessageId] = await queue.next();
    serverSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 300 }]));

    await queue.next();
    await queue.next();
  }

  function sendCall(action: string, payload: Record<string, unknown>, messageId = "csms-1"): void {
    serverSocket.send(JSON.stringify([2, messageId, action, payload]));
  }

  /** Collects `count` frames from the server's inbox, regardless of arrival order. */
  async function collectFrames(count: number): Promise<unknown[][]> {
    const frames: unknown[][] = [];
    for (let i = 0; i < count; i += 1) {
      frames.push(await queue.next());
    }
    return frames;
  }

  function findByAction(frames: unknown[][], action: string): unknown[] | undefined {
    return frames.find((frame) => frame[0] === 2 && frame[2] === action);
  }

  function findCallResult(frames: unknown[][], messageId: string): unknown[] | undefined {
    return frames.find((frame) => frame[0] === 3 && frame[1] === messageId);
  }

  beforeEach(async () => {
    server = await MockCsmsServer.start();
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = new OcppChargePointSession(client, { identity: IDENTITY, connectors: CONNECTORS });
    session.on("error", () => {});
    controller = registerRemoteCommandHandlers(client, session, { resetReconnectDelayMs: 20, diagnosticsUploadDelayMs: 20 });
    await bootAndDrain();
  });

  afterEach(async () => {
    controller?.dispose();
    session?.dispose();
    client?.disconnect();
    await server.close();
  });

  describe("RemoteStartTransaction / RemoteStopTransaction", () => {
    it("accepts, starts a transaction, and transitions the connector to Charging", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }, "start-1");

      const frames = await collectFrames(3);
      expect(findCallResult(frames, "start-1")).toEqual([3, "start-1", { status: "Accepted" }]);

      const preparingStatus = frames.find(
        (f) => f[0] === 2 && f[2] === "StatusNotification" && (f[3] as { status: string }).status === "Preparing",
      );
      expect(preparingStatus).toBeDefined();

      const startTxCall = findByAction(frames, "StartTransaction");
      expect(startTxCall).toBeDefined();
      const [, startTxMessageId, , startTxPayload] = startTxCall as [number, string, string, Record<string, unknown>];
      expect(startTxPayload).toMatchObject({ connectorId: 1, idTag: "TAG1", meterStart: 0 });

      serverSocket.send(
        JSON.stringify([3, startTxMessageId, { transactionId: 42, idTagInfo: { status: "Accepted" } }]),
      );

      const [, , chargingAction, chargingPayload] = await queue.next();
      expect(chargingAction).toBe("StatusNotification");
      expect(chargingPayload).toMatchObject({ connectorId: 1, status: "Charging" });

      expect(session.getConnectorStatus(1)).toMatchObject({ status: "Charging" });
      expect(controller.getActiveTransaction(1)).toEqual({ connectorId: 1, transactionId: 42, idTag: "TAG1" });
    });

    it("picks the first available connector when connectorId is omitted", async () => {
      sendCall("RemoteStartTransaction", { idTag: "TAG1" }, "start-2");

      const frames = await collectFrames(3);
      expect(findCallResult(frames, "start-2")).toEqual([3, "start-2", { status: "Accepted" }]);
      const startTxCall = findByAction(frames, "StartTransaction");
      expect((startTxCall?.[3] as Record<string, unknown>).connectorId).toBe(1);
    });

    it("rejects with a CALLERROR when idTag is missing", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1 }, "start-3");

      const [typeId, messageId, errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(messageId).toBe("start-3");
      expect(errorCode).toBe("PropertyConstraintViolation");
    });

    it("rejects when the requested connector is unknown", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 99, idTag: "TAG1" }, "start-4");

      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("rejects when the requested connector already has an active transaction", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }, "start-5");
      const frames = await collectFrames(3);
      const startTxCall = findByAction(frames, "StartTransaction");
      const [, startTxMessageId] = startTxCall as [number, string, string, Record<string, unknown>];
      serverSocket.send(
        JSON.stringify([3, startTxMessageId, { transactionId: 1, idTagInfo: { status: "Accepted" } }]),
      );
      await queue.next(); // Charging StatusNotification

      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG2" }, "start-6");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("stops an active transaction and returns the connector to Available", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }, "start-7");
      const startFrames = await collectFrames(3);
      const startTxCall = findByAction(startFrames, "StartTransaction");
      const [, startTxMessageId] = startTxCall as [number, string, string, Record<string, unknown>];
      serverSocket.send(
        JSON.stringify([3, startTxMessageId, { transactionId: 7, idTagInfo: { status: "Accepted" } }]),
      );
      await queue.next(); // Charging StatusNotification

      sendCall("RemoteStopTransaction", { transactionId: 7 }, "stop-1");
      const stopFrames = await collectFrames(2);
      expect(findCallResult(stopFrames, "stop-1")).toEqual([3, "stop-1", { status: "Accepted" }]);

      const stopTxCall = findByAction(stopFrames, "StopTransaction");
      expect((stopTxCall?.[3] as Record<string, unknown>)).toMatchObject({ transactionId: 7 });
      const [, stopTxMessageId] = stopTxCall as [number, string, string, Record<string, unknown>];
      serverSocket.send(JSON.stringify([3, stopTxMessageId, {}]));

      const [, , finishingAction, finishingPayload] = await queue.next();
      expect(finishingAction).toBe("StatusNotification");
      expect(finishingPayload).toMatchObject({ connectorId: 1, status: "Finishing" });

      const [, , availableAction, availablePayload] = await queue.next();
      expect(availableAction).toBe("StatusNotification");
      expect(availablePayload).toMatchObject({ connectorId: 1, status: "Available" });

      expect(session.getConnectorStatus(1)).toMatchObject({ status: "Available" });
      expect(controller.getActiveTransaction(1)).toBeUndefined();
    });

    it("rejects RemoteStopTransaction for an unknown transactionId", async () => {
      sendCall("RemoteStopTransaction", { transactionId: 999 }, "stop-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });
  });

  describe("UnlockConnector", () => {
    it("reports Unlocked for a known connector", async () => {
      sendCall("UnlockConnector", { connectorId: 2 }, "unlock-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Unlocked" });
    });

    it("reports NotSupported for an unknown connector", async () => {
      sendCall("UnlockConnector", { connectorId: 99 }, "unlock-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "NotSupported" });
    });
  });

  describe("Reset", () => {
    it("accepts and simulates a reconnect/reboot cycle", async () => {
      const nextConnectionPromise = server.waitForNextConnection();
      sendCall("Reset", { type: "Hard" }, "reset-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      const newSocket = await nextConnectionPromise;
      const newQueue = createMessageQueue(newSocket);
      const [, , rebootAction] = await newQueue.next();
      expect(rebootAction).toBe("BootNotification");
    });

    it("rejects Reset with a CALLERROR for an invalid type", async () => {
      sendCall("Reset", { type: "Nuclear" }, "reset-2");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });
  });

  describe("GetDiagnostics", () => {
    it("accepts and reports Uploading then Uploaded", async () => {
      sendCall("GetDiagnostics", { location: "ftp://example.com/diagnostics" }, "diag-1");
      const [, , confResult] = await queue.next();
      expect(confResult).toMatchObject({ fileName: expect.stringMatching(/^diagnostics_.*\.zip$/) });

      const [, uploadingMessageId, uploadingAction, uploadingPayload] = await queue.next();
      expect(uploadingAction).toBe("DiagnosticsStatusNotification");
      expect(uploadingPayload).toEqual({ status: "Uploading" });
      serverSocket.send(JSON.stringify([3, uploadingMessageId, {}]));

      const [, uploadedMessageId, uploadedAction, uploadedPayload] = await queue.next();
      expect(uploadedAction).toBe("DiagnosticsStatusNotification");
      expect(uploadedPayload).toEqual({ status: "Uploaded" });
      serverSocket.send(JSON.stringify([3, uploadedMessageId, {}]));
    });

    it("rejects with a CALLERROR when location is missing", async () => {
      sendCall("GetDiagnostics", {}, "diag-2");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });
  });

  describe("GetConfiguration / ChangeConfiguration", () => {
    it("returns every known key when none are requested", async () => {
      sendCall("GetConfiguration", {}, "getcfg-1");
      const [, , result] = await queue.next();
      const { configurationKey, unknownKey } = result as {
        configurationKey: Array<{ key: string }>;
        unknownKey: string[];
      };
      expect(configurationKey.map((e) => e.key)).toContain("HeartbeatInterval");
      expect(unknownKey).toEqual([]);
    });

    it("reports unknown keys separately from known ones", async () => {
      sendCall("GetConfiguration", { key: ["HeartbeatInterval", "Bogus"] }, "getcfg-2");
      const [, , result] = await queue.next();
      expect(result).toMatchObject({
        configurationKey: [{ key: "HeartbeatInterval", readonly: false, value: "300" }],
        unknownKey: ["Bogus"],
      });
    });

    it("changes a writable key", async () => {
      sendCall("ChangeConfiguration", { key: "HeartbeatInterval", value: "60" }, "chcfg-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      sendCall("GetConfiguration", { key: ["HeartbeatInterval"] }, "getcfg-3");
      const [, , getResult] = await queue.next();
      expect((getResult as { configurationKey: Array<{ value: string }> }).configurationKey[0].value).toBe("60");
    });

    it("rejects changing a readonly key", async () => {
      sendCall("ChangeConfiguration", { key: "NumberOfConnectors", value: "3" }, "chcfg-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("reports NotSupported for an unknown key", async () => {
      sendCall("ChangeConfiguration", { key: "Bogus", value: "x" }, "chcfg-3");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "NotSupported" });
    });
  });

  describe("ChangeAvailability", () => {
    it("marks a connector Inoperative and reports it as Unavailable", async () => {
      const changedPromise = new Promise((resolve) => session.once("connectorStatusChanged", resolve));
      sendCall("ChangeAvailability", { connectorId: 1, type: "Inoperative" }, "avail-1");

      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });
      await changedPromise;
      expect(session.getConnectorStatus(1)).toMatchObject({ status: "Unavailable" });
    });

    it("schedules Inoperative when the connector has an active transaction", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }, "start-8");
      const startFrames = await collectFrames(3);
      const startTxCall = findByAction(startFrames, "StartTransaction");
      const [, startTxMessageId] = startTxCall as [number, string, string, Record<string, unknown>];
      serverSocket.send(
        JSON.stringify([3, startTxMessageId, { transactionId: 8, idTagInfo: { status: "Accepted" } }]),
      );
      await queue.next(); // Charging StatusNotification

      sendCall("ChangeAvailability", { connectorId: 1, type: "Inoperative" }, "avail-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Scheduled" });
      expect(session.getConnectorStatus(1)).toMatchObject({ status: "Charging" });
    });

    it("applies to every connector when connectorId is 0", async () => {
      sendCall("ChangeAvailability", { connectorId: 0, type: "Inoperative" }, "avail-3");
      await queue.next(); // CALLRESULT
      await queue.next(); // StatusNotification for connector 1
      await queue.next(); // StatusNotification for connector 2

      expect(session.getConnectorStatus(1)).toMatchObject({ status: "Unavailable" });
      expect(session.getConnectorStatus(2)).toMatchObject({ status: "Unavailable" });
    });
  });

  describe("TriggerMessage", () => {
    it("re-sends BootNotification", async () => {
      sendCall("TriggerMessage", { requestedMessage: "BootNotification" }, "trigger-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      const [, , action] = await queue.next();
      expect(action).toBe("BootNotification");
    });

    it("re-sends Heartbeat", async () => {
      sendCall("TriggerMessage", { requestedMessage: "Heartbeat" }, "trigger-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      const [, , action] = await queue.next();
      expect(action).toBe("Heartbeat");
    });

    it("re-sends StatusNotification for the given connector", async () => {
      sendCall("TriggerMessage", { requestedMessage: "StatusNotification", connectorId: 2 }, "trigger-3");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      const [, , action, payload] = await queue.next();
      expect(action).toBe("StatusNotification");
      expect(payload).toMatchObject({ connectorId: 2 });
    });

    it("re-sends MeterValues for the given connector", async () => {
      sendCall("TriggerMessage", { requestedMessage: "MeterValues", connectorId: 1 }, "trigger-4");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      const [, , action, payload] = await queue.next();
      expect(action).toBe("MeterValues");
      expect(payload).toMatchObject({ connectorId: 1 });
    });

    it("rejects StatusNotification/MeterValues triggers without a valid connectorId", async () => {
      sendCall("TriggerMessage", { requestedMessage: "StatusNotification" }, "trigger-5");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("reports NotImplemented for an unsupported message type", async () => {
      sendCall("TriggerMessage", { requestedMessage: "FirmwareStatusNotification" }, "trigger-6");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "NotImplemented" });
    });
  });
});
