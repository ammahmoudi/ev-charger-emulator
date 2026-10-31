import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorChargeCard, type ChargeCardConnector, type ChargeCardRuntime } from "../ConnectorChargeCard";

const connector: ChargeCardConnector = {
  connectorId: 1,
  label: "Plug A",
  connectorType: "CCS2",
  maxPowerKw: 60,
};

const now = new Date("2026-01-01T12:00:00.000Z");

function noop() {}

afterEach(cleanup);

describe("ConnectorChargeCard", () => {
  it("Available with no EV connected: shows the idle prompt and allows authorization before plugging in", () => {
    const onStartCharging = vi.fn();
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Available", locked: false, evConnected: false, activeSession: null }}
        now={now}
        pending={false}
        error={null}
        onStartCharging={onStartCharging}
        onStopCharging={noop}
        onClearFault={noop}
      />,
    );

    expect(screen.getByText("Please connect the EV or click charging button.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Charging" })).toBeEnabled();
  });

  it("Preparing with an EV connected and no card presented yet: shows the ready prompt and an enabled Charging button", () => {
    const onStartCharging = vi.fn();
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Preparing", locked: false, evConnected: true, activeSession: null }}
        now={now}
        pending={false}
        error={null}
        onStartCharging={onStartCharging}
        onStopCharging={noop}
        onClearFault={noop}
      />,
    );

    expect(screen.getByText("EV connected — waiting for a card or app authorization.")).toBeInTheDocument();
    const chargingButton = screen.getByRole("button", { name: "Charging" });
    expect(chargingButton).toBeEnabled();
    fireEvent.click(chargingButton);
    expect(onStartCharging).toHaveBeenCalledOnce();
  });

  it("card-first Preparing asks for the EV and allows cancellation", () => {
    const onStopCharging = vi.fn();
    render(<ConnectorChargeCard connector={connector}
      runtime={{ status: "Preparing", locked: true, evConnected: false, activeSession: {
        idTag: "CARD", startedAt: now.toISOString(), chargeRateKw: 20, currentEnergyWh: 0,
      } }} now={now} pending={false} error={null} onStartCharging={noop}
      onStopCharging={onStopCharging} onClearFault={noop} />);
    expect(screen.getByText(/connect the EV/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onStopCharging).toHaveBeenCalledOnce();
  });

  it("Charging with an active session: shows the card idTag, live energy, and a Stop button", () => {
    const runtime: ChargeCardRuntime = {
      status: "Charging",
      locked: true,
      evConnected: true,
      activeSession: {
        idTag: "CARD-42",
        // Exactly 1 hour ago at a 7kW rate → 7.000 kWh, so the energy readout is deterministic.
        startedAt: new Date(now.getTime() - 3_600_000).toISOString(),
        chargeRateKw: 7,
        currentEnergyWh: 7000,
      },
    };
    const onStopCharging = vi.fn();
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={runtime}
        now={now}
        pending={false}
        error={null}
        onStartCharging={noop}
        onStopCharging={onStopCharging}
        onClearFault={noop}
      />,
    );

    expect(screen.getByText(/Charging — card CARD-42/)).toBeInTheDocument();
    expect(screen.getByText(/7\.000 kWh/)).toBeInTheDocument();
    expect(screen.getByText("01:00:00")).toBeInTheDocument();

    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);
    expect(onStopCharging).toHaveBeenCalledOnce();
  });

  it("Finishing (no active session yet): shows the finishing prompt with the Charging button disabled", () => {
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Finishing", locked: false, evConnected: true, activeSession: null }}
        now={now}
        pending={false}
        error={null}
        onStartCharging={noop}
        onStopCharging={noop}
        onClearFault={noop}
      />,
    );

    expect(screen.getByText("Finishing charge…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Charging" })).toBeDisabled();
  });

  it("Faulted: shows the fault message and calls onClearFault", () => {
    const onClearFault = vi.fn();
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Faulted", locked: false, evConnected: false, activeSession: null }}
        now={now}
        pending={false}
        error={null}
        onStartCharging={noop}
        onStopCharging={noop}
        onClearFault={onClearFault}
      />,
    );

    expect(screen.getByText(/Connector fault/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear fault" }));
    expect(onClearFault).toHaveBeenCalledOnce();
  });
});
