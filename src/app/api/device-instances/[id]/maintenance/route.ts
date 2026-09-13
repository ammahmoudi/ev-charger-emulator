import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { getMaintenanceState } from "@/lib/device-instances/maintenance";
import { notFound } from "@/lib/device-instances/http";

/** Maintenance-tab state: firmware version, live connector availability, and event/cost record counts. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const state = await getMaintenanceState(id);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }
}
