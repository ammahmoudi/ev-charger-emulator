import { NextResponse } from "next/server";

import { badRequest, isUniqueConstraintError, isValidWebSocketUrl } from "@/lib/device-instances/http";
import { ParameterValidationError, validateParameterValue } from "@/lib/device-instances/parameters";
import { listDeviceInstances, serializeDeviceInstance } from "@/lib/device-instances/serialize";
import { prisma } from "@/lib/prisma";

export async function GET() {
  return NextResponse.json({ instances: await listDeviceInstances() });
}

interface CreateInstanceBody {
  deviceModelId?: unknown;
  name?: unknown;
  chargePointId?: unknown;
  csmsUrl?: unknown;
  parameters?: unknown;
}

/** Creates a device instance from a model: identity + CSMS URL, seeded with the model's default parameter values (overridable). */
export async function POST(request: Request) {
  let body: CreateInstanceBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  const { deviceModelId, name, chargePointId, csmsUrl } = body;
  if (typeof deviceModelId !== "string" || !deviceModelId) return badRequest("deviceModelId is required");
  if (typeof name !== "string" || !name.trim()) return badRequest("name is required");
  if (typeof chargePointId !== "string" || !chargePointId.trim()) return badRequest("chargePointId is required");
  if (typeof csmsUrl !== "string" || !csmsUrl.trim()) return badRequest("csmsUrl is required");
  if (!isValidWebSocketUrl(csmsUrl)) return badRequest("csmsUrl must be a ws:// or wss:// URL", "csmsUrl");

  const overrides =
    body.parameters && typeof body.parameters === "object" ? (body.parameters as Record<string, unknown>) : {};

  const deviceModel = await prisma.deviceModel.findUnique({
    where: { id: deviceModelId },
    include: { parameters: true },
  });
  if (!deviceModel) return badRequest("Device model not found", "deviceModelId");

  let parameterInputs: { deviceModelParameterId: string; key: string; value: string | null }[];
  try {
    parameterInputs = deviceModel.parameters.map((parameter) => {
      const hasOverride = Object.prototype.hasOwnProperty.call(overrides, parameter.key);
      const raw = hasOverride ? overrides[parameter.key] : parameter.defaultValue;
      const value = validateParameterValue(parameter, raw === undefined || raw === null ? null : String(raw));
      return { deviceModelParameterId: parameter.id, key: parameter.key, value };
    });
  } catch (err) {
    if (err instanceof ParameterValidationError) return badRequest(err.message, err.key);
    throw err;
  }

  try {
    const instance = await prisma.deviceInstance.create({
      data: {
        deviceModelId,
        name: name.trim(),
        chargePointId: chargePointId.trim(),
        csmsUrl: csmsUrl.trim(),
        parameters: { create: parameterInputs },
      },
    });
    return NextResponse.json({ instance: await serializeDeviceInstance(instance.id) }, { status: 201 });
  } catch (err) {
    if (isUniqueConstraintError(err, "chargePointId")) {
      return NextResponse.json(
        { error: `chargePointId "${chargePointId}" is already in use`, field: "chargePointId" },
        { status: 409 },
      );
    }
    throw err;
  }
}
