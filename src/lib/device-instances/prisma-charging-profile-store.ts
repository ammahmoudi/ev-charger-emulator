import { Prisma } from "@prisma/client";

import type { OcppChargingProfileEntry, OcppChargingProfileStore } from "@/lib/ocpp";
import { prisma } from "@/lib/prisma";

/**
 * `OcppChargingProfileStore` backed by `DeviceInstanceChargingProfile` — so `SetChargingProfile`
 * profiles survive a restart instead of `src/lib/ocpp/charging-profile.ts`'s in-memory-only
 * default. `ClearChargingProfile`'s id/connectorId/purpose/stackLevel filtering logic stays in
 * that file, operating over whatever `list()` returns here.
 */
export class PrismaChargingProfileStore implements OcppChargingProfileStore {
  constructor(private readonly deviceInstanceId: string) {}

  async list(): Promise<OcppChargingProfileEntry[]> {
    const rows = await prisma.deviceInstanceChargingProfile.findMany({ where: { deviceInstanceId: this.deviceInstanceId } });
    return rows.map((row) => ({
      connectorId: row.connectorId,
      profile: row.profile as Record<string, unknown>,
    }));
  }

  async set(chargingProfileId: number, entry: OcppChargingProfileEntry): Promise<void> {
    await prisma.deviceInstanceChargingProfile.upsert({
      where: { deviceInstanceId_chargingProfileId: { deviceInstanceId: this.deviceInstanceId, chargingProfileId } },
      create: {
        deviceInstanceId: this.deviceInstanceId,
        chargingProfileId,
        connectorId: entry.connectorId,
        profile: entry.profile as Prisma.InputJsonValue,
      },
      update: { connectorId: entry.connectorId, profile: entry.profile as Prisma.InputJsonValue },
    });
  }

  async delete(chargingProfileId: number): Promise<void> {
    await prisma.deviceInstanceChargingProfile.deleteMany({
      where: { deviceInstanceId: this.deviceInstanceId, chargingProfileId },
    });
  }
}
