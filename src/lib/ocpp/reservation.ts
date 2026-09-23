import { OcppCallError } from "./errors";
import type { OcppChargePointSession } from "./session";
import type {
  OcppCancelReservationStatus,
  OcppReservation,
  OcppReservationStore,
  OcppReserveNowStatus,
} from "./remote-command-types";

/**
 * `setTimeout`'s delay is a 32-bit signed integer internally; a longer delay overflows and
 * fires almost immediately (silently) instead of respecting it. `expiryDate` is CSMS-supplied
 * and can legitimately be weeks or months out, so this re-arms the timer in
 * `MAX_TIMEOUT_MS`-sized chunks until the real expiry is reached.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface ReservationHandlers {
  handleReserveNow(payload: Record<string, unknown>): Promise<{ status: OcppReserveNowStatus }>;
  handleCancelReservation(payload: Record<string, unknown>): Promise<{ status: OcppCancelReservationStatus }>;
  /**
   * If `connectorId` is currently `Reserved` for `idTag` (or its `parentIdTag`), consumes
   * (removes) that reservation and returns `true` — used by `RemoteStartTransaction` handling
   * so a reservation can actually be redeemed instead of permanently blocking the connector.
   */
  consumeReservation(connectorId: number, idTag: string): Promise<boolean>;
  listReservations(): Promise<OcppReservation[]>;
  dispose(): void;
}

/** Default {@link OcppReservationStore}: an in-memory `Map`, used when no store is injected. */
function createInMemoryReservationStore(): OcppReservationStore {
  const reservations = new Map<number, OcppReservation>();
  return {
    async list() {
      return Array.from(reservations.values());
    },
    async get(reservationId) {
      return reservations.get(reservationId);
    },
    async set(reservation) {
      reservations.set(reservation.reservationId, reservation);
    },
    async delete(reservationId) {
      reservations.delete(reservationId);
    },
  };
}

/**
 * Registers `ReserveNow`/`CancelReservation` handling: tracks reservations with an expiry timer
 * that reverts the connector to `Available`, per the OCPP 1.6 `ReservationStatus` semantics
 * (`Faulted` for a faulted connector, `Occupied` for anything else non-`Available`, `Rejected`
 * for an unknown connector). `connectorId: 0` reserves any currently `Available` connector, per
 * the spec's `ReserveConnectorZeroSupported` behavior.
 *
 * Reservation *data* is delegated to `store` (in-memory by default; a caller may inject a
 * Prisma-backed one — see `OcppReservationStore`). The expiry *timer* is always kept here,
 * in-memory, regardless of store — it's runtime-only and isn't meaningful to persist.
 */
export function createReservationHandlers(
  session: OcppChargePointSession,
  store: OcppReservationStore = createInMemoryReservationStore(),
): ReservationHandlers {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  function clearTimer(reservationId: number): void {
    const timer = timers.get(reservationId);
    if (timer) {
      clearTimeout(timer);
      timers.delete(reservationId);
    }
  }

  function releaseConnectorIfReserved(connectorId: number): void {
    const info = session.getConnectorStatus(connectorId);
    if (info?.status === "Reserved") {
      session.setConnectorStatus(connectorId, "Available");
    }
  }

  async function removeReservation(reservationId: number): Promise<OcppReservation | undefined> {
    const reservation = await store.get(reservationId);
    if (!reservation) return undefined;
    clearTimer(reservationId);
    await store.delete(reservationId);
    return reservation;
  }

  async function expireReservation(reservationId: number): Promise<void> {
    const reservation = await store.get(reservationId);
    if (!reservation) return;
    timers.delete(reservationId);
    await store.delete(reservationId);
    releaseConnectorIfReserved(reservation.connectorId);
  }

  function scheduleExpiry(reservationId: number, expiryMs: number): void {
    const remainingMs = Math.max(0, expiryMs - Date.now());
    const timer =
      remainingMs > MAX_TIMEOUT_MS
        ? setTimeout(() => scheduleExpiry(reservationId, expiryMs), MAX_TIMEOUT_MS)
        : setTimeout(() => void expireReservation(reservationId), remainingMs);
    timers.set(reservationId, timer);
  }

  async function handleReserveNow(payload: Record<string, unknown>): Promise<{ status: OcppReserveNowStatus }> {
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

    await removeReservation(reservationId);
    await store.set({
      reservationId,
      connectorId: targetConnectorId,
      idTag,
      parentIdTag: typeof parentIdTag === "string" ? parentIdTag : undefined,
      expiryDate,
    });
    scheduleExpiry(reservationId, expiryMs);
    // Deferred so the ReserveNow.conf is always sent before the StatusNotification it triggers.
    setImmediate(() => session.setConnectorStatus(targetConnectorId, "Reserved"));
    return { status: "Accepted" };
  }

  async function handleCancelReservation(
    payload: Record<string, unknown>,
  ): Promise<{ status: OcppCancelReservationStatus }> {
    const { reservationId } = payload;
    if (typeof reservationId !== "number") {
      throw new OcppCallError("PropertyConstraintViolation", "reservationId is required");
    }
    const reservation = await removeReservation(reservationId);
    if (!reservation) return { status: "Rejected" };
    // Deferred so the CancelReservation.conf is always sent before the StatusNotification it triggers.
    setImmediate(() => releaseConnectorIfReserved(reservation.connectorId));
    return { status: "Accepted" };
  }

  async function consumeReservation(connectorId: number, idTag: string): Promise<boolean> {
    const all = await store.list();
    const reservation = all.find((r) => r.connectorId === connectorId);
    if (!reservation) return false;
    if (reservation.idTag !== idTag && reservation.parentIdTag !== idTag) return false;
    await removeReservation(reservation.reservationId);
    return true;
  }

  return {
    handleReserveNow,
    handleCancelReservation,
    consumeReservation,
    listReservations: () => store.list(),
    dispose: () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
