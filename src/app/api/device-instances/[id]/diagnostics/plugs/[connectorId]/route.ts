import { NextResponse } from "next/server";

import { badRequest, notFound } from "@/lib/device-instances/http";
import {
  CONTACTOR_FIELDS,
  getInterfaceBoardReading,
  INTERFACE_BOARD_TOGGLE_FIELDS,
  setContactorField,
  setInterfaceBoardToggleField,
  type ContactorField,
  type InterfaceBoardToggleField,
} from "@/lib/device-instances/diagnostics";
import { prisma } from "@/lib/prisma";

async function assertConnectorBelongsToInstance(instanceId: string, connectorId: string): Promise<boolean> {
  const connector = await prisma.deviceModelConnector.findFirst({
    where: { id: connectorId, deviceModel: { instances: { some: { id: instanceId } } } },
    select: { id: true },
  });
  return connector !== null;
}

/** Per-plug "interface board" diagnostics reading (issue #4), simulated in-memory. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId } = await params;
  if (!(await assertConnectorBelongsToInstance(id, connectorId))) return notFound("Connector not found on this instance");
  return NextResponse.json({ interfaceBoard: getInterfaceBoardReading(id, connectorId) });
}

interface PatchBody {
  field?: unknown;
  value?: unknown;
}

const TOGGLE_FIELD_SET: readonly string[] = INTERFACE_BOARD_TOGGLE_FIELDS;
const CONTACTOR_FIELD_SET: readonly string[] = CONTACTOR_FIELDS;

/** Flips one interface-board comm/health field, or one KM1/KM2 contactor field, for fault-injection testing. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId } = await params;
  if (!(await assertConnectorBelongsToInstance(id, connectorId))) return notFound("Connector not found on this instance");

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  if (typeof body.field !== "string") return badRequest("field must be a string", "field");

  if (TOGGLE_FIELD_SET.includes(body.field)) {
    if (body.value !== "normal" && body.value !== "abnormal") {
      return badRequest('value must be "normal" or "abnormal"', "value");
    }
    const interfaceBoard = setInterfaceBoardToggleField(id, connectorId, body.field as InterfaceBoardToggleField, body.value);
    return NextResponse.json({ interfaceBoard });
  }

  if (CONTACTOR_FIELD_SET.includes(body.field)) {
    if (body.value !== "open" && body.value !== "closed") {
      return badRequest('value must be "open" or "closed"', "value");
    }
    const interfaceBoard = setContactorField(id, connectorId, body.field as ContactorField, body.value);
    return NextResponse.json({ interfaceBoard });
  }

  return badRequest(`field must be one of: ${[...TOGGLE_FIELD_SET, ...CONTACTOR_FIELD_SET].join(", ")}`, "field");
}
