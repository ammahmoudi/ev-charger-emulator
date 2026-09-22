import { afterEach, describe, expect, it } from "vitest";

import { PATCH } from "../route";
import { prisma } from "@/lib/prisma";
import {
  createTestModelAndInstance,
  deleteTestDeviceModel,
  type TestDeviceModel,
} from "@/lib/device-instances/__tests__/test-helpers";

/** Builds a PATCH request the same shape the Settings screen's "Save" button sends. */
function patchRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/device-instances/test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Covers the AUDIT-ui.md #1 fix: changing an instance's csmsUrl tears down its runtime client
 * (`disposeDeviceInstance`), which closes the socket without itself writing `DeviceInstance.status`
 * — so without the route also resetting status, the Settings screen's Save would leave the Home
 * header showing CONNECTED/CONNECTING against a connection that had actually been torn down.
 */
describe.skipIf(!process.env.DATABASE_URL)("PATCH /api/device-instances/[id] — csmsUrl change resets stale status", () => {
  let deviceModel: TestDeviceModel;
  let instanceId: string;

  afterEach(async () => {
    if (deviceModel) await deleteTestDeviceModel(deviceModel.id);
  });

  it("resets a CONNECTED instance to DISCONNECTED with a reason when csmsUrl changes", async () => {
    const created = await createTestModelAndInstance({ csmsUrl: "ws://old-host/cp" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    await prisma.deviceInstance.update({ where: { id: instanceId }, data: { status: "CONNECTED" } });

    const res = await PATCH(patchRequest({ csmsUrl: "ws://new-host/cp" }), { params: Promise.resolve({ id: instanceId }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.instance.status).toBe("DISCONNECTED");
    expect(data.instance.statusReason).toMatch(/csms url changed/i);
    expect(data.instance.csmsUrl).toBe("ws://new-host/cp");
  });

  it("resets a CONNECTING instance to DISCONNECTED when csmsUrl changes", async () => {
    const created = await createTestModelAndInstance({ csmsUrl: "ws://old-host/cp" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    await prisma.deviceInstance.update({ where: { id: instanceId }, data: { status: "CONNECTING" } });

    const res = await PATCH(patchRequest({ csmsUrl: "ws://new-host/cp" }), { params: Promise.resolve({ id: instanceId }) });
    const data = await res.json();
    expect(data.instance.status).toBe("DISCONNECTED");
  });

  it("leaves status untouched when csmsUrl is submitted unchanged", async () => {
    const created = await createTestModelAndInstance({ csmsUrl: "ws://same-host/cp" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    await prisma.deviceInstance.update({ where: { id: instanceId }, data: { status: "CONNECTED", statusReason: null } });

    const res = await PATCH(patchRequest({ csmsUrl: "ws://same-host/cp" }), { params: Promise.resolve({ id: instanceId }) });
    const data = await res.json();
    expect(data.instance.status).toBe("CONNECTED");
    expect(data.instance.statusReason).toBeNull();
  });

  it("leaves status untouched when csmsUrl changes on an already-DISCONNECTED instance", async () => {
    const created = await createTestModelAndInstance({ csmsUrl: "ws://old-host/cp" });
    deviceModel = created.deviceModel;
    instanceId = created.instance.id;
    // createTestInstance already defaults to DISCONNECTED — no setup needed.

    const res = await PATCH(patchRequest({ csmsUrl: "ws://new-host/cp" }), { params: Promise.resolve({ id: instanceId }) });
    const data = await res.json();
    expect(data.instance.status).toBe("DISCONNECTED");
    expect(data.instance.statusReason).toBeNull();
  });
});
