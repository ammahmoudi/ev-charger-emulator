import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChargeMethodScreen } from "../ChargeMethodScreen";
import { RfidPromptModal } from "../RfidPromptModal";

afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("photographed charging-method screen", () => {
  function setup() {
    const onCard = vi.fn(), onVehicleId = vi.fn(), onClose = vi.fn();
    render(<ChargeMethodScreen instanceId="demo" serialNumber="DEMO-123" price={1.25} currency="AED"
      expiresAt={Date.now() + 60_000} onCard={onCard} onVehicleId={onVehicleId} onClose={onClose} />);
    return { onCard, onVehicleId, onClose };
  }
  it("routes card, QR, and EV ID separately and uses the configured tariff", () => {
    const { onCard, onVehicleId } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Charging card" }));
    expect(onCard).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Autocharge with EV ID" }));
    expect(onVehicleId).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Scan QR code" })).toHaveAttribute("href", "/instances/demo/qr");
    expect(screen.getByText("1.2500")).toBeInTheDocument();
    expect(screen.getByText("DEMO-123")).toBeInTheDocument();
    expect(screen.getByText("کارت شارژ")).toHaveAttribute("dir", "rtl");
  });
  it("returns Home when the selection timer expires without choosing an authorization", () => {
    vi.useFakeTimers();
    const { onClose, onCard, onVehicleId } = setup();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCard).not.toHaveBeenCalled();
    expect(onVehicleId).not.toHaveBeenCalled();
  });
  it("Home closes the selector immediately", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole("link", { name: "Back to device" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("EV ID requires its own identity and never prefills the master card", () => {
    const onConfirm = vi.fn();
    render(<RfidPromptModal vehicleId connectorLabel="Plug A" masterCardIdTag="MASTER"
      pending={false} error={null} onConfirm={onConfirm} onCancel={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Vehicle ID" });
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Start autocharge" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "EV-123" } });
    fireEvent.click(screen.getByRole("button", { name: "Start autocharge" }));
    expect(onConfirm).toHaveBeenCalledWith("EV-123");
  });
});
