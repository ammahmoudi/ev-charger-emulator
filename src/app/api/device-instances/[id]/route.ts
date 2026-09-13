import { NextResponse } from "next/server";

import { disposeDeviceInstance } from "@/lib/device-instances/runtime";
import { badRequest, isUniqueConstraintError, isValidWebSocketUrl, notFound } from "@/lib/device-instances/http";
import { ParameterValidationError, validateParameterValue } from "@/lib/device-instances/parameters";
import { serializeDeviceInstance } from "@/lib/device-instances/serialize";
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const instance = await serializeDeviceInstance(id);
  if (!instance) return notFound("Device instance not found");
  return NextResponse.json({ instance });
}

interface UpdateInstanceBody {
  name?: unknown;
  chargePointId?: unknown;
  csmsUrl?: unknown;
  parameters?: unknown;
}

/** Updates an instance's identity/CSMS URL and/or its parameter values. All fields optional; only supplied ones change. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.deviceInstance.findUnique({
    where: { id },
    include: { deviceModel: { include: { parameters: true } } },
  });
  if (!existing) return notFound("Device instance not found");

  let body: UpdateInstanceBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  const data: { name?: string; chargePointId?: string; csmsUrl?: string } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) return badRequest("name must be a non-empty string");
    data.name = body.name.trim();
  }
  if (body.chargePointId !== undefined) {
    if (typeof body.chargePointId !== "string" || !body.chargePointId.trim()) {
      return badRequest("chargePointId must be a non-empty string");
    }
    data.chargePointId = body.chargePointId.trim();
  }
  if (body.csmsUrl !== undefined) {
    if (typeof body.csmsUrl !== "string" || !isValidWebSocketUrl(body.csmsUrl)) {
      return badRequest("csmsUrl must be a ws:// or wss:// URL", "csmsUrl");
    }
    data.csmsUrl = body.csmsUrl.trim();
  }

  let parameterUpdates: { key: string; deviceModelParameterId: string; value: string | null }[] = [];
  if (body.parameters !== undefined) {
    if (typeof body.parameters !== "object" || body.parameters === null) {
      return badRequest("parameters must be an object");
    }
    const overrides = body.parameters as Record<string, unknown>;
    const parameterByKey = new Map(existing.deviceModel.parameters.map((p) => [p.key, p]));

    try {
      parameterUpdates = Object.entries(overrides).map(([key, raw]) => {
        const parameter = parameterByKey.get(key);
        if (!parameter) throw new ParameterValidationError(key, `Unknown parameter "${key}" for this device model`);
        const value = validateParameterValue(parameter, raw === undefined || raw === null ? null : String(raw));
        return { key, deviceModelParameterId: parameter.id, value };
      });
    } catch (err) {
      if (err instanceof ParameterValidationError) return badRequest(err.message, err.key);
      throw err;
    }
  }

  try {
    await prisma.$transaction([
      ...(Object.keys(data).length > 0 ? [prisma.deviceInstance.update({ where: { id }, data })] : []),
      ...parameterUpdates.map((update) =>
        prisma.deviceInstanceParameter.update({
          where: { deviceInstanceId_deviceModelParameterId: { deviceInstanceId: id, deviceModelParameterId: update.deviceModelParameterId } },
          data: { value: update.value },
        }),
      ),
    ]);
  } catch (err) {
    if (isUniqueConstraintError(err, "chargePointId")) {
      return NextResponse.json(
        { error: `chargePointId "${data.chargePointId}" is already in use`, field: "chargePointId" },
        { status: 409 },
      );
    }
    throw err;
  }

  return NextResponse.json({ instance: await serializeDeviceInstance(id) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const existing = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return notFound("Device instance not found");

  disposeDeviceInstance(id);
  await prisma.deviceInstance.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
