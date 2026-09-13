import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { OcppChargePointSession, OcppClient } from "../index";
import { MockCsmsServer } from "./mock-csms-server";

interface MinimalEmitter {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
}

function waitForEvent<T extends unknown[] = unknown[]>(
  target: MinimalEmitter,
  event: string,
): Promise<T> {
  return new Promise((resolve) => {
    target.once(event, (...args: unknown[]) => resolve(args as T));
  });
}

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

const IDENTITY = { chargePointVendor: "Acme", chargePointModel: "X1", firmwareVersion: "1.2.3" };
const CONNECTORS = [
  { connectorId: 1, label: "Plug A" },
  { connectorId: 2, label: "Plug B" },
];

/** Creates a session with a no-op error listener, so expected teardown/transport errors don't blow up the test run. */
function createSession(client: OcppClient): OcppChargePointSession {
  const session = new OcppChargePointSession(client, { identity: IDENTITY, connectors: CONNECTORS });
  session.on("error", () => {});
  return session;
}

describe("OcppChargePointSession", () => {
  let server: MockCsmsServer;
  let client: OcppClient;
  let session: OcppChargePointSession;

  beforeEach(async () => {
    server = await MockCsmsServer.start();
  });

  afterEach(async () => {
    session?.dispose();
    client?.disconnect();
    await server.close();
  });

  it("sends BootNotification with the configured identity on connect", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = createSession(client);

    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [typeId, , action, payload] = await queue.next();
    expect(typeId).toBe(2);
    expect(action).toBe("BootNotification");
    expect(payload).toEqual({
      chargePointVendor: "Acme",
      chargePointModel: "X1",
      firmwareVersion: "1.2.3",
    });
  });

  it("starts the heartbeat loop and flushes per-connector StatusNotifications on Accepted", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = createSession(client);

    const bootAcceptedPromise = waitForEvent<[{ heartbeatIntervalSec: number }]>(session, "bootAccepted");
    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [, bootMessageId] = await queue.next();
    serverSocket.send(
      JSON.stringify([3, bootMessageId, { status: "Accepted", currentTime: "2026-01-01T00:00:00Z", interval: 0.05 }]),
    );

    const [{ heartbeatIntervalSec }] = await bootAcceptedPromise;
    expect(heartbeatIntervalSec).toBe(0.05);
    expect(session.getBootStatus()).toBe("accepted");

    const firstStatus = await queue.next();
    const secondStatus = await queue.next();
    const statusPayloads = [firstStatus, secondStatus]
      .map(([, , action, payload]) => ({ action, payload }))
      .sort((a, b) => (a.payload as { connectorId: number }).connectorId - (b.payload as { connectorId: number }).connectorId);

    expect(statusPayloads).toEqual([
      { action: "StatusNotification", payload: expect.objectContaining({ connectorId: 1, status: "Available", errorCode: "NoError" }) },
      { action: "StatusNotification", payload: expect.objectContaining({ connectorId: 2, status: "Available", errorCode: "NoError" }) },
    ]);

    const [, heartbeatMessageId, heartbeatAction] = await queue.next();
    expect(heartbeatAction).toBe("Heartbeat");

    const heartbeatPromise = waitForEvent<[{ currentTime: string }]>(session, "heartbeat");
    serverSocket.send(JSON.stringify([3, heartbeatMessageId, { currentTime: "2026-01-01T00:00:01Z" }]));
    const [{ currentTime }] = await heartbeatPromise;
    expect(currentTime).toBe("2026-01-01T00:00:01Z");
  });

  it("retries BootNotification after Pending, then starts heartbeats once Accepted", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = createSession(client);

    const bootPendingPromise = waitForEvent<[{ retryInMs: number }]>(session, "bootPending");
    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [, firstBootId, firstAction] = await queue.next();
    expect(firstAction).toBe("BootNotification");
    serverSocket.send(JSON.stringify([3, firstBootId, { status: "Pending", interval: 0.05 }]));

    const [{ retryInMs }] = await bootPendingPromise;
    expect(retryInMs).toBe(50);
    expect(session.getBootStatus()).toBe("pending");

    const bootAcceptedPromise = waitForEvent(session, "bootAccepted");
    const [, secondBootId, secondAction] = await queue.next();
    expect(secondAction).toBe("BootNotification");
    serverSocket.send(JSON.stringify([3, secondBootId, { status: "Accepted", interval: 0.05 }]));

    await bootAcceptedPromise;
    expect(session.getBootStatus()).toBe("accepted");
  });

  it("retries BootNotification after Rejected and does not start heartbeats", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = createSession(client);

    const bootRejectedPromise = waitForEvent<[{ retryInMs: number }]>(session, "bootRejected");
    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [, firstBootId] = await queue.next();
    serverSocket.send(JSON.stringify([3, firstBootId, { status: "Rejected", interval: 0.05 }]));

    const [{ retryInMs }] = await bootRejectedPromise;
    expect(retryInMs).toBe(50);
    expect(session.getBootStatus()).toBe("rejected");

    const [, , retryAction] = await queue.next();
    expect(retryAction).toBe("BootNotification");
  });

  it("sends independent StatusNotifications per connector when status changes", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    session = createSession(client);

    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [, bootMessageId] = await queue.next();
    serverSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 0.05 }]));

    // Drain the two initial StatusNotifications sent on acceptance.
    await queue.next();
    await queue.next();

    const changedPromise = waitForEvent(session, "connectorStatusChanged");
    session.setConnectorStatus(1, "Charging");
    const [changedInfo] = await changedPromise;
    expect(changedInfo).toMatchObject({ connectorId: 1, status: "Charging" });

    const [, , plugAAction, plugAPayload] = await queue.next();
    expect(plugAAction).toBe("StatusNotification");
    expect(plugAPayload).toMatchObject({ connectorId: 1, status: "Charging" });

    session.setConnectorStatus(2, "Preparing");
    const [, , plugBAction, plugBPayload] = await queue.next();
    expect(plugBAction).toBe("StatusNotification");
    expect(plugBPayload).toMatchObject({ connectorId: 2, status: "Preparing" });

    // Each connector's status is tracked independently.
    expect(session.getConnectorStatus(1)).toMatchObject({ connectorId: 1, status: "Charging" });
    expect(session.getConnectorStatus(2)).toMatchObject({ connectorId: 2, status: "Preparing" });
  });
});
