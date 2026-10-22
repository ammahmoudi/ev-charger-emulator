import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DeviceIdentityPanel } from "../settings/DeviceIdentityPanel";
import type { DeviceInstanceDetail, DeviceInstanceParameterView } from "@/lib/device-instances/types";

afterEach(cleanup);
it("keeps six identity rows on the left and four plug rows on the right, using runtime values", () => {
  const instance = { chargePointId: "DEMO-567", deviceModel: { model: "DEMO-MODEL", manufacturer: "DEMO" } } as DeviceInstanceDetail;
  const parameters = [
    { key: "firmwareVersion", value: "501", updatedAt: "2026-10-01T12:00:00Z" },
    { key: "plugAFirmwareVersion", value: "A-20", updatedAt: "2026-09-01T12:00:00Z" },
    { key: "plugBFirmwareVersion", value: "B-21", updatedAt: null },
  ] as DeviceInstanceParameterView[];
  render(<DeviceIdentityPanel instance={instance} parameters={parameters} />);
  const panel = screen.getByLabelText("Device firmware information");
  expect(panel.children[0].children).toHaveLength(6);
  expect(panel.children[1].children).toHaveLength(4);
  expect(panel.children[0].textContent).toContain("DEMO-567");
  expect(panel.children[0].textContent).toContain("DEMO-MODEL");
  expect(panel.children[0].textContent).toContain("2026 y 10 m 01 d");
  expect(panel.children[1].textContent).toContain("A-20");
  expect(panel.children[1].textContent).toContain("B-21");
  expect(panel.children[1].textContent).toContain("—");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByText("Master card idTag")).not.toBeInTheDocument();
});
