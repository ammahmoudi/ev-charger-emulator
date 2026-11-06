import type { PlugTestState } from "./hardware-test-types";

export interface BmsReadout {
  label: string;
  value: string;
}

/** Photo reference: the two GB/T BMS pages. These are simulated test readings,
 * not measurements received from a vehicle. No handshake means zero/blank data. */
export function getBmsReadouts(
  plug: PlugTestState,
): [BmsReadout[][], BmsReadout[][]] {
  const active = plug.outputRunning;
  const row = (label: string, value: string): BmsReadout => ({ label, value });
  const n = (value: number, decimals = 1) =>
    (active ? value : 0).toFixed(decimals);
  return [
    [
      [
        row("Protocol version", active ? "1.00" : "0.00"),
        row("Rated capacity (Ah)", n(150)),
        row("VIN code", ""),
        row("Monomer maximum voltage (V)", n(4.2, 2)),
        row("Nominal total power (kWh)", n(60)),
        row("Maximum allowable temperature (°C)", n(55, 0)),
        row("Battery voltage (V)", n(plug.outputVoltageV)),
      ],
      [
        row("Battery type", active ? "Lithium-ion" : ""),
        row("Rated voltage (V)", n(400)),
        row("Maximum allowable current (A)", n(125)),
        row("Maximum allowable voltage (V)", n(450)),
        row("Charged status", n(0)),
        row("Battery status", "0x0000"),
        row("Charging mode", active ? "Constant current" : "0.0"),
      ],
    ],
    [
      [
        row("Voltage demand (V)", n(400)),
        row("Test voltage (V)", n(plug.outputVoltageV)),
        row("Current requirement (A)", n(plug.outputCurrentA)),
        row("Test current (A)", n(plug.outputCurrentA)),
        row("Monomer maximum voltage (V)", n(3.65, 2)),
        row("Maximum voltage group number", n(1, 0)),
        row("Maximum voltage number", n(12, 0)),
      ],
      [
        row("Current SOC (%)", n(50, 0)),
        row(
          "Estimate time remaining (s)",
          active
            ? Math.round(
                (30 /
                  Math.max(
                    1,
                    (plug.outputVoltageV * plug.outputCurrentA) / 1000,
                  )) *
                  3600,
              ).toString()
            : "0",
        ),
        row(
          "Maximum temperature (°C)",
          n(Math.max(plug.interfaceTemp1C, plug.interfaceTemp2C), 0),
        ),
        row("Maximum temperature number", n(2, 0)),
        row(
          "Minimum temperature (°C)",
          n(Math.min(plug.interfaceTemp1C, plug.interfaceTemp2C), 0),
        ),
        row("Minimum temperature number", n(1, 0)),
      ],
    ],
  ];
}
