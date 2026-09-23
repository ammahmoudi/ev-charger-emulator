import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StatusDiagnosticsPage from "../page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "inst-1" }),
}));

const instance = {
  id: "inst-1",
  name: "Test Charger",
  deviceModel: { id: "model-1", manufacturer: "SINO", model: "PEVC3107E" },
};

const model = {
  id: "model-1",
  connectors: [
    { id: "db-a", evseIndex: 1, connectorIndex: 1, label: "Plug A" },
    { id: "db-b", evseIndex: 2, connectorIndex: 1, label: "Plug B" },
  ],
};

const overall = {
  powerSupplyOverVoltage: "normal",
  powerSupplyUnderVoltage: "normal",
  equipmentTemperature: "normal",
  circuitBreakerStatus: "normal",
  emergency: "normal",
  cardDetector: "normal",
  contactorStatus: "normal",
  controlSystem: "normal",
  cabinetDoor: "normal",
  spd: "normal",
  storageState: "normal",
  communicationOfChargeModule: "normal",
  mainProgramVersion: "0xb220",
  interfaceProgramVersion: "V2.1.2",
};

/**
 * Plug A starts locked (an in-progress session) and Plug B starts unlocked — covers both the
 * "unlock is actionable" and "unlock is disabled once already unlocked" cases in one render.
 */
let plugALocked = true;

function runtimeConnectors() {
  return [
    { connectorId: 1, label: "Plug A", status: "Charging", locked: plugALocked, activeSession: null },
    { connectorId: 2, label: "Plug B", status: "Available", locked: false, activeSession: null },
  ];
}

function jsonResponse(body: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe("StatusDiagnosticsPage — per-plug unlock buttons", () => {
  beforeEach(() => {
    plugALocked = true;
    global.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";

      if (url === "/api/device-instances/inst-1" && method === "GET") return jsonResponse({ instance });
      if (url === "/api/device-models/model-1" && method === "GET") return jsonResponse({ deviceModel: model });
      if (url === "/api/device-instances/inst-1/diagnostics" && method === "GET") return jsonResponse({ overall });
      if (url === "/api/device-instances/inst-1/connectors" && method === "GET") {
        return jsonResponse({ connectors: runtimeConnectors() });
      }
      if (url === "/api/device-instances/inst-1/connectors/1/lock" && method === "POST") {
        plugALocked = false;
        return jsonResponse({ connector: runtimeConnectors()[0] });
      }

      return Promise.reject(new Error(`Unhandled fetch in test: ${method} ${url}`));
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders one details link and one unlock button per connector, matching the reference overlay", async () => {
    render(<StatusDiagnosticsPage />);

    expect(await screen.findByRole("link", { name: "Plug A details" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plug B details" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plug A unlock" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plug B unlock" })).toBeInTheDocument();
  });

  it("only enables unlock for a currently-locked connector", async () => {
    render(<StatusDiagnosticsPage />);

    const unlockA = await screen.findByRole("button", { name: "Plug A unlock" });
    const unlockB = screen.getByRole("button", { name: "Plug B unlock" });

    expect(unlockA).toBeEnabled();
    expect(unlockB).toBeDisabled();
  });

  it("clicking unlock posts locked:false to the connector's lock endpoint and disables once refreshed", async () => {
    render(<StatusDiagnosticsPage />);
    const unlockA = await screen.findByRole("button", { name: "Plug A unlock" });

    fireEvent.click(unlockA);

    await waitFor(() => expect(unlockA).toBeDisabled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/device-instances/inst-1/connectors/1/lock",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ locked: false }) }),
    );
  });
});
