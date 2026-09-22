import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    controller = registerRemoteCommandHandlers(client, session, {
      resetReconnectDelayMs: 20,
      diagnosticsUploadDelayMs: 20,
      firmwareDownloadDelayMs: 20,
      firmwareInstallDelayMs: 20,
    });
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

  // A separate connection (rather than the shared `client`/`session`/`controller` from
  // `beforeEach`, which are created without these deps) so each test can inject its own
  // `onRemoteTransactionStarted`/`onRemoteTransactionStopped` spies. See
  // AUDIT-integration.md and `remote-command-types.ts` for why these hooks exist: mirroring a
  // CSMS-initiated transaction into `device-instances`' Prisma-persisted connector state, which
  // this protocol-only module must never import directly.
  describe("onRemoteTransactionStarted / onRemoteTransactionStopped hooks", () => {
    it("fires the start hook once StartTransaction.conf comes back Accepted, and the stop hook once StopTransaction.conf comes back", async () => {
      const onRemoteTransactionStarted = vi.fn();
      const onRemoteTransactionStopped = vi.fn();
      const hookClient = new OcppClient({ url: server.url, reconnect: { enabled: false } });
      const hookSession = new OcppChargePointSession(hookClient, { identity: IDENTITY, connectors: CONNECTORS });
      hookSession.on("error", () => {});
      const hookController = registerRemoteCommandHandlers(hookClient, hookSession, {
        onRemoteTransactionStarted,
        onRemoteTransactionStopped,
      });

      hookClient.connect();
      const hookSocket = await server.waitForNextConnection();
      const hookQueue = createMessageQueue(hookSocket);

      const [, bootMessageId] = await hookQueue.next();
      hookSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 300 }]));
      await hookQueue.next();
      await hookQueue.next();

      hookSocket.send(
        JSON.stringify([2, "hook-start-1", "RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }]),
      );
      const startFrames = [await hookQueue.next(), await hookQueue.next(), await hookQueue.next()];
      expect(onRemoteTransactionStarted).not.toHaveBeenCalled();
      const startTxCall = findByAction(startFrames, "StartTransaction") as [number, string, string, Record<string, unknown>];
      hookSocket.send(JSON.stringify([3, startTxCall[1], { transactionId: 55, idTagInfo: { status: "Accepted" } }]));
      await hookQueue.next(); // Charging StatusNotification

      expect(onRemoteTransactionStarted).toHaveBeenCalledTimes(1);
      expect(onRemoteTransactionStarted).toHaveBeenCalledWith(1, {
        idTag: "TAG1",
        transactionId: 55,
        chargeRateKw: 30,
      });

      hookSocket.send(JSON.stringify([2, "hook-stop-1", "RemoteStopTransaction", { transactionId: 55 }]));
      const stopFrames = [await hookQueue.next(), await hookQueue.next()];
      const stopTxCall = findByAction(stopFrames, "StopTransaction") as [number, string, string, Record<string, unknown>];
      hookSocket.send(JSON.stringify([3, stopTxCall[1], {}]));
      await hookQueue.next(); // Finishing StatusNotification
      await hookQueue.next(); // Available StatusNotification

      expect(onRemoteTransactionStopped).toHaveBeenCalledTimes(1);
      expect(onRemoteTransactionStopped).toHaveBeenCalledWith(1, {
        transactionId: 55,
        reason: "Remote",
        meterStopWh: expect.any(Number),
      });

      hookController.dispose();
      hookSession.dispose();
      hookClient.disconnect();
    });

    it("still transitions the connector even when the start hook itself throws, and reports the error via onError", async () => {
      const onError = vi.fn();
      const hookClient = new OcppClient({ url: server.url, reconnect: { enabled: false } });
      const hookSession = new OcppChargePointSession(hookClient, { identity: IDENTITY, connectors: CONNECTORS });
      hookSession.on("error", () => {});
      const hookController = registerRemoteCommandHandlers(hookClient, hookSession, {
        onError,
        onRemoteTransactionStarted: () => {
          throw new Error("mirror failed");
        },
      });

      hookClient.connect();
      const hookSocket = await server.waitForNextConnection();
      const hookQueue = createMessageQueue(hookSocket);

      const [, bootMessageId] = await hookQueue.next();
      hookSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 300 }]));
      await hookQueue.next();
      await hookQueue.next();

      hookSocket.send(
        JSON.stringify([2, "hook-start-err", "RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }]),
      );
      const startFrames = [await hookQueue.next(), await hookQueue.next(), await hookQueue.next()];
      const startTxCall = findByAction(startFrames, "StartTransaction") as [number, string, string, Record<string, unknown>];
      hookSocket.send(JSON.stringify([3, startTxCall[1], { transactionId: 56, idTagInfo: { status: "Accepted" } }]));
      await hookQueue.next(); // Charging StatusNotification still goes out despite the hook throwing

      expect(hookSession.getConnectorStatus(1)).toMatchObject({ status: "Charging" });
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "mirror failed" }));

      hookController.dispose();
      hookSession.dispose();
      hookClient.disconnect();
    });
  });

  describe("finishingHoldMs", () => {
    it("keeps the connector in Finishing for finishingHoldMs before flipping to Available", async () => {
      const holdClient = new OcppClient({ url: server.url, reconnect: { enabled: false } });
      const holdSession = new OcppChargePointSession(holdClient, { identity: IDENTITY, connectors: CONNECTORS });
      holdSession.on("error", () => {});
      const holdController = registerRemoteCommandHandlers(holdClient, holdSession, { finishingHoldMs: 60 });

      holdClient.connect();
      const holdSocket = await server.waitForNextConnection();
      const holdQueue = createMessageQueue(holdSocket);

      const [, bootMessageId] = await holdQueue.next();
      holdSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 300 }]));
      await holdQueue.next();
      await holdQueue.next();

      holdSocket.send(JSON.stringify([2, "hold-start-1", "RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }]));
      const startFrames = [await holdQueue.next(), await holdQueue.next(), await holdQueue.next()];
      const startTxCall = findByAction(startFrames, "StartTransaction") as [number, string, string, Record<string, unknown>];
      holdSocket.send(JSON.stringify([3, startTxCall[1], { transactionId: 60, idTagInfo: { status: "Accepted" } }]));
      await holdQueue.next(); // Charging StatusNotification

      holdSocket.send(JSON.stringify([2, "hold-stop-1", "RemoteStopTransaction", { transactionId: 60 }]));
      const stopFrames = [await holdQueue.next(), await holdQueue.next()];
      const stopTxCall = findByAction(stopFrames, "StopTransaction") as [number, string, string, Record<string, unknown>];
      holdSocket.send(JSON.stringify([3, stopTxCall[1], {}]));

      const [, , finishingAction, finishingPayload] = await holdQueue.next();
      expect(finishingAction).toBe("StatusNotification");
      expect(finishingPayload).toMatchObject({ status: "Finishing" });
      expect(holdSession.getConnectorStatus(1)).toMatchObject({ status: "Finishing" });

      // Still well within the hold — the connector must not have flipped to Available yet.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(holdSession.getConnectorStatus(1)).toMatchObject({ status: "Finishing" });

      const [, , availableAction, availablePayload] = await holdQueue.next();
      expect(availableAction).toBe("StatusNotification");
      expect(availablePayload).toMatchObject({ status: "Available" });
      expect(holdSession.getConnectorStatus(1)).toMatchObject({ status: "Available" });

      holdController.dispose();
      holdSession.dispose();
      holdClient.disconnect();
    });

    it("still fires onRemoteTransactionStopped immediately, not delayed by finishingHoldMs", async () => {
      const onRemoteTransactionStopped = vi.fn();
      const holdClient = new OcppClient({ url: server.url, reconnect: { enabled: false } });
      const holdSession = new OcppChargePointSession(holdClient, { identity: IDENTITY, connectors: CONNECTORS });
      holdSession.on("error", () => {});
      const holdController = registerRemoteCommandHandlers(holdClient, holdSession, {
        finishingHoldMs: 500,
        onRemoteTransactionStopped,
      });

      holdClient.connect();
      const holdSocket = await server.waitForNextConnection();
      const holdQueue = createMessageQueue(holdSocket);

      const [, bootMessageId] = await holdQueue.next();
      holdSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 300 }]));
      await holdQueue.next();
      await holdQueue.next();

      holdSocket.send(JSON.stringify([2, "hold-start-2", "RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }]));
      const startFrames = [await holdQueue.next(), await holdQueue.next(), await holdQueue.next()];
      const startTxCall = findByAction(startFrames, "StartTransaction") as [number, string, string, Record<string, unknown>];
      holdSocket.send(JSON.stringify([3, startTxCall[1], { transactionId: 61, idTagInfo: { status: "Accepted" } }]));
      await holdQueue.next(); // Charging StatusNotification

      holdSocket.send(JSON.stringify([2, "hold-stop-2", "RemoteStopTransaction", { transactionId: 61 }]));
      const stopFrames = [await holdQueue.next(), await holdQueue.next()];
      const stopTxCall = findByAction(stopFrames, "StopTransaction") as [number, string, string, Record<string, unknown>];
      holdSocket.send(JSON.stringify([3, stopTxCall[1], {}]));
      await holdQueue.next(); // Finishing StatusNotification

      // The hook has already fired here, well before the 500ms hold elapses.
      expect(onRemoteTransactionStopped).toHaveBeenCalledTimes(1);
      expect(onRemoteTransactionStopped).toHaveBeenCalledWith(1, {
        transactionId: 61,
        reason: "Remote",
        meterStopWh: expect.any(Number),
      });
      expect(holdSession.getConnectorStatus(1)).toMatchObject({ status: "Finishing" });

      holdController.dispose();
      holdSession.dispose();
      holdClient.disconnect();
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

    it("re-sends FirmwareStatusNotification (Idle, if no update has ever run)", async () => {
      sendCall("TriggerMessage", { requestedMessage: "FirmwareStatusNotification" }, "trigger-6");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      const [, , action, payload] = await queue.next();
      expect(action).toBe("FirmwareStatusNotification");
      expect(payload).toEqual({ status: "Idle" });
    });

    it("reports NotImplemented for an unsupported message type", async () => {
      sendCall("TriggerMessage", { requestedMessage: "Bogus" }, "trigger-7");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "NotImplemented" });
    });
  });

  describe("Meter value simulation", () => {
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined;
    let mockNow = 0;

    function mockDateNow(startMs: number): void {
      mockNow = startMs;
      nowSpy = vi.spyOn(Date, "now").mockImplementation(() => mockNow);
    }

    afterEach(() => {
      nowSpy?.mockRestore();
      nowSpy = undefined;
    });

    async function acceptStart(
      idTag: string,
      messageId: string,
      transactionId: number,
    ): Promise<Record<string, unknown>> {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag }, messageId);
      const frames = await collectFrames(3);
      const startTxCall = findByAction(frames, "StartTransaction");
      const [, startTxMessageId, , startPayload] = startTxCall as [number, string, string, Record<string, unknown>];
      serverSocket.send(
        JSON.stringify([3, startTxMessageId, { transactionId, idTagInfo: { status: "Accepted" } }]),
      );
      await queue.next(); // Charging StatusNotification
      return startPayload;
    }

    it("accumulates energy over time and carries the register into the next session (not always 0)", async () => {
      mockDateNow(1_700_000_000_000);
      const firstStart = await acceptStart("TAG1", "meter-start-1", 100);
      expect(firstStart).toMatchObject({ meterStart: 0 });

      // 1 simulated hour at the 30kW test-default charge rate → 30,000 Wh accumulated.
      mockNow += 3_600_000;
      sendCall("RemoteStopTransaction", { transactionId: 100 }, "meter-stop-1");
      const stopFrames = await collectFrames(2);
      const stopTxCall = findByAction(stopFrames, "StopTransaction");
      const [, stopTxMessageId, , stopPayload] = stopTxCall as [number, string, string, Record<string, unknown>];
      expect(stopPayload).toMatchObject({ transactionId: 100, reason: "Remote", idTag: "TAG1", meterStop: 30_000 });
      const transactionData = (stopPayload.transactionData as Array<{ sampledValue: Array<Record<string, string>> }>)[0];
      expect(transactionData.sampledValue).toEqual(
        expect.arrayContaining([expect.objectContaining({ measurand: "Energy.Active.Import.Register", context: "Transaction.End" })]),
      );
      serverSocket.send(JSON.stringify([3, stopTxMessageId, {}]));
      await queue.next(); // Finishing
      await queue.next(); // Available

      // A second session on the same connector should start from where the first left off,
      // not reset to 0 — a real charger's register never resets between transactions.
      const secondStart = await acceptStart("TAG2", "meter-start-2", 101);
      expect(secondStart).toMatchObject({ meterStart: 30_000 });
    });

    it("sends a realistic non-zero MeterValues sample (Voltage/Current/Power/SoC) once charging", async () => {
      await acceptStart("TAG1", "meter-3", 200);
      sendCall("TriggerMessage", { requestedMessage: "MeterValues", connectorId: 1 }, "meter-trigger-1");
      await queue.next(); // CALLRESULT
      const [, , action, payload] = await queue.next();
      expect(action).toBe("MeterValues");
      const { meterValue, transactionId } = payload as {
        meterValue: Array<{ sampledValue: Array<Record<string, string>> }>;
        transactionId: number;
      };
      expect(transactionId).toBe(200);
      const measurands = meterValue[0].sampledValue.map((sv) => sv.measurand);
      expect(measurands).toEqual(
        expect.arrayContaining([
          "Energy.Active.Import.Register",
          "Voltage",
          "Current.Import",
          "Power.Active.Import",
          "Power.Offered",
          "SoC",
        ]),
      );
      const energy = meterValue[0].sampledValue.find((sv) => sv.measurand === "Energy.Active.Import.Register");
      expect(energy?.context).toBe("Sample.Periodic");
      const voltage = meterValue[0].sampledValue.find((sv) => sv.measurand === "Voltage");
      expect(Number(voltage?.value)).toBeGreaterThan(0);
    });

    it("reports a single zeroed Energy sample with Sample.Clock/Outlet when idle (no active transaction)", async () => {
      sendCall("TriggerMessage", { requestedMessage: "MeterValues", connectorId: 2 }, "meter-idle-1");
      await queue.next(); // CALLRESULT
      const [, , , payload] = await queue.next();
      const { meterValue } = payload as { meterValue: Array<{ sampledValue: Array<Record<string, string>> }> };
      expect(meterValue[0].sampledValue).toEqual([
        expect.objectContaining({
          measurand: "Energy.Active.Import.Register",
          context: "Sample.Clock",
          location: "Outlet",
          unit: "Wh",
        }),
      ]);
    });
  });

  describe("SetChargingProfile throttling", () => {
    let nowSpy: ReturnType<typeof vi.spyOn> | undefined;
    let mockNow = 0;

    function mockDateNow(startMs: number): void {
      mockNow = startMs;
      nowSpy = vi.spyOn(Date, "now").mockImplementation(() => mockNow);
    }

    afterEach(() => {
      nowSpy?.mockRestore();
      nowSpy = undefined;
    });

    async function acceptStart(idTag: string, messageId: string, transactionId: number): Promise<void> {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag }, messageId);
      const frames = await collectFrames(3);
      const startTxCall = findByAction(frames, "StartTransaction");
      const [, startTxMessageId] = startTxCall as [number, string, string, Record<string, unknown>];
      serverSocket.send(
        JSON.stringify([3, startTxMessageId, { transactionId, idTagInfo: { status: "Accepted" } }]),
      );
      await queue.next(); // Charging StatusNotification
    }

    async function setTxProfile(profile: Record<string, unknown>, messageId: string): Promise<void> {
      sendCall("SetChargingProfile", { connectorId: 1, csChargingProfiles: profile }, messageId);
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });
    }

    async function triggerMeterValues(messageId: string): Promise<Array<Record<string, string>>> {
      sendCall("TriggerMessage", { requestedMessage: "MeterValues", connectorId: 1 }, messageId);
      await queue.next(); // CALLRESULT
      const [, , , payload] = await queue.next();
      return (payload as { meterValue: Array<{ sampledValue: Array<Record<string, string>> }> }).meterValue[0]
        .sampledValue;
    }

    it("clamps to a TxProfile limit expressed in Watts, below the device's rated power", async () => {
      mockDateNow(1_800_000_000_000);
      await acceptStart("TAG1", "throttle-w-start", 300);
      await setTxProfile(
        {
          chargingProfileId: 10,
          stackLevel: 0,
          chargingProfilePurpose: "TxProfile",
          chargingProfileKind: "Absolute",
          chargingSchedule: {
            chargingRateUnit: "W",
            chargingSchedulePeriod: [{ startPeriod: 0, limit: 10_000 }],
          },
        },
        "throttle-w-profile",
      );

      const sampledValue = await triggerMeterValues("throttle-w-meter");
      const offered = sampledValue.find((sv) => sv.measurand === "Power.Offered");
      const active = sampledValue.find((sv) => sv.measurand === "Power.Active.Import");
      expect(offered?.value).toBe("10000.0");
      expect(Number(active?.value)).toBeLessThanOrEqual(10_000);

      // 1 simulated hour at the throttled 10kW rate → 10,000 Wh, not the unthrottled 30,000 Wh.
      mockNow += 3_600_000;
      sendCall("RemoteStopTransaction", { transactionId: 300 }, "throttle-w-stop");
      const stopFrames = await collectFrames(2);
      const stopTxCall = findByAction(stopFrames, "StopTransaction");
      const [, , , stopPayload] = stopTxCall as [number, string, string, Record<string, unknown>];
      expect(stopPayload).toMatchObject({ meterStop: 10_000 });
    });

    it("clamps to a TxProfile limit expressed in Amps, converted via the nominal voltage constant", async () => {
      mockDateNow(1_800_000_000_000);
      await acceptStart("TAG1", "throttle-a-start", 301);
      await setTxProfile(
        {
          chargingProfileId: 11,
          stackLevel: 0,
          chargingProfilePurpose: "TxProfile",
          chargingProfileKind: "Absolute",
          chargingSchedule: {
            chargingRateUnit: "A",
            // 20A * 400V (this module's nominal voltage constant) = 8000W = 8kW.
            chargingSchedulePeriod: [{ startPeriod: 0, limit: 20 }],
          },
        },
        "throttle-a-profile",
      );

      const sampledValue = await triggerMeterValues("throttle-a-meter");
      const offered = sampledValue.find((sv) => sv.measurand === "Power.Offered");
      expect(offered?.value).toBe("8000.0");

      mockNow += 3_600_000;
      sendCall("RemoteStopTransaction", { transactionId: 301 }, "throttle-a-stop");
      const stopFrames = await collectFrames(2);
      const stopTxCall = findByAction(stopFrames, "StopTransaction");
      const [, , , stopPayload] = stopTxCall as [number, string, string, Record<string, unknown>];
      expect(stopPayload).toMatchObject({ meterStop: 8_000 });
    });

    it("does not throttle below the device's rated power when the TxProfile limit is higher", async () => {
      mockDateNow(1_800_000_000_000);
      await acceptStart("TAG1", "throttle-noop-start", 302);
      await setTxProfile(
        {
          chargingProfileId: 12,
          stackLevel: 0,
          chargingProfilePurpose: "TxProfile",
          chargingProfileKind: "Absolute",
          chargingSchedule: {
            chargingRateUnit: "W",
            // Well above the 30kW test-default rated power fallback — should have no effect.
            chargingSchedulePeriod: [{ startPeriod: 0, limit: 100_000 }],
          },
        },
        "throttle-noop-profile",
      );

      const sampledValue = await triggerMeterValues("throttle-noop-meter");
      const offered = sampledValue.find((sv) => sv.measurand === "Power.Offered");
      expect(offered?.value).toBe("30000.0");
    });

    it("integrates energy piecewise across a schedule's changing periods, not the final period's rate retroactively", async () => {
      mockDateNow(1_800_000_000_000);
      await acceptStart("TAG1", "throttle-piecewise-start", 303);
      // Set immediately (elapsedSec ~ 0) since this module treats a TxProfile's schedule as
      // relative to the transaction's own start (see AUDIT-ocpp.md) — the whole elapsed duration
      // is integrated against this schedule regardless of exactly when SetChargingProfile arrived.
      await setTxProfile(
        {
          chargingProfileId: 13,
          stackLevel: 0,
          chargingProfilePurpose: "TxProfile",
          chargingProfileKind: "Relative",
          chargingSchedule: {
            chargingRateUnit: "A",
            chargingSchedulePeriod: [
              { startPeriod: 0, limit: 20 }, // 8kW for the first half hour
              { startPeriod: 1_800, limit: 10 }, // 4kW for the second half hour
            ],
          },
        },
        "throttle-piecewise-profile",
      );

      mockNow += 3_600_000; // 1 hour total: 0.5h @ 8kW + 0.5h @ 4kW = 4000 + 2000 = 6000 Wh
      sendCall("RemoteStopTransaction", { transactionId: 303 }, "throttle-piecewise-stop");
      const stopFrames = await collectFrames(2);
      const stopTxCall = findByAction(stopFrames, "StopTransaction");
      const [, , , stopPayload] = stopTxCall as [number, string, string, Record<string, unknown>];
      expect(stopPayload).toMatchObject({ meterStop: 6_000 });
    });

    it("ignores TxDefaultProfile/ChargePointMaxProfile purposes (only TxProfile throttles)", async () => {
      mockDateNow(1_800_000_000_000);
      await acceptStart("TAG1", "throttle-purpose-start", 304);
      await setTxProfile(
        {
          chargingProfileId: 14,
          stackLevel: 0,
          chargingProfilePurpose: "TxDefaultProfile",
          chargingProfileKind: "Absolute",
          chargingSchedule: {
            chargingRateUnit: "W",
            chargingSchedulePeriod: [{ startPeriod: 0, limit: 5_000 }],
          },
        },
        "throttle-purpose-profile",
      );

      const sampledValue = await triggerMeterValues("throttle-purpose-meter");
      const offered = sampledValue.find((sv) => sv.measurand === "Power.Offered");
      expect(offered?.value).toBe("30000.0");
    });
  });

  describe("ReserveNow / CancelReservation", () => {
    /** Sends ReserveNow and drains its CALLRESULT + the deferred Reserved StatusNotification. */
    async function reserve(connectorId: number, idTag: string, reservationId: number, messageId: string): Promise<void> {
      sendCall(
        "ReserveNow",
        { connectorId, expiryDate: "2099-01-01T00:00:00Z", idTag, reservationId },
        messageId,
      );
      const frames = await collectFrames(2);
      expect(findCallResult(frames, messageId)).toEqual([3, messageId, { status: "Accepted" }]);
    }

    it("accepts a reservation on an Available connector and marks it Reserved", async () => {
      await reserve(2, "TAG1", 1, "res-1");
      expect(session.getConnectorStatus(2)).toMatchObject({ status: "Reserved" });
      expect(await controller.listReservations()).toEqual([
        expect.objectContaining({ reservationId: 1, connectorId: 2, idTag: "TAG1" }),
      ]);
    });

    it("reports Occupied when the requested connector isn't Available", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG1" }, "res-occ-start");
      // CALLRESULT(Accepted) + Preparing StatusNotification + StartTransaction call (left unanswered).
      await collectFrames(3);

      sendCall("ReserveNow", { connectorId: 1, expiryDate: "2099-01-01T00:00:00Z", idTag: "TAG2", reservationId: 2 }, "res-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Occupied" });
    });

    it("rejects a reservation for an unknown connector", async () => {
      sendCall("ReserveNow", { connectorId: 99, expiryDate: "2099-01-01T00:00:00Z", idTag: "TAG1", reservationId: 3 }, "res-3");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("rejects with a CALLERROR when required fields are missing", async () => {
      sendCall("ReserveNow", { connectorId: 1 }, "res-4");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });

    it("cancels a reservation and returns the connector to Available", async () => {
      await reserve(2, "TAG1", 5, "res-5");

      sendCall("CancelReservation", { reservationId: 5 }, "cancel-1");
      const frames = await collectFrames(2);
      expect(findCallResult(frames, "cancel-1")).toEqual([3, "cancel-1", { status: "Accepted" }]);
      expect(session.getConnectorStatus(2)).toMatchObject({ status: "Available" });
    });

    it("rejects CancelReservation for an unknown reservationId", async () => {
      sendCall("CancelReservation", { reservationId: 999 }, "cancel-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("lets RemoteStartTransaction redeem a matching reservation instead of permanently blocking the connector", async () => {
      await reserve(2, "TAG1", 6, "res-6");

      sendCall("RemoteStartTransaction", { connectorId: 2, idTag: "TAG1" }, "res-start-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });
    });

    it("rejects RemoteStartTransaction on a Reserved connector with a non-matching idTag", async () => {
      await reserve(2, "TAG1", 7, "res-7");

      sendCall("RemoteStartTransaction", { connectorId: 2, idTag: "OTHER" }, "res-start-2");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });
  });

  describe("SetChargingProfile / ClearChargingProfile", () => {
    const VALID_PROFILE = {
      chargingProfileId: 1,
      stackLevel: 0,
      chargingProfilePurpose: "TxDefaultProfile",
      chargingProfileKind: "Absolute",
      chargingSchedule: {
        chargingRateUnit: "A",
        chargingSchedulePeriod: [{ startPeriod: 0, limit: 16 }],
      },
    };

    it("accepts and stores a valid profile", async () => {
      sendCall("SetChargingProfile", { connectorId: 1, csChargingProfiles: VALID_PROFILE }, "prof-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });
      expect(await controller.listChargingProfiles(1)).toEqual([{ connectorId: 1, profile: VALID_PROFILE }]);
    });

    it("rejects with a CALLERROR for a malformed profile", async () => {
      sendCall("SetChargingProfile", { connectorId: 1, csChargingProfiles: { chargingProfileId: 1 } }, "prof-2");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });

    it("rejects a TxProfile targeting connectorId 0", async () => {
      sendCall(
        "SetChargingProfile",
        { connectorId: 0, csChargingProfiles: { ...VALID_PROFILE, chargingProfilePurpose: "TxProfile" } },
        "prof-3",
      );
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Rejected" });
    });

    it("clears a stored profile by id and reports Unknown when nothing matches", async () => {
      sendCall("SetChargingProfile", { connectorId: 1, csChargingProfiles: VALID_PROFILE }, "prof-4");
      await queue.next();

      sendCall("ClearChargingProfile", { id: 1 }, "clear-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });
      expect(await controller.listChargingProfiles()).toEqual([]);

      sendCall("ClearChargingProfile", { id: 1 }, "clear-2");
      const [, , result2] = await queue.next();
      expect(result2).toEqual({ status: "Unknown" });
    });

    it("captures RemoteStartTransaction's optional inline chargingProfile", async () => {
      sendCall("RemoteStartTransaction", { connectorId: 1, idTag: "TAG1", chargingProfile: VALID_PROFILE }, "prof-rst-1");
      await collectFrames(3);
      expect(await controller.listChargingProfiles(1)).toEqual([{ connectorId: 1, profile: VALID_PROFILE }]);
    });
  });

  describe("DataTransfer", () => {
    it("reports UnknownVendorId for an unrecognized vendor", async () => {
      sendCall("DataTransfer", { vendorId: "com.example.unknown" }, "dt-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "UnknownVendorId" });
    });

    it("rejects with a CALLERROR when vendorId is missing", async () => {
      sendCall("DataTransfer", {}, "dt-2");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });
  });

  describe("SendLocalList / GetLocalListVersion", () => {
    it("starts at version 0 with an empty list", async () => {
      sendCall("GetLocalListVersion", {}, "llv-1");
      const [, , result] = await queue.next();
      expect(result).toEqual({ listVersion: 0 });
    });

    it("accepts a Full update and reports the new version", async () => {
      sendCall(
        "SendLocalList",
        {
          listVersion: 1,
          updateType: "Full",
          localAuthorizationList: [{ idTag: "TAG1", idTagInfo: { status: "Accepted" } }],
        },
        "sll-1",
      );
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });

      sendCall("GetLocalListVersion", {}, "llv-2");
      const [, , versionResult] = await queue.next();
      expect(versionResult).toEqual({ listVersion: 1 });
      expect(await controller.listLocalAuthListEntries()).toEqual([
        { idTag: "TAG1", idTagInfo: { status: "Accepted" } },
      ]);
    });

    it("rejects a stale (non-advancing) version with VersionMismatch", async () => {
      sendCall(
        "SendLocalList",
        { listVersion: 1, updateType: "Full", localAuthorizationList: [] },
        "sll-2",
      );
      await queue.next();

      sendCall(
        "SendLocalList",
        { listVersion: 1, updateType: "Full", localAuthorizationList: [] },
        "sll-3",
      );
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "VersionMismatch" });
    });

    it("fails a Differential update before any Full list has been applied", async () => {
      sendCall(
        "SendLocalList",
        {
          listVersion: 1,
          updateType: "Differential",
          localAuthorizationList: [{ idTag: "TAG1", idTagInfo: { status: "Accepted" } }],
        },
        "sll-4",
      );
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Failed" });
    });

    it("removes an entry via a Differential update with no idTagInfo", async () => {
      sendCall(
        "SendLocalList",
        {
          listVersion: 1,
          updateType: "Full",
          localAuthorizationList: [{ idTag: "TAG1", idTagInfo: { status: "Accepted" } }],
        },
        "sll-5",
      );
      await queue.next();

      sendCall(
        "SendLocalList",
        { listVersion: 2, updateType: "Differential", localAuthorizationList: [{ idTag: "TAG1" }] },
        "sll-6",
      );
      const [, , result] = await queue.next();
      expect(result).toEqual({ status: "Accepted" });
      expect(await controller.listLocalAuthListEntries()).toEqual([]);
    });
  });

  describe("UpdateFirmware", () => {
    it("accepts with an empty conf and later reports the Downloading/Downloaded/Installing/Installed sequence", async () => {
      sendCall(
        "UpdateFirmware",
        { location: "ftp://example.com/firmware.bin", retrieveDate: new Date().toISOString() },
        "fw-1",
      );
      const [, , result] = await queue.next();
      expect(result).toEqual({});

      const statuses: string[] = [];
      for (let i = 0; i < 4; i += 1) {
        const [, notificationMessageId, action, payload] = await queue.next();
        expect(action).toBe("FirmwareStatusNotification");
        statuses.push((payload as { status: string }).status);
        serverSocket.send(JSON.stringify([3, notificationMessageId, {}]));
      }
      expect(statuses).toEqual(["Downloading", "Downloaded", "Installing", "Installed"]);
    });

    it("rejects with a CALLERROR when location is missing", async () => {
      sendCall("UpdateFirmware", { retrieveDate: new Date().toISOString() }, "fw-2");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });

    it("rejects with a CALLERROR when retrieveDate is invalid", async () => {
      sendCall("UpdateFirmware", { location: "ftp://example.com/firmware.bin", retrieveDate: "not-a-date" }, "fw-3");
      const [typeId, , errorCode] = await queue.next();
      expect(typeId).toBe(4);
      expect(errorCode).toBe("PropertyConstraintViolation");
    });
  });
});
