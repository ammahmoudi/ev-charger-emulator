import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { OcppCallError, OcppClient, OcppConnectionClosedError, OcppTimeoutError } from "../index";
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

describe("OcppClient", () => {
  let server: MockCsmsServer;
  let client: OcppClient;

  beforeEach(async () => {
    server = await MockCsmsServer.start();
  });

  afterEach(async () => {
    client?.disconnect();
    await server.close();
  });

  it("connects and negotiates the ocpp1.6 subprotocol", async () => {
    client = new OcppClient({ url: server.url });
    const connectedPromise = waitForEvent(client, "connected");
    client.connect();
    await connectedPromise;

    expect(client.getState()).toBe("connected");
    const serverSocket = await server.waitForConnection();
    expect(serverSocket.protocol).toBe("ocpp1.6");
  });

  it("sends a correctly framed CALL and resolves the promise on CALLRESULT", async () => {
    client = new OcppClient({ url: server.url });
    client.connect();
    await waitForEvent(client, "connected");
    const serverSocket = await server.waitForConnection();

    const received = waitForEvent<[Buffer]>(serverSocket as unknown as MinimalEmitter, "message");
    const callPromise = client.call("BootNotification", { chargePointVendor: "Acme" });

    const [raw] = await received;
    const [typeId, messageId, action, payload] = JSON.parse(raw.toString());
    expect(typeId).toBe(2);
    expect(typeof messageId).toBe("string");
    expect(action).toBe("BootNotification");
    expect(payload).toEqual({ chargePointVendor: "Acme" });

    serverSocket.send(JSON.stringify([3, messageId, { status: "Accepted" }]));

    await expect(callPromise).resolves.toEqual({ status: "Accepted" });
  });

  it("rejects the call promise with OcppCallError on CALLERROR", async () => {
    client = new OcppClient({ url: server.url });
    client.connect();
    await waitForEvent(client, "connected");
    const serverSocket = await server.waitForConnection();

    serverSocket.once("message", (raw) => {
      const [, messageId] = JSON.parse(raw.toString());
      serverSocket.send(JSON.stringify([4, messageId, "NotSupported", "unsupported action", {}]));
    });

    await expect(client.call("Foo")).rejects.toMatchObject({
      name: "OcppCallError",
      errorCode: "NotSupported",
    });
  });

  it("times out a call that receives no response within the given timeout", async () => {
    client = new OcppClient({ url: server.url });
    client.connect();
    await waitForEvent(client, "connected");
    await server.waitForConnection();

    await expect(client.call("Heartbeat", {}, 50)).rejects.toBeInstanceOf(OcppTimeoutError);
  });

  it("dispatches an incoming CALL to a registered handler and replies with a CALLRESULT", async () => {
    client = new OcppClient({ url: server.url });
    client.registerHandler("Reset", async (payload) => {
      expect(payload).toEqual({ type: "Hard" });
      return { status: "Accepted" };
    });
    client.connect();
    await waitForEvent(client, "connected");
    const serverSocket = await server.waitForConnection();

    const responsePromise = waitForEvent<[Buffer]>(serverSocket as unknown as MinimalEmitter, "message");
    serverSocket.send(JSON.stringify([2, "msg-1", "Reset", { type: "Hard" }]));

    const [raw] = await responsePromise;
    expect(JSON.parse(raw.toString())).toEqual([3, "msg-1", { status: "Accepted" }]);
  });

  it("responds with CALLERROR NotImplemented when no handler is registered for the action", async () => {
    client = new OcppClient({ url: server.url });
    client.connect();
    await waitForEvent(client, "connected");
    const serverSocket = await server.waitForConnection();

    const responsePromise = waitForEvent<[Buffer]>(serverSocket as unknown as MinimalEmitter, "message");
    serverSocket.send(JSON.stringify([2, "msg-2", "UnknownAction", {}]));

    const [raw] = await responsePromise;
    const [typeId, messageId, errorCode] = JSON.parse(raw.toString());
    expect(typeId).toBe(4);
    expect(messageId).toBe("msg-2");
    expect(errorCode).toBe("NotImplemented");
  });

  it("turns a handler-thrown OcppCallError into the matching CALLERROR frame", async () => {
    client = new OcppClient({ url: server.url });
    client.registerHandler("RemoteStartTransaction", async () => {
      throw new OcppCallError("PropertyConstraintViolation", "idTag missing");
    });
    client.connect();
    await waitForEvent(client, "connected");
    const serverSocket = await server.waitForConnection();

    const responsePromise = waitForEvent<[Buffer]>(serverSocket as unknown as MinimalEmitter, "message");
    serverSocket.send(JSON.stringify([2, "msg-3", "RemoteStartTransaction", {}]));

    const [raw] = await responsePromise;
    expect(JSON.parse(raw.toString())).toEqual([
      4,
      "msg-3",
      "PropertyConstraintViolation",
      "idTag missing",
      {},
    ]);
  });

  it("rejects pending calls with OcppConnectionClosedError when the connection drops", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    client.connect();
    await waitForEvent(client, "connected");
    const serverSocket = await server.waitForConnection();

    const callPromise = client.call("Heartbeat");
    serverSocket.terminate();

    await expect(callPromise).rejects.toBeInstanceOf(OcppConnectionClosedError);
  });

  it("does not reconnect after an explicit disconnect", async () => {
    client = new OcppClient({ url: server.url });
    client.connect();
    await waitForEvent(client, "connected");

    const disconnectedPromise = waitForEvent<[{ wasClean: boolean }]>(client, "disconnected");
    client.disconnect();
    const [info] = await disconnectedPromise;
    expect(info.wasClean).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(client.getState()).toBe("disconnected");
  });

  it("automatically reconnects after an unexpected disconnect", async () => {
    client = new OcppClient({ url: server.url, reconnect: { initialDelayMs: 20, factor: 1 } });
    client.connect();
    await waitForEvent(client, "connected");
    const firstSocket = await server.waitForConnection();

    const disconnectedPromise = waitForEvent<[{ wasClean: boolean }]>(client, "disconnected");
    const reconnectedPromise = waitForEvent(client, "connected");
    firstSocket.terminate();

    const [info] = await disconnectedPromise;
    expect(info.wasClean).toBe(false);
    await reconnectedPromise;

    expect(client.getState()).toBe("connected");
  });

  it("emits an error and does not stay connected when the server refuses the subprotocol", async () => {
    await server.close();
    server = await MockCsmsServer.start({ acceptSubprotocol: false });
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });

    const errorPromise = waitForEvent<[Error]>(client, "error");
    client.connect();
    const [err] = await errorPromise;

    expect(err.message).toMatch(/subprotocol/i);
    await waitForEvent(client, "disconnected");
    expect(client.getState()).toBe("disconnected");
  });
});
