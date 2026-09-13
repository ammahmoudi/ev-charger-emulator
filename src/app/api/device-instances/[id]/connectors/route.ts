import { NextResponse } from "next/server";

import { listConnectorStates } from "@/lib/device-instances/connector-sessions";
import { notFound } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

/** Live per-connector runtime state (status/lock/active session) — backs the Lock and Cost screens. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  return NextResponse.json({ connectors: await listConnectorStates(id) });
}
