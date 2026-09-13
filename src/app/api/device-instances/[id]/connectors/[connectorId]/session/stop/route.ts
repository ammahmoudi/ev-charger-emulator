import { NextResponse } from "next/server";

import { ConnectorSessionError, stopChargingSession } from "@/lib/device-instances/connector-sessions";
import { badRequest, notFound } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

interface StopBody {
  stopCause?: unknown;
}

/**
 * Ends a connector's in-progress simulated session and returns a summary shaped for the
 * post-charge popup. Body: `{ stopCause: string }`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId: connectorIdParam } = await params;
  const connectorId = Number(connectorIdParam);
  if (!Number.isInteger(connectorId)) return badRequest("connectorId must be an integer");

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  let body: StopBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }
  if (typeof body.stopCause !== "string" || !body.stopCause.trim()) return badRequest("stopCause is required");

  try {
    const summary = await stopChargingSession(id, connectorId, { stopCause: body.stopCause.trim() });
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof ConnectorSessionError) return badRequest(err.message);
    throw err;
  }
}
