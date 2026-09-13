import { NextResponse } from "next/server";

import { badRequest, notFound } from "@/lib/device-instances/http";
import { getOverallHealth, OVERALL_HEALTH_FIELDS, setOverallHealthField, type OverallHealthField } from "@/lib/device-instances/diagnostics";
import { prisma } from "@/lib/prisma";

async function assertInstanceExists(id: string) {
  const instance = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  return instance !== null;
}

/** Top-level component health grid (issue #4) for an instance, simulated in-memory. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await assertInstanceExists(id))) return notFound("Device instance not found");
  return NextResponse.json({ overall: getOverallHealth(id) });
}

interface PatchBody {
  field?: unknown;
  value?: unknown;
}

/** Flips one overall-health field to "normal"/"abnormal" for fault-injection testing. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await assertInstanceExists(id))) return notFound("Device instance not found");

  let body: PatchBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  if (typeof body.field !== "string" || !OVERALL_HEALTH_FIELDS.includes(body.field as OverallHealthField)) {
    return badRequest(`field must be one of: ${OVERALL_HEALTH_FIELDS.join(", ")}`, "field");
  }
  if (body.value !== "normal" && body.value !== "abnormal") {
    return badRequest('value must be "normal" or "abnormal"', "value");
  }

  const overall = setOverallHealthField(id, body.field as OverallHealthField, body.value);
  return NextResponse.json({ overall });
}
