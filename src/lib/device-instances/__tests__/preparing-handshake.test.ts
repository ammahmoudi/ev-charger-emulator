import { afterEach, describe, expect, it, vi } from "vitest";
import { connectEv, listConnectorStates, startChargingSession, stopChargingSession } from "../connector-sessions";
import { presentRfidCard } from "../rfid";
import { disposeDeviceInstance, startDeviceInstance } from "../runtime";
import { MockCsmsServer } from "@/lib/ocpp/__tests__/mock-csms-server";
import { createTestModelAndInstance, deleteTestDeviceModel } from "./test-helpers";
import { prisma } from "@/lib/prisma";

describe.skipIf(!process.env.DATABASE_URL)("Preparing handshake regression", () => {
  let instanceId: string;
  let modelId: string;
  let server: MockCsmsServer | undefined;
  afterEach(async () => {
    vi.useRealTimers();
    if (instanceId) disposeDeviceInstance(instanceId);
    if (modelId) await deleteTestDeviceModel(modelId);
    await server?.close();
    server = undefined;
  });
  async function setup() {
    const created = await createTestModelAndInstance(server ? { csmsUrl: server.url } : {});
    instanceId = created.instance.id;
    modelId = created.deviceModel.id;
  }
  async function connector() {
    return (await listConnectorStates(instanceId))[0];
  }
  async function expire() {
    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
      data: { preparingSince: new Date(Date.now() - 60_001) },
    });
    return connector();
  }
  it.each(["card", "EV"])("expires an incomplete %s-first attempt with no transaction or energy", async (first) => {
    await setup();
    if (first === "card") await presentRfidCard(instanceId, 1, "MASTER-TEST", 20);
    else await connectEv(instanceId, 1);
    expect((await connector()).status).toBe("Preparing");
    const idle = await expire();
    expect(idle.status).toBe("Available");
    expect(idle.activeSession).toBeNull();
    expect(idle.locked).toBe(false);
    expect(idle.evConnected).toBe(first === "EV");
    expect(await prisma.deviceInstanceSession.count({ where: { deviceInstanceId: instanceId } })).toBe(0);
    if (first === "card") {
      expect((await connectEv(instanceId, 1)).activeSession).toBeNull();
    } else {
      expect((await presentRfidCard(instanceId, 1, "MASTER-TEST", 20)).status).toBe("Charging");
    }
  });
  it("accepts the second action just before the deadline and starts the energy clock there", async () => {
    await setup();
    await presentRfidCard(instanceId, 1, "MASTER-TEST", 20);
    await prisma.deviceInstanceConnectorState.update({
      where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
      data: { preparingSince: new Date(Date.now() - 59_000), activeStartedAt: new Date(Date.now() - 59_000) },
    });
    const charged = await connectEv(instanceId, 1);
    expect(charged.status).toBe("Charging");
    expect(charged.activeSession!.currentEnergyWh).toBeLessThan(10);
  });
  it("runs expiry without screen polling", async () => {
    await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await startChargingSession(instanceId, 1, { idTag: "CARD", chargeRateKw: 20 });
    await vi.advanceTimersByTimeAsync(60_100);
    await expect.poll(async () => (await prisma.deviceInstanceConnectorState.findFirst({ where: { deviceInstanceId: instanceId } }))?.status).toBe("Available");
  });
  it("rejects simultaneous duplicate authorizations", async () => {
    await setup();
    const results = await Promise.allSettled([
      startChargingSession(instanceId, 1, { idTag: "ONE", chargeRateKw: 20 }),
      startChargingSession(instanceId, 1, { idTag: "TWO", chargeRateKw: 20 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it.each(["remote", "EV"])("supports %s-first remote start and remote stop over OCPP", async (first) => {
    server = await MockCsmsServer.start();
    await setup();
    await startDeviceInstance(instanceId);
    const ws = await server.waitForConnection();
    const frames: unknown[][] = [];
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as unknown[];
      frames.push(frame);
      if (frame[0] === 2) {
        const response = frame[2] === "StartTransaction" ? { transactionId: 456, idTagInfo: { status: "Accepted" } } : {};
        ws.send(JSON.stringify([3, frame[1], response]));
      }
    });
    if (first === "EV") await connectEv(instanceId, 1);
    ws.send(JSON.stringify([2, "remote-start", "RemoteStartTransaction", { connectorId: 1, idTag: "REMOTE" }]));
    await expect.poll(() => frames.find((f) => f[0] === 3 && f[1] === "remote-start")?.[2]).toEqual({ status: "Accepted" });
    if (first === "remote") {
      await expect.poll(async () => (await connector()).status).toBe("Preparing");
      expect(frames.filter((f) => f[2] === "StartTransaction")).toHaveLength(0);
      await connectEv(instanceId, 1);
    }
    await expect.poll(async () => (await connector()).status).toBe("Charging");
    expect(frames.filter((f) => f[2] === "StartTransaction")).toHaveLength(1);
    expect((await connector()).activeSession?.transactionId).toBe(456);
    ws.send(JSON.stringify([2, "remote-stop", "RemoteStopTransaction", { transactionId: 456 }]));
    await expect.poll(() => frames.find((f) => f[0] === 3 && f[1] === "remote-stop")?.[2]).toEqual({ status: "Accepted" });
    await expect.poll(async () => (await connector()).activeSession).toBeNull();
    expect(frames.filter((f) => f[2] === "StopTransaction")).toHaveLength(1);
    expect(await prisma.deviceInstanceSession.count({ where: { deviceInstanceId: instanceId } })).toBe(1);
  });
  it("expires a remote-first attempt without sending StartTransaction", async () => {
    server = await MockCsmsServer.start();
    await setup();
    await startDeviceInstance(instanceId);
    const ws = await server.waitForConnection();
    const frames: unknown[][] = [];
    ws.on("message", (data) => frames.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify([2, "start-timeout", "RemoteStartTransaction", { connectorId: 1, idTag: "REMOTE" }]));
    await expect.poll(async () => (await connector()).activeSession?.idTag).toBe("REMOTE");
    expect((await expire()).status).toBe("Available");
    await connectEv(instanceId, 1);
    expect((await connector()).activeSession).toBeNull();
    expect(frames.filter((f) => f[2] === "StartTransaction")).toHaveLength(0);
  });
  it("authorizes an online card before the EV and sends StartTransaction only after plug-in", async () => {
    server = await MockCsmsServer.start();
    await setup();
    await startDeviceInstance(instanceId);
    const ws = await server.waitForConnection();
    const frames: unknown[][] = [];
    ws.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as unknown[];
      frames.push(frame);
      if (frame[0] === 2) ws.send(JSON.stringify([3, frame[1], {
        idTagInfo: { status: "Accepted" }, ...(frame[2] === "StartTransaction" ? { transactionId: 789 } : {}),
      }]));
    });
    const preparing = await presentRfidCard(instanceId, 1, "ONLINE", 20);
    expect(preparing.status).toBe("Preparing");
    expect(frames.filter((f) => f[2] === "Authorize")).toHaveLength(1);
    expect(frames.filter((f) => f[2] === "StartTransaction")).toHaveLength(0);
    expect((await connectEv(instanceId, 1)).activeSession?.transactionId).toBe(789);
    expect(frames.filter((f) => f[2] === "StartTransaction")).toHaveLength(1);
  });
  it("cancels card-first Preparing without sending a transaction", async () => {
    await setup();
    await presentRfidCard(instanceId, 1, "MASTER-TEST", 20);
    const stopped = await stopChargingSession(instanceId, 1, { stopCause: "Local" });
    expect(stopped.transactionId).toBeNull();
    expect(stopped.energyKwh).toBe(0);
    expect((await connector()).status).toBe("Available");
  });
});
