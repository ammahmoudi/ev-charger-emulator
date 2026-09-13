import type {
  ConnectorType,
  DeviceConnectionStatus,
  OcppProtocolVersion,
  ParameterCategory,
  ParameterValueType,
  PowerType,
} from "@prisma/client";
import type { OcppChargePointErrorCode, OcppChargePointStatus } from "@/lib/ocpp";

/** Client-side view types matching the JSON shapes returned by the device-instances/device-models API routes. */

/** Static connector topology merged with this instance's live, locally-tracked OCPP status (null until first started). */
export interface DeviceInstanceConnectorView {
  connectorId: number;
  label: string;
  connectorType: ConnectorType;
  powerType: PowerType;
  maxPowerKw: number | null;
  status: OcppChargePointStatus | null;
  errorCode: OcppChargePointErrorCode | null;
}

export interface DeviceInstanceSummary {
  id: string;
  name: string;
  chargePointId: string;
  csmsUrl: string;
  status: DeviceConnectionStatus;
  statusReason: string | null;
  lastConnectedAt: string | null;
  updatedAt: string;
  deviceModel: { manufacturer: string; model: string };
  connectors: DeviceInstanceConnectorView[];
}

export interface DeviceInstanceParameterView {
  deviceModelParameterId: string;
  key: string;
  label: string;
  category: ParameterCategory;
  valueType: ParameterValueType;
  unit: string | null;
  enumOptions: string[];
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  sortOrder: number;
  value: string | null;
}

export interface DeviceInstanceDetail {
  id: string;
  name: string;
  chargePointId: string;
  csmsUrl: string;
  status: DeviceConnectionStatus;
  statusReason: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deviceModel: {
    id: string;
    manufacturer: string;
    brand: string | null;
    model: string;
    ocppProtocol: OcppProtocolVersion;
  };
  connectors: DeviceInstanceConnectorView[];
  parameters: DeviceInstanceParameterView[];
}

export interface DeviceModelSummary {
  id: string;
  manufacturer: string;
  brand: string | null;
  model: string;
  ocppProtocol: OcppProtocolVersion;
  description: string | null;
}

export interface DeviceModelParameterSchema {
  id: string;
  key: string;
  label: string;
  category: ParameterCategory;
  valueType: ParameterValueType;
  unit: string | null;
  defaultValue: string | null;
  enumOptions: string[];
  minValue: number | null;
  maxValue: number | null;
  description: string | null;
  sortOrder: number;
}

export interface DeviceModelDetail extends DeviceModelSummary {
  parameters: DeviceModelParameterSchema[];
}

export const PARAMETER_CATEGORY_LABELS: Record<ParameterCategory, string> = {
  DEVICE: "Device",
  SYSTEM: "System",
  NETWORKS: "Networks",
  FEE_RATE: "Fee Rate",
  OTHER: "Other",
};

export const PARAMETER_CATEGORY_ORDER: ParameterCategory[] = ["DEVICE", "SYSTEM", "NETWORKS", "FEE_RATE", "OTHER"];

/** One row of an instance's Event log (issue #14's Event screen). */
export interface DeviceInstanceEventView {
  id: string;
  type: string;
  description: string;
  occurredAt: string;
}

/** One completed session row for the Cost/session-history screen (issue #14). */
export interface DeviceInstanceSessionView {
  id: string;
  connectorId: number;
  connectorLabel: string | null;
  idTag: string;
  startedAt: string;
  stoppedAt: string;
  energyWh: number;
  cost: number;
  currency: string | null;
  stopCause: string;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageCount: number;
  totalCount: number;
}

/** Live per-connector runtime state — backs the Lock screen and the Cost screen's session trigger. */
export interface ConnectorRuntimeView {
  connectorId: number;
  label: string | null;
  status: string;
  locked: boolean;
  activeSession: {
    idTag: string;
    transactionId: number | null;
    startedAt: string;
    chargeRateKw: number;
    currentEnergyWh: number;
  } | null;
}

/** Maintenance-tab state (issue #15): firmware version plus live per-connector runtime state. */
export interface DeviceInstanceMaintenanceState {
  /** Value of the instance's "firmwareVersion" parameter, or null if its model defines none. */
  firmwareVersion: string | null;
  connectors: ConnectorRuntimeView[];
  eventCount: number;
  chargingSessionCount: number;
}

/** Result of stopping a simulated session — shown in the post-charge summary popup. */
export interface PostChargeSummary {
  connectorId: number;
  connectorLabel: string | null;
  idTag: string;
  transactionId: number | null;
  startedAt: string;
  stoppedAt: string;
  energyKwh: number;
  cost: number;
  currency: string | null;
  stopCause: string;
  isFault: boolean;
  durationSeconds: number;
}
