import { describe, expect, it } from "vitest";

import { bumpFirmwareVersion } from "../maintenance";

describe("bumpFirmwareVersion", () => {
  it("increments the trailing numeric segment", () => {
    expect(bumpFirmwareVersion("1.0.0")).toBe("1.0.1");
    expect(bumpFirmwareVersion("1.0.9")).toBe("1.0.10");
    expect(bumpFirmwareVersion("2.3")).toBe("2.4");
  });

  it("appends .1 when the version has no trailing numeric segment", () => {
    expect(bumpFirmwareVersion("v-alpha")).toBe("v-alpha.1");
  });
});
