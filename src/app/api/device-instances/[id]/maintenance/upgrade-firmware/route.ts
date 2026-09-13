import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { startFirmwareUpgrade } from "@/lib/device-instances/maintenance";

/**
 * "Upgrade Board Program": simulates a firmware upgrade. Connector(s) go Unavailable
 * immediately; poll GET /maintenance to see them return to Available with the firmware
 * version bumped once the simulated upgrade completes.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const state = await startFirmwareUpgrade(id);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }
}
