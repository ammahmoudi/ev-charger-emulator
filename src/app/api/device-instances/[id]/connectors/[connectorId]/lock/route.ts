import { NextResponse } from "next/server";

import { setConnectorLock } from "@/lib/device-instances/connector-sessions";
import { badRequest, notFound } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

interface LockBody {
  locked?: unknown;
}

/** Sets a connector's manual lock state (issue #14's Lock screen). Body: `{ locked: boolean }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId: connectorIdParam } = await params;
  const connectorId = Number(connectorIdParam);
  if (!Number.isInteger(connectorId)) return badRequest("connectorId must be an integer");

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  let body: LockBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }
  if (typeof body.locked !== "boolean") return badRequest("locked must be a boolean");

  const connector = await setConnectorLock(id, connectorId, body.locked);
  if (!connector) return notFound("Connector not found on this instance's device model");

  return NextResponse.json({ connector });
}
