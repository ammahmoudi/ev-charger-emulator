import { NextResponse } from "next/server";

import { clearConnectorFault } from "@/lib/device-instances/connector-sessions";
import { badRequest, notFound } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

/** Clears a connector's Faulted status back to Available — the Lock screen's manual reset action. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId: connectorIdParam } = await params;
  const connectorId = Number(connectorIdParam);
  if (!Number.isInteger(connectorId)) return badRequest("connectorId must be an integer");

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  const connector = await clearConnectorFault(id, connectorId);
  if (!connector) return notFound("Connector not found on this instance's device model");

  return NextResponse.json({ connector });
}
