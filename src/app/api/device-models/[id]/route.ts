import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

/** Returns one device model with its connectors and full parameter schema, used to drive the "new instance" form. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const deviceModel = await prisma.deviceModel.findUnique({
    where: { id },
    include: {
      connectors: { orderBy: [{ evseIndex: "asc" }, { connectorIndex: "asc" }] },
      parameters: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!deviceModel) {
    return NextResponse.json({ error: "Device model not found" }, { status: 404 });
  }

  return NextResponse.json({ deviceModel });
}
