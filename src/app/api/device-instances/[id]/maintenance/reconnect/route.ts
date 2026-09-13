import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { reconnectDeviceInstance } from "@/lib/device-instances/runtime";
import { serializeDeviceInstance } from "@/lib/device-instances/serialize";

/** "Restore Factory Setting" → OCPP: closes and re-establishes the instance's OCPP connection. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await reconnectDeviceInstance(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }

  return NextResponse.json({ instance: await serializeDeviceInstance(id) });
}
