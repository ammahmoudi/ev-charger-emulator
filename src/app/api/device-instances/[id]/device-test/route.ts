import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

import { badRequest, notFound } from "@/lib/device-instances/http";
import { getHardwareTestState, setChargingTestSettings } from "@/lib/device-instances/hardware-test-state";
import type { ChargingOutputMode } from "@/lib/device-instances/hardware-test-types";

const OUTPUT_MODES: ChargingOutputMode[] = ["FullLoadOutput", "HalfLoadOutput"];

/** Current state for the bottom-nav "Device" hardware test/diagnostics screen (issue #16). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    return NextResponse.json({ state: await getHardwareTestState(id) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }
}

interface UpdateSettingsBody {
  interfaceBoardTestMode?: unknown;
  outputMode?: unknown;
  selectedConnectorId?: unknown;
}

/** Updates the Charging Test tab's global settings: test mode, output mode, selected plug. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: UpdateSettingsBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  const updates: { interfaceBoardTestMode?: boolean; outputMode?: ChargingOutputMode; selectedConnectorId?: number } = {};

  if (body.interfaceBoardTestMode !== undefined) {
    if (typeof body.interfaceBoardTestMode !== "boolean") {
      return badRequest("interfaceBoardTestMode must be a boolean", "interfaceBoardTestMode");
    }
    updates.interfaceBoardTestMode = body.interfaceBoardTestMode;
  }
  if (body.outputMode !== undefined) {
    if (typeof body.outputMode !== "string" || !OUTPUT_MODES.includes(body.outputMode as ChargingOutputMode)) {
      return badRequest(`outputMode must be one of: ${OUTPUT_MODES.join(", ")}`, "outputMode");
    }
    updates.outputMode = body.outputMode as ChargingOutputMode;
  }
  if (body.selectedConnectorId !== undefined) {
    if (typeof body.selectedConnectorId !== "number") {
      return badRequest("selectedConnectorId must be a number", "selectedConnectorId");
    }
    updates.selectedConnectorId = body.selectedConnectorId;
  }

  try {
    return NextResponse.json({ state: await setChargingTestSettings(id, updates) });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    if (err instanceof Error && err.message.startsWith("Unknown connectorId")) {
      return badRequest(err.message, "selectedConnectorId");
    }
    throw err;
  }
}
