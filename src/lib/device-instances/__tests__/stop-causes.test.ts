import { describe, expect, it } from "vitest";

import { FAULT_STOP_CAUSES, isFaultStopCause, NORMAL_STOP_CAUSES, STOP_CAUSE_OPTIONS,
  OCPP16_STOP_REASONS, toOcpp16StopReason, normalizeOcpp16StopPayload } from "../stop-causes";

describe("isFaultStopCause", () => {
  it.each(FAULT_STOP_CAUSES)("treats %s as a fault stop cause", (cause) => {
    expect(isFaultStopCause(cause)).toBe(true);
  });

  it.each(NORMAL_STOP_CAUSES)("does not treat %s as a fault stop cause", (cause) => {
    expect(isFaultStopCause(cause)).toBe(false);
  });

  it("does not treat an arbitrary free-text stop cause as a fault", () => {
    expect(isFaultStopCause("Some other reason")).toBe(false);
  });

  it("lists every normal and fault cause exactly once in STOP_CAUSE_OPTIONS", () => {
    expect(STOP_CAUSE_OPTIONS).toHaveLength(NORMAL_STOP_CAUSES.length + FAULT_STOP_CAUSES.length);
    expect(new Set(STOP_CAUSE_OPTIONS).size).toBe(STOP_CAUSE_OPTIONS.length);
  });
});

describe("OCPP 1.6 stop reasons", () => {
  it.each([
    ["Manu. Stop", "Local"], ["Remote Stop", "Remote"],
    ["EV Disconnected", "EVDisconnected"], ["UnlockConnector", "UnlockCommand"],
    ...FAULT_STOP_CAUSES.map((cause) => [cause, "Other"]),
    ["unrecognized device fault", "Other"],
  ])("serializes device label %s as %s", (cause, expected) => {
    expect(toOcpp16StopReason(cause)).toBe(expected);
  });

  it.each(OCPP16_STOP_REASONS)("preserves protocol reason %s", (reason) => {
    expect(toOcpp16StopReason(reason)).toBe(reason);
  });

  it("repairs a retained stop without changing its measured evidence", () => {
    const original = { transactionId: 2, timestamp: "2026-10-25T18:42:35.660Z",
      meterStop: 23291, reason: "Manu. Stop", transactionData: [{ timestamp: "actual" }] };
    expect(normalizeOcpp16StopPayload(original)).toEqual({ ...original, reason: "Local" });
    expect(original.reason).toBe("Manu. Stop");
  });

  it("does not invent an omitted reason", () => {
    const original = { transactionId: 2, meterStop: 23291 };
    expect(normalizeOcpp16StopPayload(original)).toBe(original);
  });
});
