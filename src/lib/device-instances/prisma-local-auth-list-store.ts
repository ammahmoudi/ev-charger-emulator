import type { LocalAuthEntryStatus } from "@prisma/client";

import type { OcppIdTagInfo, OcppIdTagStatus, OcppLocalAuthListStore, OcppLocalListEntry } from "@/lib/ocpp";
import { prisma } from "@/lib/prisma";

/**
 * `OcppLocalAuthListStore` backed by `DeviceInstanceLocalAuthEntry` (plus
 * `DeviceInstance.localAuthListVersion` for the version counter) — so `SendLocalList`/
 * `GetLocalListVersion` state survives a restart instead of `src/lib/ocpp/local-list.ts`'s
 * in-memory-only default. Shares its table with `local-auth.ts`'s simpler lookup API (used by
 * `rfid.ts`) — both are the same underlying concept (a real charger's local authorization list)
 * reached from two directions: a CSMS pushing entries via `SendLocalList` (this store) and the
 * RFID-simulation flow checking them (`local-auth.ts::lookupLocalAuthEntry`). `LocalAuthEntryStatus`'s
 * members match `OcppIdTagStatus`'s 1:1 (just SCREAMING_CASE vs. PascalCase, per this file's other
 * enums' convention), so the mapping between them (`toLocalAuthEntryStatus`/`toOcppIdTagStatus`
 * below) is a lossless, total, symmetric relabeling — never a partial/lossy conversion.
 */
export class PrismaLocalAuthListStore implements OcppLocalAuthListStore {
  constructor(private readonly deviceInstanceId: string) {}

  async getVersion(): Promise<number> {
    const instance = await prisma.deviceInstance.findUnique({
      where: { id: this.deviceInstanceId },
      select: { localAuthListVersion: true },
    });
    return instance?.localAuthListVersion ?? 0;
  }

  async setVersion(version: number): Promise<void> {
    await prisma.deviceInstance.update({
      where: { id: this.deviceInstanceId },
      data: { localAuthListVersion: version },
    });
  }

  async listEntries(): Promise<OcppLocalListEntry[]> {
    const rows = await prisma.deviceInstanceLocalAuthEntry.findMany({ where: { deviceInstanceId: this.deviceInstanceId } });
    return rows.map(toOcppLocalListEntry);
  }

  async setEntry(idTag: string, idTagInfo: OcppIdTagInfo): Promise<void> {
    const status = toLocalAuthEntryStatus(idTagInfo.status);
    const cacheExpiryDateTime = idTagInfo.expiryDate ? new Date(idTagInfo.expiryDate) : null;
    await prisma.deviceInstanceLocalAuthEntry.upsert({
      where: { deviceInstanceId_idTag: { deviceInstanceId: this.deviceInstanceId, idTag } },
      create: {
        deviceInstanceId: this.deviceInstanceId,
        idTag,
        status,
        cacheExpiryDateTime,
        parentIdTag: idTagInfo.parentIdTag ?? null,
      },
      update: { status, cacheExpiryDateTime, parentIdTag: idTagInfo.parentIdTag ?? null },
    });
  }

  async deleteEntry(idTag: string): Promise<void> {
    await prisma.deviceInstanceLocalAuthEntry.deleteMany({ where: { deviceInstanceId: this.deviceInstanceId, idTag } });
  }

  async clearEntries(): Promise<void> {
    await prisma.deviceInstanceLocalAuthEntry.deleteMany({ where: { deviceInstanceId: this.deviceInstanceId } });
  }
}

function toOcppLocalListEntry(row: {
  idTag: string;
  status: LocalAuthEntryStatus;
  cacheExpiryDateTime: Date | null;
  parentIdTag: string | null;
}): OcppLocalListEntry {
  return {
    idTag: row.idTag,
    idTagInfo: {
      status: toOcppIdTagStatus(row.status),
      expiryDate: row.cacheExpiryDateTime?.toISOString(),
      parentIdTag: row.parentIdTag ?? undefined,
    },
  };
}

const STATUS_TO_LOCAL_AUTH_ENTRY: Record<OcppIdTagStatus, LocalAuthEntryStatus> = {
  Accepted: "ACCEPTED",
  Blocked: "BLOCKED",
  Expired: "EXPIRED",
  Invalid: "INVALID",
  ConcurrentTx: "CONCURRENT_TX",
};

function toLocalAuthEntryStatus(status: OcppIdTagStatus): LocalAuthEntryStatus {
  return STATUS_TO_LOCAL_AUTH_ENTRY[status];
}

const LOCAL_AUTH_ENTRY_TO_STATUS: Record<LocalAuthEntryStatus, OcppIdTagStatus> = {
  ACCEPTED: "Accepted",
  BLOCKED: "Blocked",
  EXPIRED: "Expired",
  INVALID: "Invalid",
  CONCURRENT_TX: "ConcurrentTx",
};

function toOcppIdTagStatus(status: LocalAuthEntryStatus): OcppIdTagStatus {
  return LOCAL_AUTH_ENTRY_TO_STATUS[status];
}
