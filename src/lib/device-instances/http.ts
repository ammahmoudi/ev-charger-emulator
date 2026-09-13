import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export function badRequest(message: string, field?: string) {
  return NextResponse.json({ error: message, field }, { status: 400 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: message }, { status: 404 });
}

/** True if `err` is a Prisma unique-constraint violation (P2002) on the given field. */
export function isUniqueConstraintError(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === "P2002" &&
    Array.isArray(err.meta?.target) &&
    (err.meta.target as string[]).includes(field)
  );
}

/** True if `err` is a Prisma "record not found" error (P2025), e.g. from update()/delete() on a missing row. */
export function isRecordNotFoundError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
}

export function isValidWebSocketUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "ws:" || url.protocol === "wss:";
  } catch {
    return false;
  }
}
