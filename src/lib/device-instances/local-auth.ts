import type { LocalAuthEntryStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

/**
 * A device instance's local authorization list/cache (see `prisma/schema.prisma`'s
 * `DeviceInstanceLocalAuthEntry`) — idTags this charger can authorize on its own, without a live
 * CSMS round-trip, the same way `DeviceInstance.masterCardIdTag` always has. Populated either by
 * a future `SendLocalList` handler (the OCPP-layer owner's job) or by a cached `Authorize`
 * response, and consulted by `rfid.ts::presentRfidCard` before requiring a live connection.
 */
export interface LocalAuthEntryView {
  idTag: string;
  status: LocalAuthEntryStatus;
  cacheExpiryDateTime: string | null;
}

function toView(entry: { idTag: string; status: LocalAuthEntryStatus; cacheExpiryDateTime: Date | null }): LocalAuthEntryView {
  return {
    idTag: entry.idTag,
    status: entry.status,
    cacheExpiryDateTime: entry.cacheExpiryDateTime?.toISOString() ?? null,
  };
}

/** Lists every local-list/cache entry for an instance, most recently updated first. */
export async function listLocalAuthEntries(deviceInstanceId: string): Promise<LocalAuthEntryView[]> {
  const entries = await prisma.deviceInstanceLocalAuthEntry.findMany({
    where: { deviceInstanceId },
    orderBy: { updatedAt: "desc" },
  });
  return entries.map(toView);
}

/** Adds or updates one idTag's local-list/cache entry (e.g. from a `SendLocalList` update or a cached `Authorize` response). */
export async function upsertLocalAuthEntry(
  deviceInstanceId: string,
  idTag: string,
  status: LocalAuthEntryStatus,
  cacheExpiryDateTime: Date | null = null,
): Promise<LocalAuthEntryView> {
  const entry = await prisma.deviceInstanceLocalAuthEntry.upsert({
    where: { deviceInstanceId_idTag: { deviceInstanceId, idTag } },
    create: { deviceInstanceId, idTag, status, cacheExpiryDateTime },
    update: { status, cacheExpiryDateTime },
  });
  return toView(entry);
}

/** Removes one idTag from an instance's local list/cache, if present. */
export async function removeLocalAuthEntry(deviceInstanceId: string, idTag: string): Promise<void> {
  await prisma.deviceInstanceLocalAuthEntry.deleteMany({ where: { deviceInstanceId, idTag } });
}

/**
 * Looks up whether `idTag` can be authorized locally right now: present, `ACCEPTED`, and not
 * past its `cacheExpiryDateTime` (an expired entry behaves as absent — a real charger falls back
 * to a live `Authorize` for it rather than granting a stale local decision).
 */
export async function lookupLocalAuthEntry(deviceInstanceId: string, idTag: string, now: Date = new Date()): Promise<LocalAuthEntryView | null> {
  const entry = await prisma.deviceInstanceLocalAuthEntry.findUnique({
    where: { deviceInstanceId_idTag: { deviceInstanceId, idTag } },
  });
  if (!entry) return null;
  if (entry.status !== "ACCEPTED") return null;
  if (entry.cacheExpiryDateTime && entry.cacheExpiryDateTime.getTime() <= now.getTime()) return null;
  return toView(entry);
}
