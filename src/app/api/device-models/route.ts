import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/** Lists device models available to create an instance from. */
export async function GET() {
  const deviceModels = await prisma.deviceModel.findMany({
    orderBy: [{ manufacturer: "asc" }, { model: "asc" }],
    select: {
      id: true,
      manufacturer: true,
      brand: true,
      model: true,
      ocppProtocol: true,
      description: true,
    },
  });

  return NextResponse.json({ deviceModels });
}
