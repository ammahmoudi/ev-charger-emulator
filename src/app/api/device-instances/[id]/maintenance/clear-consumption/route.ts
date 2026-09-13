import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { clearInstanceConsumptionRecord } from "@/lib/device-instances/maintenance";

/** "Consumption Record Clear": clears the instance's cost/session history. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const result = await clearInstanceConsumptionRecord(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return notFound("Device instance not found");
    }
    throw err;
  }
}
