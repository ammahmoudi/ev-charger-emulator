import { describe, expect, it } from "vitest";

import { connectorDisplayLabel, orderConnectorsByEvse } from "../diagnostics-types";

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
