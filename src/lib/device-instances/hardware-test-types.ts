/**
 * Types for the bottom-nav "Device" hardware test/diagnostics screen (issue #16) — distinct
 * from Setting > Device (identity info, issue #12). See `./hardware-test-state.ts`.
 */

/** Generic open/closed reading, used for contactors, relays, fuses-as-circuit, etc. */
export type ContactState = "Open" | "Closed";

/** "Output mode" shown on the Charging Test tab. */
export type ChargingOutputMode = "FullLoadOutput" | "HalfLoadOutput";

/** Auxiliary/assist power supply mode, driven by the "Auxiliary power action" control. */
export type AuxPowerMode = "Off" | "12V" | "24V";

/** Global (per-instance, not per-plug) Charging Test tab settings. */
export interface ChargingTestSettings {
  /** "Interface board Test mode" toggle. */
  interfaceBoardTestMode: boolean;
  outputMode: ChargingOutputMode;
  /** Plug-select field on the Charging Test tab. */
  selectedConnectorId: number;
}

/** Per-connector ("Plug A"/"Plug B") hardware test state. */
export interface PlugTestState {
  connectorId: number;
  label: string;

  /** True while this connector's output test (Charging Test start/stop, or the plug's own
   * contactor action) is running — the single source of truth contactor/KM/plug readouts derive from. */
  outputRunning: boolean;

  auxPowerMode: AuxPowerMode;
  lockStatus: "Locked" | "Unlocked";

  // --- derived/simulated readouts, recomputed on every read ---
  cc1: ContactState;
  cc2: ContactState;
  km1: ContactState;
  km2: ContactState;
  plugPosition: "Connected" | "Disconnected";
  fuseStatus: "Normal" | "Blown";
  assistPowerStatus: ContactState;
  meterStatus: "Normal" | "Error";
  commStatus: "Normal" | "Error";
  insulationResistanceKOhm: number;
  interfaceTemp1C: number;
  interfaceTemp2C: number;
  adSamplingVoltageV: number;
  ccVoltageV: number;
  outputVoltageV: number;
  outputCurrentA: number;
}

/** Charging Pile Test tab state (not per-connector). */
export interface PileTestState {
  threePhaseAcContactor: ContactState;
  powerContactor: ContactState;
  fanContactor: ContactState;
  /** "QF operate" action — QF is the pile's main circuit breaker. */
  breakerStatus: ContactState;

  // --- derived/simulated readouts, recomputed on every read ---
  gprsStatus: "Online" | "Offline";
  gprsSignalPercent: number;
  temp1C: number;
  temp2C: number;
  temp3C: number;
  temp4C: number;
  humidityPercent: number;
  moduleStatus: "Normal" | "Fault";
  uabVoltageV: number;
  ubcVoltageV: number;
  ucaVoltageV: number;
  iccid: string;
  imei: string;
}

export interface HardwareTestState {
  chargingTest: ChargingTestSettings;
  plugs: PlugTestState[];
  pile: PileTestState;
}

export type ContactorAction = "start" | "stop";
export type AuxPowerAction = "12V" | "24V" | "stop";
export type LockAction = "start" | "stop";
export type PileContactorTarget = "threePhaseAcContactor" | "powerContactor" | "fanContactor" | "breaker";
