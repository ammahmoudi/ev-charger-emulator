import type { DeviceModelConnector } from "@prisma/client";

/**
 * A model connector plus the flat, sequential OCPP `connectorId` (1-based, per the OCPP 1.6
 * connectorId numbering) it's assigned within its device model — derived by ordering connectors
 * by (evseIndex, connectorIndex) rather than stored, since a model's connector topology is
 * small and rarely reordered. Both the runtime (session wiring) and the API (connector summaries)
 * must agree on this numbering, hence the shared helper.
 */
export interface OrderedDeviceModelConnector extends DeviceModelConnector {
  connectorId: number;
  displayLabel: string;
}

export function orderModelConnectors(connectors: DeviceModelConnector[]): OrderedDeviceModelConnector[] {
  return [...connectors]
    .sort((a, b) => a.evseIndex - b.evseIndex || a.connectorIndex - b.connectorIndex)
    .map((connector, index) => ({
      ...connector,
      connectorId: index + 1,
      displayLabel: connector.label ?? `EVSE ${connector.evseIndex} / Connector ${connector.connectorIndex}`,
    }));
}
