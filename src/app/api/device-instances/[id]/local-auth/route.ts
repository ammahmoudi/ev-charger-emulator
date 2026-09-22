import { NextResponse } from "next/server";

import { badRequest, notFound } from "@/lib/device-instances/http";
import { listLocalAuthEntries, upsertLocalAuthEntry } from "@/lib/device-instances/local-auth";
import { prisma } from "@/lib/prisma";

async function assertInstanceExists(id: string): Promise<boolean> {
  const instance = await prisma.deviceInstance.findUnique({ where: { id }, select: { id: true } });
  return instance !== null;
}

/** Lists an instance's local authorization list/cache entries (see `local-auth.ts`). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await assertInstanceExists(id))) return notFound("Device instance not found");
  return NextResponse.json({ entries: await listLocalAuthEntries(id) });
}

interface PostBody {
  idTag?: unknown;
  status?: unknown;
  cacheExpiryDateTime?: unknown;
}

const VALID_STATUSES = ["ACCEPTED", "BLOCKED", "EXPIRED"] as const;

/**
 * Adds or updates one idTag's local-list/cache entry. Body: `{ idTag, status?, cacheExpiryDateTime? }`
 * (`status` defaults to `"ACCEPTED"`; `cacheExpiryDateTime` is an ISO string, or omitted/`null` for no expiry).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await assertInstanceExists(id))) return notFound("Device instance not found");

  let body: PostBody;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON");
  }

  if (typeof body.idTag !== "string" || !body.idTag.trim()) return badRequest("idTag is required", "idTag");
  const status = body.status === undefined ? "ACCEPTED" : body.status;
  if (typeof status !== "string" || !(VALID_STATUSES as readonly string[]).includes(status)) {
    return badRequest(`status must be one of: ${VALID_STATUSES.join(", ")}`, "status");
  }

  let cacheExpiryDateTime: Date | null = null;
  if (body.cacheExpiryDateTime !== undefined && body.cacheExpiryDateTime !== null) {
    if (typeof body.cacheExpiryDateTime !== "string") return badRequest("cacheExpiryDateTime must be an ISO date string", "cacheExpiryDateTime");
    const parsed = new Date(body.cacheExpiryDateTime);
    if (Number.isNaN(parsed.getTime())) return badRequest("cacheExpiryDateTime must be a valid date", "cacheExpiryDateTime");
    cacheExpiryDateTime = parsed;
  }

  const entry = await upsertLocalAuthEntry(id, body.idTag.trim(), status as (typeof VALID_STATUSES)[number], cacheExpiryDateTime);
  return NextResponse.json({ entry }, { status: 201 });
}
