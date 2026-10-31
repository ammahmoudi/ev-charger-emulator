import { afterEach, describe, expect, it } from "vitest";
import type { WebSocket } from "ws";
import { MockCsmsServer } from "@/lib/ocpp/__tests__/mock-csms-server";
import { prisma } from "@/lib/prisma";
import { createTestModelAndInstance, deleteTestDeviceModel } from "./test-helpers";
import { connectEv, listConnectorStates, startChargingSession, stopChargingSession } from "../connector-sessions";
import { disposeDeviceInstance, startDeviceInstance } from "../runtime";
import { PrismaConfigurationStore } from "../prisma-configuration-store";

describe.skipIf(!process.env.DATABASE_URL)("configuration and status on the real OCPP wire", () => {
  let server: MockCsmsServer;
  let ws: WebSocket;
  let instanceId: string;
  let modelId: string;
  let frames: unknown[][];
  let deferStart = false;
  let counter = 0;
  afterEach(async () => {
    if (instanceId) disposeDeviceInstance(instanceId);
    await server?.close();
    if (modelId) await deleteTestDeviceModel(modelId);
  });
  async function setup(beforeBoot?: () => Promise<void>) {
    frames = []; deferStart = false;
    server = await MockCsmsServer.start();
    const created = await createTestModelAndInstance({ csmsUrl: server.url });
    instanceId = created.instance.id; modelId = created.deviceModel.id;
    await beforeBoot?.();
    await startDeviceInstance(instanceId);
    ws = await server.waitForConnection();
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString()) as unknown[];
      frames.push(frame);
      if (frame[0] !== 2 || (deferStart && frame[2] === "StartTransaction")) return;
      const response = frame[2] === "BootNotification" ? { status: "Accepted", interval: 30, currentTime: new Date().toISOString() }
        : frame[2] === "Authorize" ? { idTagInfo: { status: "Accepted" } }
        : frame[2] === "StartTransaction" ? { transactionId: 901, idTagInfo: { status: "Accepted" } } : {};
      ws.send(JSON.stringify([3, frame[1], response]));
    });
    await expect.poll(async () => (await prisma.deviceInstance.findUniqueOrThrow({ where: { id: instanceId } })).status).toBe("CONNECTED");
    await expect.poll(() => frames.filter((f) => f[2] === "StatusNotification").length).toBeGreaterThanOrEqual(2);
  }
  async function command(action: string, payload: object) {
    const id = `test-${++counter}`;
    ws.send(JSON.stringify([2, id, action, payload]));
    await expect.poll(() => frames.find((f) => f[1] === id)).toBeDefined();
    const result = frames.find((f) => f[1] === id)!;
    expect(result[0]).toBe(3);
    return result[2] as { status?: string; configurationKey?: { key: string; value: string; readonly: boolean }[]; unknownKey?: string[] };
  }
  const statuses = () => frames.filter((f) => f[2] === "StatusNotification").map((f) => f[3] as { connectorId: number; status: string });
  it("returns values for empty-key/all, selected, and unknown queries, including readonly keys", async () => {
    await setup();
    const omitted = await command("GetConfiguration", {});
    const empty = await command("GetConfiguration", { key: [] });
    expect(empty.configurationKey).toEqual(omitted.configurationKey);
    expect(empty.configurationKey).toContainEqual({ key: "NumberOfConnectors", value: "2", readonly: true });
    const selected = await command("GetConfiguration", { key: ["HeartbeatInterval", "missing"] });
    expect(selected.configurationKey).toHaveLength(1);
    expect(selected.unknownKey).toEqual(["missing"]);
    expect(await command("ChangeConfiguration", { key: "NumberOfConnectors", value: "9" })).toEqual({ status: "Rejected" });
    expect(await command("ChangeConfiguration", { key: "missing", value: "9" })).toEqual({ status: "NotSupported" });
  });
  it("persists standard keys, validates values, and applies HeartbeatInterval to the running loop", async () => {
    await setup();
    expect(await command("ChangeConfiguration", { key: "HeartbeatInterval", value: "1" })).toEqual({ status: "Accepted" });
    expect((await new PrismaConfigurationStore(instanceId).list(["HeartbeatInterval"])).known[0].value).toBe("1");
    await expect.poll(() => frames.some((f) => f[2] === "Heartbeat"), { timeout: 2500 }).toBe(true);
    expect(await command("ChangeConfiguration", { key: "HeartbeatInterval", value: "-1" })).toEqual({ status: "Rejected" });
    expect((await command("GetConfiguration", { key: ["HeartbeatInterval"] })).configurationKey?.[0].value).toBe("1");
  });
  it("maps real QR vendor names to HMI values, even when an instance row has not been seeded", async () => {
    await setup();
    await prisma.deviceModelParameter.create({ data: { deviceModelId: modelId, key: "qrCodeUrl1", label: "QR 1", category: "OTHER", valueType: "STRING", defaultValue: "DEFAULT-QR", sortOrder: 99 } });
    expect(await command("ChangeConfiguration", { key: "QRcodeConnectID1", value: "https://example.com/demo" })).toEqual({ status: "Accepted" });
    const result = await command("GetConfiguration", { key: ["QRcodeConnectID1", "qrCodeUrl1"] });
    expect(result.configurationKey?.map((e) => e.value)).toEqual(["https://example.com/demo", "https://example.com/demo"]);
    expect(await prisma.deviceInstanceParameter.findFirst({ where: { deviceInstanceId: instanceId, key: "qrCodeUrl1" } })).toMatchObject({ value: "https://example.com/demo" });
    await command("ChangeConfiguration", { key: "QRcodeConnectID1", value: "" });
    expect((await command("GetConfiguration", { key: ["QRcodeConnectID1"] })).configurationKey?.[0].value).toBe("");
  });
  it("keeps a plugged EV Preparing beyond ConnectionTimeOut without inventing a transaction", async () => {
    await setup();
    await command("ChangeConfiguration", { key: "ConnectionTimeOut", value: "1" });
    await connectEv(instanceId, 1);
    await expect.poll(() => statuses().some((s) => s.connectorId === 1 && s.status === "Preparing")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(statuses().filter((s) => s.connectorId === 1).at(-1)?.status).toBe("Preparing");
    expect(frames.some((f) => f[2] === "StartTransaction")).toBe(false);
  });
  it("reports persisted Preparing on boot instead of a false Available status", async () => {
    await setup(async () => {
      await connectEv(instanceId, 1);
      disposeDeviceInstance(instanceId);
    });
    expect(statuses().find((s) => s.connectorId === 1)?.status).toBe("Preparing");
  });
  it("keeps local charging in Preparing until StartTransaction is accepted", async () => {
    await setup();
    await connectEv(instanceId, 1);
    deferStart = true;
    const start = startChargingSession(instanceId, 1, { idTag: "MASTER-TEST", chargeRateKw: 20 });
    await expect.poll(() => frames.some((f) => f[2] === "StartTransaction")).toBe(true);
    expect((await listConnectorStates(instanceId))[0]).toMatchObject({ status: "Preparing", activeSession: { currentEnergyWh: 0, transactionId: null } });
    expect(statuses().some((s) => s.status === "Charging")).toBe(false);
    const request = frames.find((f) => f[2] === "StartTransaction")!;
    ws.send(JSON.stringify([3, request[1], { transactionId: 902, idTagInfo: { status: "Accepted" } }]));
    expect((await start).status).toBe("Charging");
    await expect.poll(() => statuses().at(-1)?.status).toBe("Charging");
  });
  it("does not revive a cancelled pending start when the CSMS accepts it later", async () => {
    await setup(); await connectEv(instanceId, 1); deferStart = true;
    const start = startChargingSession(instanceId, 1, { idTag: "MASTER-TEST", chargeRateKw: 20 });
    await expect.poll(() => frames.some((f) => f[2] === "StartTransaction")).toBe(true);
    await stopChargingSession(instanceId, 1, { stopCause: "Local" });
    const request = frames.find((f) => f[2] === "StartTransaction")!;
    ws.send(JSON.stringify([3, request[1], { transactionId: 903, idTagInfo: { status: "Accepted" } }]));
    expect((await start).status).not.toBe("Charging");
    await expect.poll(() => frames.some((f) => f[2] === "StopTransaction" && (f[3] as { transactionId: number }).transactionId === 903)).toBe(true);
    expect(statuses().some((s) => s.status === "Charging")).toBe(false);
  });
  it("orders remote acceptance, authorization, start and Charging, without duplicate Preparing notifications", async () => {
    await setup(); await connectEv(instanceId, 1);
    expect(await command("RemoteStartTransaction", { connectorId: 1, idTag: "REMOTE" })).toEqual({ status: "Accepted" });
    await expect.poll(() => statuses().some((entry) => entry.status === "Charging")).toBe(true);
    const authIndex = frames.findIndex((f) => f[2] === "Authorize");
    const startIndex = frames.findIndex((f) => f[2] === "StartTransaction");
    const chargingIndex = frames.findIndex((f) => f[2] === "StatusNotification" && (f[3] as { status: string }).status === "Charging");
    expect(authIndex).toBeGreaterThan(-1);
    expect(startIndex).toBeGreaterThan(authIndex);
    expect(chargingIndex).toBeGreaterThan(startIndex);
    expect(statuses().filter((entry) => entry.connectorId === 1 && entry.status === "Preparing")).toHaveLength(1);
  });
  it("does not report Charging or create a local transaction event when StartTransaction is declined", async () => {
    await setup(); await connectEv(instanceId, 1); deferStart = true;
    const start = startChargingSession(instanceId, 1, { idTag: "MASTER-TEST", chargeRateKw: 20 });
    await expect.poll(() => frames.some((f) => f[2] === "StartTransaction")).toBe(true);
    const request = frames.find((f) => f[2] === "StartTransaction")!;
    ws.send(JSON.stringify([3, request[1], { transactionId: 904, idTagInfo: { status: "Blocked" } }]));
    expect((await start).status).toBe("Preparing");
    expect(statuses().some((entry) => entry.status === "Charging")).toBe(false);
    expect(await prisma.deviceInstanceEvent.count({ where: { deviceInstanceId: instanceId, type: "TRANSACTION_STARTED" } })).toBe(0);
  });
  it("expires persisted old Preparing before the initial boot status sweep", async () => {
    await setup(async () => {
      await connectEv(instanceId, 1);
      await prisma.deviceInstanceConnectorState.update({
        where: { deviceInstanceId_connectorId: { deviceInstanceId: instanceId, connectorId: 1 } },
        data: { preparingSince: new Date(Date.now() - 61_000) },
      });
      disposeDeviceInstance(instanceId);
    });
    expect(statuses().find((entry) => entry.connectorId === 1)?.status).toBe("Available");
  });
  it("changes and disables remote metering on the active transaction", async () => {
    await setup(); await connectEv(instanceId, 1);
    await command("ChangeConfiguration", { key: "MeterValueSampleInterval", value: "1" });
    await command("RemoteStartTransaction", { connectorId: 1, idTag: "REMOTE" });
    await expect.poll(() => frames.filter((f) => f[2] === "MeterValues").length, { timeout: 2500 }).toBeGreaterThan(0);
    await command("ChangeConfiguration", { key: "MeterValueSampleInterval", value: "0" });
    const count = frames.filter((f) => f[2] === "MeterValues").length;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect(frames.filter((f) => f[2] === "MeterValues")).toHaveLength(count);
  });

  it("rejects malformed and over-limit selected-key requests instead of silently returning everything", async () => {
    await setup();
    for (const [id, key, error] of [
      ["bad-type", "HeartbeatInterval", "TypeConstraintViolation"],
      ["too-many", Array.from({ length: 11 }, (_, i) => `key-${i}`), "OccurenceConstraintViolation"],
    ] as const) {
      ws.send(JSON.stringify([2, id, "GetConfiguration", { key }]));
      await expect.poll(() => frames.find((frame) => frame[1] === id)).toEqual([4, id, error, expect.any(String), expect.any(Object)]);
    }
  });

});
