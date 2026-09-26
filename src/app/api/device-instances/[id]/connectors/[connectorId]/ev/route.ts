import { NextResponse } from "next/server";

import { connectEv, disconnectEv } from "@/lib/device-instances/connector-sessions";
import { badRequest, notFound } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

interface EvBody {
  connected?: unknown;
}

/** Plugs/unplugs a simulated EV into a connector (the Home screen's EV connect/disconnect control). Body: `{ connected: boolean }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; connectorId: string }> }) {
  const { id, connectorId: connectorIdParam } = await params;
  const connectorId = Number(connectorIdParam);
  if (!Number.isInteger(connectorId)) return badRequest("connectorId must be an integer");

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  let body: EvBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }
  if (typeof body.connected !== "boolean") return badRequest("connected must be a boolean");

  const connector = body.connected ? await connectEv(id, connectorId) : await disconnectEv(id, connectorId);
  if (!connector) return notFound("Connector not found on this instance's device model");

  return NextResponse.json({ connector });
}
