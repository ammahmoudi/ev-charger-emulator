/** Client-side view types matching the JSON shapes returned by the diagnostics API routes. */

export type HealthStatus = "normal" | "abnormal";
export type ContactStatus = "open" | "closed";

export interface OverallHealthView {
  powerSupplyOverVoltage: HealthStatus;
  powerSupplyUnderVoltage: HealthStatus;
  equipmentTemperature: HealthStatus;
  circuitBreakerStatus: HealthStatus;
  emergency: HealthStatus;
  cardDetector: HealthStatus;
  contactorStatus: HealthStatus;
  controlSystem: HealthStatus;
  cabinetDoor: HealthStatus;
  spd: HealthStatus;
  storageState: HealthStatus;
  communicationOfChargeModule: HealthStatus;
  mainProgramVersion: string;
  interfaceProgramVersion: string;
}

export interface InterfaceBoardView {
  adSamplingVoltage: number;
  seccCommunication: HealthStatus;
  temperatureSampling1: number;
  temperatureSampling2: number;
  meterCommunication: HealthStatus;
  plcErrorCode: string;
  interfaceBoardCommunication: HealthStatus;
  fuseStatus: HealthStatus;
  evErrorCode: number;
  km1Status: ContactStatus;
  km2Status: ContactStatus;
  ccVoltage: number;
  energyTotal: number;
}

export interface CommunicationModuleView {
  comm: HealthStatus;
  voltage: number;
  current: number;
}

export interface ConnectorView {
  id: string;
  evseIndex: number;
  connectorIndex: number;
  label: string | null;
}

export function connectorDisplayLabel(connector: ConnectorView): string {
  return connector.label ?? `Plug ${connector.evseIndex}`;
}

/**
 * Sorts connectors into the same (evseIndex, connectorIndex) order `orderModelConnectors` uses
 * to assign numeric OCPP `connectorId`s — used to zip a diagnostics `ConnectorView` list (keyed
 * by DB id) against a `ConnectorRuntimeView` list (keyed by numeric connectorId) for the same
 * device model, since neither list carries the other's id.
 */
export function orderConnectorsByEvse<T extends { evseIndex: number; connectorIndex: number }>(connectors: T[]): T[] {
  return [...connectors].sort((a, b) => a.evseIndex - b.evseIndex || a.connectorIndex - b.connectorIndex);
}

export interface ConnectorButtonDescriptor<T> {
  connector: T;
  kind: "details" | "unlock";
}

/**
 * Lays out a connector's "details"/"unlock" button pair in the real device's outside-in order —
 * e.g. for two connectors: details(A), unlock(A), unlock(B), details(B) — instead of the more
 * obvious per-connector grouping (details(A), unlock(A), details(B), unlock(B)). See
 * docs/device-reference/PEVC3107E/screenshots/02-status-diagnostics.png's button row. Mirrors
 * from both ends inward, which degrades reasonably for a connector count other than 2 (the only
 * count this device model actually has).
 */
export function buildOutsideInButtons<T>(connectors: T[]): ConnectorButtonDescriptor<T>[] {
  const buttons: ConnectorButtonDescriptor<T>[] = [];
  let lo = 0;
  let hi = connectors.length - 1;
  while (lo <= hi) {
    if (lo === hi) {
      buttons.push({ connector: connectors[lo], kind: "details" }, { connector: connectors[lo], kind: "unlock" });
    } else {
      buttons.push(
        { connector: connectors[lo], kind: "details" },
        { connector: connectors[lo], kind: "unlock" },
        { connector: connectors[hi], kind: "unlock" },
        { connector: connectors[hi], kind: "details" },
      );
    }
    lo += 1;
    hi -= 1;
  }
  return buttons;
}
