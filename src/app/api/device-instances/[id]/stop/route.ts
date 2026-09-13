import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { stopDeviceInstance } from "@/lib/device-instances/runtime";
import { serializeDeviceInstance } from "@/lib/device-instances/serialize";
import { Prisma } from "@prisma/client";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await stopDeviceInstance(id);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }

  return NextResponse.json({ instance: await serializeDeviceInstance(id) });
}
