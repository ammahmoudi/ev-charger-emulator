import type { DeviceModelConnector } from "@prisma/client";

import { orderModelConnectors } from "./connectors";
import { getInstanceConnectorStatuses } from "./runtime";
import { prisma } from "@/lib/prisma";

/** Per-connector summary: static topology from the device model merged with this instance's live, locally-tracked status. */
function buildConnectorSummaries(instanceId: string, modelConnectors: DeviceModelConnector[]) {
  const liveByConnectorId = new Map(getInstanceConnectorStatuses(instanceId).map((s) => [s.connectorId, s]));

  return orderModelConnectors(modelConnectors).map((connector) => {
    const live = liveByConnectorId.get(connector.connectorId);
    return {
      connectorId: connector.connectorId,
      label: connector.displayLabel,
      connectorType: connector.connectorType,
      powerType: connector.powerType,
      status: live?.status ?? null,
      errorCode: live?.errorCode ?? null,
    };
  });
}

/** Full instance detail: identity/status fields plus the model's parameter schema merged with this instance's current values. */
export async function serializeDeviceInstance(instanceId: string) {
  const instance = await prisma.deviceInstance.findUnique({
    where: { id: instanceId },
    include: {
      deviceModel: {
        include: {
          parameters: { orderBy: { sortOrder: "asc" } },
          connectors: true,
        },
      },
      parameters: true,
    },
  });
  if (!instance) return null;

  const valueByParameterId = new Map(instance.parameters.map((p) => [p.deviceModelParameterId, p.value]));

  return {
    id: instance.id,
    name: instance.name,
    chargePointId: instance.chargePointId,
    csmsUrl: instance.csmsUrl,
    status: instance.status,
    statusReason: instance.statusReason,
    lastConnectedAt: instance.lastConnectedAt,
    createdAt: instance.createdAt,
    updatedAt: instance.updatedAt,
    deviceModel: {
      id: instance.deviceModel.id,
      manufacturer: instance.deviceModel.manufacturer,
      brand: instance.deviceModel.brand,
      model: instance.deviceModel.model,
      ocppProtocol: instance.deviceModel.ocppProtocol,
    },
    connectors: buildConnectorSummaries(instance.id, instance.deviceModel.connectors),
    parameters: instance.deviceModel.parameters.map((p) => ({
      deviceModelParameterId: p.id,
      key: p.key,
      label: p.label,
      category: p.category,
      valueType: p.valueType,
      unit: p.unit,
      enumOptions: p.enumOptions,
      minValue: p.minValue,
      maxValue: p.maxValue,
      description: p.description,
      sortOrder: p.sortOrder,
      value: valueByParameterId.get(p.id) ?? null,
    })),
  };
}

export type SerializedDeviceInstance = NonNullable<Awaited<ReturnType<typeof serializeDeviceInstance>>>;

/** Summary shape used by the dashboard/instance list view. */
export async function listDeviceInstances() {
  const instances = await prisma.deviceInstance.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      deviceModel: { select: { manufacturer: true, model: true, connectors: true } },
    },
  });

  return instances.map((instance) => ({
    id: instance.id,
    name: instance.name,
    chargePointId: instance.chargePointId,
    csmsUrl: instance.csmsUrl,
    status: instance.status,
    statusReason: instance.statusReason,
    lastConnectedAt: instance.lastConnectedAt,
    updatedAt: instance.updatedAt,
    deviceModel: { manufacturer: instance.deviceModel.manufacturer, model: instance.deviceModel.model },
    connectors: buildConnectorSummaries(instance.id, instance.deviceModel.connectors),
  }));
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageCount: number;
  totalCount: number;
}

const DEFAULT_PAGE_SIZE = 10;

/** Paginated Event log for an instance (issue #14's Event screen), newest first. */
export async function listDeviceInstanceEvents(
  deviceInstanceId: string,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): Promise<PagedResult<{ id: string; type: string; description: string; occurredAt: Date }>> {
  const totalCount = await prisma.deviceInstanceEvent.count({ where: { deviceInstanceId } });
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(Math.max(1, page), pageCount);

  const items = await prisma.deviceInstanceEvent.findMany({
    where: { deviceInstanceId },
    orderBy: { occurredAt: "desc" },
    skip: (clampedPage - 1) * pageSize,
    take: pageSize,
  });

  return { items, page: clampedPage, pageCount, totalCount };
}

/** Paginated session/cost history for an instance (issue #14's Cost screen), newest first. */
export async function listDeviceInstanceSessions(
  deviceInstanceId: string,
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  const totalCount = await prisma.deviceInstanceSession.count({ where: { deviceInstanceId } });
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedPage = Math.min(Math.max(1, page), pageCount);

  const items = await prisma.deviceInstanceSession.findMany({
    where: { deviceInstanceId },
    orderBy: { startedAt: "desc" },
    skip: (clampedPage - 1) * pageSize,
    take: pageSize,
  });

  return { items, page: clampedPage, pageCount, totalCount };
}
