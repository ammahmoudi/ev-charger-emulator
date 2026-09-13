import type { DeviceConnectionStatus, OcppProtocolVersion, ParameterCategory, ParameterValueType } from "@prisma/client";

/** Client-side view types matching the JSON shapes returned by the device-instances/device-models API routes. */

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
