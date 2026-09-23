import { describe, expect, it } from "vitest";

import { buildOutsideInButtons, connectorDisplayLabel, orderConnectorsByEvse } from "../diagnostics-types";

describe("connectorDisplayLabel", () => {
  it("uses the connector's own label when set", () => {
    expect(connectorDisplayLabel({ id: "1", evseIndex: 1, connectorIndex: 1, label: "Plug A" })).toBe("Plug A");
  });

  it("falls back to Plug <evseIndex> when unlabeled", () => {
    expect(connectorDisplayLabel({ id: "1", evseIndex: 2, connectorIndex: 1, label: null })).toBe("Plug 2");
  });
});

describe("orderConnectorsByEvse", () => {
  it("sorts by evseIndex then connectorIndex", () => {
    const connectors = [
      { evseIndex: 2, connectorIndex: 1, id: "b" },
      { evseIndex: 1, connectorIndex: 2, id: "a2" },
      { evseIndex: 1, connectorIndex: 1, id: "a1" },
    ];
    expect(orderConnectorsByEvse(connectors).map((c) => c.id)).toEqual(["a1", "a2", "b"]);
  });

  it("does not mutate the input array", () => {
    const connectors = [
      { evseIndex: 2, connectorIndex: 1, id: "b" },
      { evseIndex: 1, connectorIndex: 1, id: "a" },
    ];
    const original = [...connectors];
    orderConnectorsByEvse(connectors);
    expect(connectors).toEqual(original);
  });

  it("returns an empty array for an empty input", () => {
    expect(orderConnectorsByEvse([])).toEqual([]);
  });
});

describe("buildOutsideInButtons", () => {
  it("orders two connectors as details(A), unlock(A), unlock(B), details(B) — matching the real device's button row", () => {
    const buttons = buildOutsideInButtons(["A", "B"]);
    expect(buttons).toEqual([
      { connector: "A", kind: "details" },
      { connector: "A", kind: "unlock" },
      { connector: "B", kind: "unlock" },
      { connector: "B", kind: "details" },
    ]);
  });

  it("gives a single connector just its own details/unlock pair", () => {
    expect(buildOutsideInButtons(["A"])).toEqual([
      { connector: "A", kind: "details" },
      { connector: "A", kind: "unlock" },
    ]);
  });

  it("mirrors from both ends inward for more than two connectors", () => {
    const buttons = buildOutsideInButtons(["A", "B", "C"]);
    expect(buttons.map((b) => `${b.connector}-${b.kind}`)).toEqual([
      "A-details",
      "A-unlock",
      "C-unlock",
      "C-details",
      "B-details",
      "B-unlock",
    ]);
  });

  it("returns an empty array for an empty input", () => {
    expect(buildOutsideInButtons([])).toEqual([]);
  });
});
