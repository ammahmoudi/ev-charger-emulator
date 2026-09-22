import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { DeviceConnectionStatus } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeHeaderBar } from "../HomeHeaderBar";

const now = new Date("2026-01-01T03:17:46.000Z");

afterEach(cleanup);

function renderHeader(status: DeviceConnectionStatus, onToggleConnection = vi.fn()) {
  render(
    <HomeHeaderBar
      instanceId="inst-1"
      name="Bay 3 charger"
      serialNumber="0000101608200001"
      now={now}
      status={status}
      statusReason={null}
      connectionPending={false}
      onToggleConnection={onToggleConnection}
    />,
  );
  return onToggleConnection;
}

describe("HomeHeaderBar — connection status badge", () => {
  it("CONNECTED: the connection toggle is titled to offer 'stop' next", () => {
    renderHeader("CONNECTED");
    expect(screen.getByTitle(/^CONNECTED — click to stop/)).toBeInTheDocument();
  });

  it("CONNECTING: still offers 'stop' next (treated as running, like CONNECTED)", () => {
    renderHeader("CONNECTING");
    expect(screen.getByTitle(/^CONNECTING — click to stop/)).toBeInTheDocument();
  });

  it("DISCONNECTED: the connection toggle is titled to offer 'start' next", () => {
    renderHeader("DISCONNECTED");
    expect(screen.getByTitle(/^DISCONNECTED — click to start/)).toBeInTheDocument();
  });

  it("FAULTED: not treated as running — offers 'start' next", () => {
    renderHeader("FAULTED");
    expect(screen.getByTitle(/^FAULTED — click to start/)).toBeInTheDocument();
  });

  it("clicking the connection toggle calls onToggleConnection", () => {
    const onToggleConnection = renderHeader("DISCONNECTED");
    fireEvent.click(screen.getByTitle(/^DISCONNECTED —/));
    expect(onToggleConnection).toHaveBeenCalledOnce();
  });

  it("shows a statusReason in the toggle's title when set", () => {
    render(
      <HomeHeaderBar
        instanceId="inst-1"
        name="Bay 3 charger"
        serialNumber="0000101608200001"
        now={now}
        status="FAULTED"
        statusReason="CSMS rejected boot notification"
        connectionPending={false}
        onToggleConnection={vi.fn()}
      />,
    );
    expect(screen.getByTitle("FAULTED — CSMS rejected boot notification")).toBeInTheDocument();
  });

  it("renders the live clock and serial number from props", () => {
    renderHeader("CONNECTED");
    expect(screen.getByText("03:17:46")).toBeInTheDocument();
    expect(screen.getByText("SN: 0000101608200001")).toBeInTheDocument();
  });
});
