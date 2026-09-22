import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { removeLocalAuthEntry } from "@/lib/device-instances/local-auth";
import { prisma } from "@/lib/prisma";

/** Removes one idTag from an instance's local authorization list/cache. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; idTag: string }> }) {
  const { id, idTag } = await params;
  const instance = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!instance) return notFound("Device instance not found");

  await removeLocalAuthEntry(id, idTag);
  return new NextResponse(null, { status: 204 });
}
