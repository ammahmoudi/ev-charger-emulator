import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { resetInstanceParametersToDefaults } from "@/lib/device-instances/maintenance";
import { serializeDeviceInstance } from "@/lib/device-instances/serialize";

/** "Restore Factory Setting" → Restore: resets the instance's parameters to the model's defaults. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await resetInstanceParametersToDefaults(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }

  return NextResponse.json({ instance: await serializeDeviceInstance(id) });
}
