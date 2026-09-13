import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import { OcppChargePointSession, OcppClient } from "../../ocpp/index";
import { MockCsmsServer } from "../../ocpp/__tests__/mock-csms-server";
import { SimulatedChargingSession } from "../charging-session";

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

type WireMessage = [number, string, string, Record<string, unknown>];

/**
 * Buffers every message frame the server socket receives from the moment it's created,
 * so sequentially-awaited `next()` calls can't drop a frame that arrives before the next
 * `next()` call attaches its listener (frames can arrive back-to-back within a tick).
 */
function createMessageQueue(serverSocket: WebSocket) {
  const buffered: WireMessage[] = [];
  const waiters: Array<(msg: WireMessage) => void> = [];

  serverSocket.on("message", (data) => {
    const parsed = JSON.parse((data as Buffer).toString()) as WireMessage;
    const waiter = waiters.shift();
    if (waiter) {
      waiter(parsed);
    } else {
      buffered.push(parsed);
    }
  });

  return {
    next(): Promise<WireMessage> {
      const queued = buffered.shift();
      if (queued) return Promise.resolve(queued);
      return new Promise((resolve) => waiters.push(resolve));
    },
    /**
     * Drains frames, generically ack'ing (empty CALLRESULT) any whose action isn't
     * `expectedAction`, until one matching it arrives. Used around the periodic
     * MeterValues loop, whose tick count relative to other calls isn't deterministic
     * in wall-clock-timed tests.
     */
    async nextOfAction(expectedAction: string): Promise<WireMessage> {
      for (;;) {
        const message = await this.next();
        const [, messageId, action] = message;
        if (action === expectedAction) return message;
        serverSocket.send(JSON.stringify([3, messageId, {}]));
      }
    },
  };
}

const IDENTITY = { chargePointVendor: "Acme", chargePointModel: "X1" };
const CONNECTORS = [
  { connectorId: 1, label: "Plug A" },
  { connectorId: 2, label: "Plug B" },
];
const ID_TAG = "SIMULATED-TAG";

function createChargePointSession(client: OcppClient): OcppChargePointSession {
  const session = new OcppChargePointSession(client, { identity: IDENTITY, connectors: CONNECTORS });
  session.on("error", () => {});
  return session;
}

function createChargingSession(
  client: OcppClient,
  chargePointSession: OcppChargePointSession,
  overrides: Partial<{ connectorId: number; chargeRateKw: number; meterValueIntervalMs: number; meterStartWh: number }> = {},
): SimulatedChargingSession {
  const chargingSession = new SimulatedChargingSession(client, chargePointSession, {
    connectorId: overrides.connectorId ?? 1,
    idTag: ID_TAG,
    chargeRateKw: overrides.chargeRateKw ?? 7.2,
    meterValueIntervalMs: overrides.meterValueIntervalMs ?? 30,
    meterStartWh: overrides.meterStartWh ?? 0,
  });
  chargingSession.on("error", () => {});
  return chargingSession;
}

