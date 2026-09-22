import { OcppCallError } from "./errors";
import type { OcppChargePointSession } from "./session";
import type { OcppCancelReservationStatus, OcppReservation, OcppReserveNowStatus } from "./remote-command-types";

interface TrackedReservation extends OcppReservation {
  timer: ReturnType<typeof setTimeout>;
}

/**
 * `setTimeout`'s delay is a 32-bit signed integer internally; a longer delay overflows and
 * fires almost immediately (silently) instead of respecting it. `expiryDate` is CSMS-supplied
 * and can legitimately be weeks or months out, so this re-arms the timer in
 * `MAX_TIMEOUT_MS`-sized chunks until the real expiry is reached.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface ReservationHandlers {
  handleReserveNow(payload: Record<string, unknown>): { status: OcppReserveNowStatus };
  handleCancelReservation(payload: Record<string, unknown>): { status: OcppCancelReservationStatus };
  /**
   * If `connectorId` is currently `Reserved` for `idTag` (or its `parentIdTag`), consumes
   * (removes) that reservation and returns `true` — used by `RemoteStartTransaction` handling
   * so a reservation can actually be redeemed instead of permanently blocking the connector.
   */
  consumeReservation(connectorId: number, idTag: string): boolean;
  listReservations(): OcppReservation[];
  dispose(): void;
}

/**
 * Registers `ReserveNow`/`CancelReservation` handling: tracks reservations with an expiry timer
 * that reverts the connector to `Available`, per the OCPP 1.6 `ReservationStatus` semantics
 * (`Faulted` for a faulted connector, `Occupied` for anything else non-`Available`, `Rejected`
 * for an unknown connector). `connectorId: 0` reserves any currently `Available` connector, per
 * the spec's `ReserveConnectorZeroSupported` behavior.
 */
export function createReservationHandlers(session: OcppChargePointSession): ReservationHandlers {
  const reservations = new Map<number, TrackedReservation>();

  function toPublic(reservation: TrackedReservation): OcppReservation {
    return {
      reservationId: reservation.reservationId,
      connectorId: reservation.connectorId,
      idTag: reservation.idTag,
      parentIdTag: reservation.parentIdTag,
      expiryDate: reservation.expiryDate,
    };
  }

  function releaseConnectorIfReserved(connectorId: number): void {
    const info = session.getConnectorStatus(connectorId);
    if (info?.status === "Reserved") {
      session.setConnectorStatus(connectorId, "Available");
    }
  }

  function removeReservation(reservationId: number): TrackedReservation | undefined {
    const reservation = reservations.get(reservationId);
    if (!reservation) return undefined;
    clearTimeout(reservation.timer);
    reservations.delete(reservationId);
    return reservation;
  }

  function expireReservation(reservationId: number): void {
    const reservation = reservations.get(reservationId);
    if (!reservation) return;
    reservations.delete(reservationId);
    releaseConnectorIfReserved(reservation.connectorId);
  }

  function scheduleExpiry(reservationId: number, expiryMs: number): ReturnType<typeof setTimeout> {
    const remainingMs = Math.max(0, expiryMs - Date.now());
    if (remainingMs > MAX_TIMEOUT_MS) {
      return setTimeout(() => {
        const reservation = reservations.get(reservationId);
        if (!reservation) return;
        reservation.timer = scheduleExpiry(reservationId, expiryMs);
      }, MAX_TIMEOUT_MS);
    }
    return setTimeout(() => expireReservation(reservationId), remainingMs);
  }

  function handleReserveNow(payload: Record<string, unknown>): { status: OcppReserveNowStatus } {
    const { connectorId, expiryDate, idTag, reservationId, parentIdTag } = payload;
    if (
      typeof connectorId !== "number" ||
      typeof expiryDate !== "string" ||
      typeof idTag !== "string" ||
      typeof reservationId !== "number"
    ) {
      throw new OcppCallError(
        "PropertyConstraintViolation",
        "connectorId, expiryDate, idTag, and reservationId are required",
      );
    }
    const expiryMs = Date.parse(expiryDate);
    if (Number.isNaN(expiryMs)) {
      throw new OcppCallError("PropertyConstraintViolation", "expiryDate must be a valid ISO 8601 timestamp");
    }

    let targetConnectorId: number;
    if (connectorId === 0) {
      const available = session.listConnectorStatuses().find((info) => info.status === "Available");
      if (!available) return { status: "Occupied" };
      targetConnectorId = available.connectorId;
    } else {
      const info = session.getConnectorStatus(connectorId);
      if (!info) return { status: "Rejected" };
      if (info.status === "Faulted") return { status: "Faulted" };
      if (info.status !== "Available") return { status: "Occupied" };
      targetConnectorId = connectorId;
    }

    removeReservation(reservationId);
    const timer = scheduleExpiry(reservationId, expiryMs);
    reservations.set(reservationId, {
      reservationId,
      connectorId: targetConnectorId,
      idTag,
      parentIdTag: typeof parentIdTag === "string" ? parentIdTag : undefined,
      expiryDate,
      timer,
    });
    // Deferred so the ReserveNow.conf is always sent before the StatusNotification it triggers.
    setImmediate(() => session.setConnectorStatus(targetConnectorId, "Reserved"));
    return { status: "Accepted" };
  }

  function handleCancelReservation(payload: Record<string, unknown>): { status: OcppCancelReservationStatus } {
    const { reservationId } = payload;
    if (typeof reservationId !== "number") {
      throw new OcppCallError("PropertyConstraintViolation", "reservationId is required");
    }
    const reservation = removeReservation(reservationId);
    if (!reservation) return { status: "Rejected" };
    // Deferred so the CancelReservation.conf is always sent before the StatusNotification it triggers.
    setImmediate(() => releaseConnectorIfReserved(reservation.connectorId));
    return { status: "Accepted" };
  }

  function consumeReservation(connectorId: number, idTag: string): boolean {
    const reservation = Array.from(reservations.values()).find((r) => r.connectorId === connectorId);
    if (!reservation) return false;
    if (reservation.idTag !== idTag && reservation.parentIdTag !== idTag) return false;
    removeReservation(reservation.reservationId);
    return true;
  }

  return {
    handleReserveNow,
    handleCancelReservation,
    consumeReservation,
    listReservations: () => Array.from(reservations.values()).map(toPublic),
    dispose: () => {
      for (const reservation of reservations.values()) clearTimeout(reservation.timer);
      reservations.clear();
    },
  };
}
