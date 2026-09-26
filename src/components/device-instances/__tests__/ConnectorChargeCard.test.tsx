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
  it("Available with no EV connected: shows the idle prompt and a disabled Charging button", () => {
    const onStartCharging = vi.fn();
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Available", locked: false, evConnected: false, activeSession: null }}
        now={now}
        pending={false}
        evPending={false}
        error={null}
        onStartCharging={onStartCharging}
        onStopCharging={noop}
        onClearFault={noop}
        onToggleEv={noop}
      />,
    );

    expect(screen.getByText("Please connect the EV or click charging button.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Charging" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Plug in EV" })).toBeEnabled();
  });

  it("Preparing with an EV connected and no card presented yet: shows the ready prompt and an enabled Charging button", () => {
    const onStartCharging = vi.fn();
    const onToggleEv = vi.fn();
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Preparing", locked: false, evConnected: true, activeSession: null }}
        now={now}
        pending={false}
        evPending={false}
        error={null}
        onStartCharging={onStartCharging}
        onStopCharging={noop}
        onClearFault={noop}
        onToggleEv={onToggleEv}
      />,
    );

    expect(screen.getByText("EV connected — click Charging to start.")).toBeInTheDocument();
    const chargingButton = screen.getByRole("button", { name: "Charging" });
    expect(chargingButton).toBeEnabled();
    fireEvent.click(chargingButton);
    expect(onStartCharging).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Unplug EV" }));
    expect(onToggleEv).toHaveBeenCalledOnce();
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
        evPending={false}
        error={null}
        onStartCharging={noop}
        onStopCharging={onStopCharging}
        onClearFault={noop}
        onToggleEv={noop}
      />,
    );

    expect(screen.getByText(/Charging — card CARD-42/)).toBeInTheDocument();
    expect(screen.getByText(/7\.000 kWh/)).toBeInTheDocument();
    expect(screen.getByText("01:00:00")).toBeInTheDocument();

    const stopButton = screen.getByRole("button", { name: "Stop" });
    fireEvent.click(stopButton);
    expect(onStopCharging).toHaveBeenCalledOnce();

    // Unplugging mid-charge is still offered, and its label warns it will stop the session.
    expect(screen.getByRole("button", { name: "Unplug EV (stops session)" })).toBeInTheDocument();
  });

  it("Finishing (no active session yet): shows the idle prompt with the Charging button disabled", () => {
    render(
      <ConnectorChargeCard
        connector={connector}
        runtime={{ status: "Finishing", locked: false, evConnected: true, activeSession: null }}
        now={now}
        pending={false}
        evPending={false}
        error={null}
        onStartCharging={noop}
        onStopCharging={noop}
        onClearFault={noop}
        onToggleEv={noop}
      />,
    );

    expect(screen.getByText("EV connected — click Charging to start.")).toBeInTheDocument();
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
        evPending={false}
        error={null}
        onStartCharging={noop}
        onStopCharging={noop}
        onClearFault={onClearFault}
        onToggleEv={noop}
      />,
    );

    expect(screen.getByText(/Connector fault/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear fault" }));
    expect(onClearFault).toHaveBeenCalledOnce();
  });
});
