import { NextResponse } from "next/server";

import { notFound } from "@/lib/device-instances/http";
import { listDeviceInstanceSessions } from "@/lib/device-instances/serialize";
import { prisma } from "@/lib/prisma";

/** Paginated session/cost history for an instance: `?page=1&pageSize=10`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const exists = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return notFound("Device instance not found");

  const url = new URL(request.url);
  const page = Number(url.searchParams.get("page") ?? "1") || 1;
  const pageSize = Number(url.searchParams.get("pageSize") ?? "10") || 10;

  const result = await listDeviceInstanceSessions(id, page, pageSize);
  return NextResponse.json(result);
}
