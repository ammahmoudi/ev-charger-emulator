import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ findMany: vi.fn(), delete: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { deviceInstanceOutboxMessage: db } }));
vi.mock("@/lib/device-instances/events", () => ({ logDeviceInstanceEvent: vi.fn() }));

import { drainOutbox } from "../outbox";

describe("retained physical stop delivery", () => {
  const original = { transactionId: 2, meterStop: 23291,
    timestamp: "2026-10-25T18:42:35.660Z", reason: "Manu. Stop" };
  beforeEach(() => {
    vi.resetAllMocks();
    db.findMany.mockResolvedValue([
      { id: "actual-stop", action: "StopTransaction", payload: original,
        attempts: 0, lastError: null, createdAt: new Date(original.timestamp) },
      { id: "later", action: "MeterValues", payload: { reason: "untouched" },
        attempts: 0, lastError: null, createdAt: new Date(original.timestamp) },
    ]);
  });

  it("sends the retained meter/time with a valid reason and removes only acknowledged rows", async () => {
    const sender = vi.fn().mockResolvedValue({});
    expect(await drainOutbox("device", sender)).toBe(2);
    expect(sender).toHaveBeenNthCalledWith(1, "StopTransaction", { ...original, reason: "Local" });
    expect(sender).toHaveBeenNthCalledWith(2, "MeterValues", { reason: "untouched" });
    expect(db.delete).toHaveBeenNthCalledWith(1, { where: { id: "actual-stop" } });
    expect(db.update).not.toHaveBeenCalled();
    expect(original.reason).toBe("Manu. Stop");
  });

  it("keeps a rejected stop durable and does not send later messages out of order", async () => {
    const sender = vi.fn().mockRejectedValue(new Error("FormatViolation"));
    expect(await drainOutbox("device", sender)).toBe(0);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(db.delete).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledWith({ where: { id: "actual-stop" },
      data: { attempts: { increment: 1 }, lastError: "FormatViolation" } });
  });
});
