import { describe, expect, it } from "vitest";

import { FAULT_STOP_CAUSES, isFaultStopCause, NORMAL_STOP_CAUSES, STOP_CAUSE_OPTIONS } from "../stop-causes";

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
