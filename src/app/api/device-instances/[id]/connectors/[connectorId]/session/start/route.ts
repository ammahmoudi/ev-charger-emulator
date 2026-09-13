import { NextResponse } from "next/server";

import { ConnectorSessionError, startChargingSession } from "@/lib/device-instances/connector-sessions";
import { badRequest, notFound } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

interface StartBody {
  idTag?: unknown;
  chargeRateKw?: unknown;
}

/**
 * Starts a locally-simulated charging session on a connector.
 * Body: `{ idTag: string, chargeRateKw: number }`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId: connectorIdParam } = await params;
  const connectorId = Number(connectorIdParam);
  if (!Number.isInteger(connectorId)) return badRequest("connectorId must be an integer");

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  let body: StartBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }
  if (typeof body.idTag !== "string" || !body.idTag.trim()) return badRequest("idTag is required");
  const chargeRateKw = Number(body.chargeRateKw);
  if (!Number.isFinite(chargeRateKw) || chargeRateKw <= 0) return badRequest("chargeRateKw must be a positive number");

  try {
    const connector = await startChargingSession(id, connectorId, { idTag: body.idTag.trim(), chargeRateKw });
    return NextResponse.json({ connector });
  } catch (err) {
    if (err instanceof ConnectorSessionError) return badRequest(err.message);
    throw err;
  }
}