describe("SimulatedChargingSession", () => {
  let server: MockCsmsServer;
  let client: OcppClient;
  let chargePointSession: OcppChargePointSession;
  let chargingSession: SimulatedChargingSession;

  beforeEach(async () => {
    server = await MockCsmsServer.start();
  });

  afterEach(async () => {
    chargingSession?.dispose();
    chargePointSession?.dispose();
    client?.disconnect();
    await server.close();
  });

  it("runs Authorize -> StartTransaction -> periodic MeterValues -> StopTransaction with increasing energy readings", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    chargePointSession = createChargePointSession(client);
    chargingSession = createChargingSession(client, chargePointSession);

    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const bootAcceptedPromise = waitForEvent(chargePointSession, "bootAccepted");
    const [, bootMessageId] = await queue.next();
    serverSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 3600 }]));
    await bootAcceptedPromise;

    // Drain the two initial StatusNotifications sent on boot acceptance.
    await queue.next();
    await queue.next();

    const plugInPromise = chargingSession.plugIn();

    const [, , preparingAction, preparingPayload] = await queue.next();
    expect(preparingAction).toBe("StatusNotification");
    expect(preparingPayload).toMatchObject({ connectorId: 1, status: "Preparing" });

    const [, authMessageId, authAction, authPayload] = await queue.next();
    expect(authAction).toBe("Authorize");
    expect(authPayload).toEqual({ idTag: ID_TAG });
    serverSocket.send(JSON.stringify([3, authMessageId, { idTagInfo: { status: "Accepted" } }]));

    const [, startMessageId, startAction, startPayload] = await queue.next();
    expect(startAction).toBe("StartTransaction");
    expect(startPayload).toMatchObject({ connectorId: 1, idTag: ID_TAG, meterStart: 0 });
    serverSocket.send(
      JSON.stringify([3, startMessageId, { idTagInfo: { status: "Accepted" }, transactionId: 42 }]),
    );

    const [, , chargingStatusAction, chargingStatusPayload] = await queue.next();
    expect(chargingStatusAction).toBe("StatusNotification");
    expect(chargingStatusPayload).toMatchObject({ connectorId: 1, status: "Charging" });

    await plugInPromise;
    expect(chargingSession.getState()).toBe("charging");
    expect(chargingSession.getTransactionId()).toBe(42);

    const firstMeter = await queue.nextOfAction("MeterValues");
    const [, firstMeterMessageId, , firstMeterPayload] = firstMeter;
    expect(firstMeterPayload).toMatchObject({ connectorId: 1, transactionId: 42 });
    const firstEnergy = Number(
      (firstMeterPayload.meterValue as Array<{ sampledValue: Array<{ value: string }> }>)[0]
        .sampledValue[0].value,
    );
    expect(firstEnergy).toBeGreaterThan(0);
    serverSocket.send(JSON.stringify([3, firstMeterMessageId, {}]));

    const secondMeter = await queue.nextOfAction("MeterValues");
    const [, secondMeterMessageId, , secondMeterPayload] = secondMeter;
    const secondEnergy = Number(
      (secondMeterPayload.meterValue as Array<{ sampledValue: Array<{ value: string }> }>)[0]
        .sampledValue[0].value,
    );
    expect(secondEnergy).toBeGreaterThan(firstEnergy);
    serverSocket.send(JSON.stringify([3, secondMeterMessageId, {}]));

    const stopPromise = chargingSession.stop("Local");

    const stopMessage = await queue.nextOfAction("StopTransaction");
    const [, stopMessageId, , stopPayload] = stopMessage;
    expect(stopPayload).toMatchObject({ transactionId: 42, idTag: ID_TAG, reason: "Local" });
    expect(Number(stopPayload.meterStop)).toBeGreaterThanOrEqual(secondEnergy);
    serverSocket.send(JSON.stringify([3, stopMessageId, { idTagInfo: { status: "Accepted" } }]));

    const finishingMessage = await queue.nextOfAction("StatusNotification");
    const [, , , finishingPayload] = finishingMessage;
    expect(finishingPayload).toMatchObject({ connectorId: 1, status: "Finishing" });

    await stopPromise;
    expect(chargingSession.getState()).toBe("stopped");
    expect(chargingSession.getTransactionId()).toBeNull();
  });

  it("sends the connector straight back to Available on a simulated unplug (EVDisconnected)", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    chargePointSession = createChargePointSession(client);
    chargingSession = createChargingSession(client, chargePointSession, { meterValueIntervalMs: 10_000 });

    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [, bootMessageId] = await queue.next();
    serverSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 3600 }]));
    await queue.next();
    await queue.next();

    const plugInPromise = chargingSession.plugIn();
    await queue.next(); // Preparing StatusNotification

    const [, authMessageId] = await queue.next(); // Authorize
    serverSocket.send(JSON.stringify([3, authMessageId, { idTagInfo: { status: "Accepted" } }]));

    const [, startMessageId] = await queue.next(); // StartTransaction
    serverSocket.send(
      JSON.stringify([3, startMessageId, { idTagInfo: { status: "Accepted" }, transactionId: 7 }]),
    );
    await queue.next(); // Charging StatusNotification
    await plugInPromise;

    const stopPromise = chargingSession.stop("EVDisconnected");
    const [, stopMessageId, , stopPayload] = await queue.next();
    expect(stopPayload).toMatchObject({ transactionId: 7, reason: "EVDisconnected" });
    serverSocket.send(JSON.stringify([3, stopMessageId, {}]));

    const [, , finalStatusAction, finalStatusPayload] = await queue.next();
    expect(finalStatusAction).toBe("StatusNotification");
    expect(finalStatusPayload).toMatchObject({ connectorId: 1, status: "Available" });

    await stopPromise;
    expect(chargingSession.getState()).toBe("stopped");
  });

  it("does not start a transaction when Authorize is denied", async () => {
    client = new OcppClient({ url: server.url, reconnect: { enabled: false } });
    chargePointSession = createChargePointSession(client);
    chargingSession = createChargingSession(client, chargePointSession);

    client.connect();
    const serverSocket = await server.waitForConnection();
    const queue = createMessageQueue(serverSocket);

    const [, bootMessageId] = await queue.next();
    serverSocket.send(JSON.stringify([3, bootMessageId, { status: "Accepted", interval: 3600 }]));
    await queue.next();
    await queue.next();

    const deniedPromise = waitForEvent<[{ idTagStatus: string }]>(chargingSession, "authorizationDenied");
    const plugInPromise = chargingSession.plugIn();
    await queue.next(); // Preparing StatusNotification

    const [, authMessageId, authAction] = await queue.next();
    expect(authAction).toBe("Authorize");
    serverSocket.send(JSON.stringify([3, authMessageId, { idTagInfo: { status: "Invalid" } }]));

    const [{ idTagStatus }] = await deniedPromise;
    expect(idTagStatus).toBe("Invalid");

    const [, , availableAction, availablePayload] = await queue.next();
    expect(availableAction).toBe("StatusNotification");
    expect(availablePayload).toMatchObject({ connectorId: 1, status: "Available" });

    await plugInPromise;
    expect(chargingSession.getState()).toBe("authorizationDenied");
    expect(chargingSession.getTransactionId()).toBeNull();
  });
});
