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
