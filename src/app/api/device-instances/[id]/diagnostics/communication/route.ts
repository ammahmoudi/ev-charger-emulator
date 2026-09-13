import { NextResponse } from "next/server";

import { badRequest, notFound } from "@/lib/device-instances/http";
import { getCommunicationModules, getPlugOutputCurrent, setCommunicationModuleField } from "@/lib/device-instances/diagnostics";
import { prisma } from "@/lib/prisma";

async function assertInstanceExists(id: string) {
  const instance = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  return instance !== null;
}

/**
 * Per-module communication voltage/current grid (issue #4), simulated in-memory. Pass
 * `?connectorId=<id>` (repeatable) for each plug whose output current should be included.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await assertInstanceExists(id))) return notFound("Device instance not found");

  const connectorIds = new URL(request.url).searchParams.getAll("connectorId");
  const plugOutputCurrents: Record<string, number> = {};
  for (const connectorId of connectorIds) {
    plugOutputCurrents[connectorId] = getPlugOutputCurrent(id, connectorId);
  }

  return NextResponse.json({ modules: getCommunicationModules(id), plugOutputCurrents });
}

interface PatchBody {
  moduleIndex?: unknown;
  value?: unknown;
}

/** Flips one power module's comm-health flag ("G") for fault-injection testing. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await assertInstanceExists(id))) return notFound("Device instance not found");

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  if (typeof body.moduleIndex !== "number" || !Number.isInteger(body.moduleIndex)) {
    return badRequest("moduleIndex must be an integer", "moduleIndex");
  }
  if (body.value !== "normal" && body.value !== "abnormal") {
    return badRequest('value must be "normal" or "abnormal"', "value");
  }

  try {
    const modules = setCommunicationModuleField(id, body.moduleIndex, body.value);
    return NextResponse.json({ modules });
  } catch (err) {
    if (err instanceof RangeError) return badRequest(err.message, "moduleIndex");
    throw err;
  }
}
