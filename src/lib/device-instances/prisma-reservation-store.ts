import type { OcppReservation, OcppReservationStore } from "@/lib/ocpp";
import { prisma } from "@/lib/prisma";

/**
 * `OcppReservationStore` backed by `DeviceInstanceReservation` — so a `ReserveNow` reservation
 * survives a restart instead of `src/lib/ocpp/reservation.ts`'s in-memory-only default. The
 * expiry *timer* itself stays runtime-only regardless (see that file's docstring); this round
 * doesn't re-arm timers for rows still valid at startup (flagged in AUDIT-state.md's round-2
 * addendum as a follow-up).
 */
export class PrismaReservationStore implements OcppReservationStore {
  constructor(private readonly deviceInstanceId: string) {}

  async list(): Promise<OcppReservation[]> {
    const rows = await prisma.deviceInstanceReservation.findMany({ where: { deviceInstanceId: this.deviceInstanceId } });
    return rows.map(toOcppReservation);
  }

  async get(reservationId: number): Promise<OcppReservation | undefined> {
    const row = await prisma.deviceInstanceReservation.findUnique({
      where: { deviceInstanceId_reservationId: { deviceInstanceId: this.deviceInstanceId, reservationId } },
    });
    return row ? toOcppReservation(row) : undefined;
  }

  async set(reservation: OcppReservation): Promise<void> {
    await prisma.deviceInstanceReservation.upsert({
      where: {
        deviceInstanceId_reservationId: { deviceInstanceId: this.deviceInstanceId, reservationId: reservation.reservationId },
      },
      create: {
        deviceInstanceId: this.deviceInstanceId,
        reservationId: reservation.reservationId,
        connectorId: reservation.connectorId,
        idTag: reservation.idTag,
        parentIdTag: reservation.parentIdTag ?? null,
        expiryDate: new Date(reservation.expiryDate),
      },
      update: {
        connectorId: reservation.connectorId,
        idTag: reservation.idTag,
        parentIdTag: reservation.parentIdTag ?? null,
        expiryDate: new Date(reservation.expiryDate),
      },
    });
  }

  async delete(reservationId: number): Promise<void> {
    await prisma.deviceInstanceReservation.deleteMany({
      where: { deviceInstanceId: this.deviceInstanceId, reservationId },
    });
  }
}

function toOcppReservation(row: {
  reservationId: number;
  connectorId: number;
  idTag: string;
  parentIdTag: string | null;
  expiryDate: Date;
}): OcppReservation {
  return {
    reservationId: row.reservationId,
    connectorId: row.connectorId,
    idTag: row.idTag,
    parentIdTag: row.parentIdTag ?? undefined,
    expiryDate: row.expiryDate.toISOString(),
  };
}
