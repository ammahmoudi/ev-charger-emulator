import { OcppCallError } from "./errors";
import type {
  OcppChargingProfileEntry,
  OcppChargingProfileStore,
  OcppClearChargingProfileStatus,
  OcppSetChargingProfileStatus,
} from "./remote-command-types";

const VALID_PURPOSES = new Set(["ChargePointMaxProfile", "TxDefaultProfile", "TxProfile"]);
const VALID_KINDS = new Set(["Absolute", "Recurring", "Relative"]);
const VALID_RATE_UNITS = new Set(["A", "W"]);

/** Validates the required shape of a `csChargingProfiles`/`chargingProfile` object, per the OCPP 1.6 schema. */
function isValidChargingProfile(profile: unknown): profile is Record<string, unknown> {
  if (!profile || typeof profile !== "object") return false;
  const p = profile as Record<string, unknown>;
  if (typeof p.chargingProfileId !== "number") return false;
  if (typeof p.stackLevel !== "number") return false;
  if (typeof p.chargingProfilePurpose !== "string" || !VALID_PURPOSES.has(p.chargingProfilePurpose)) return false;
  if (typeof p.chargingProfileKind !== "string" || !VALID_KINDS.has(p.chargingProfileKind)) return false;

  const schedule = p.chargingSchedule;
  if (!schedule || typeof schedule !== "object") return false;
  const s = schedule as Record<string, unknown>;
  if (typeof s.chargingRateUnit !== "string" || !VALID_RATE_UNITS.has(s.chargingRateUnit)) return false;
  if (!Array.isArray(s.chargingSchedulePeriod) || s.chargingSchedulePeriod.length === 0) return false;
  return s.chargingSchedulePeriod.every(
    (period) =>
      period && typeof period === "object" && typeof (period as Record<string, unknown>).startPeriod === "number",
  );
}

export interface ChargingProfileHandlers {
  handleSetChargingProfile(payload: Record<string, unknown>): Promise<{ status: OcppSetChargingProfileStatus }>;
  handleClearChargingProfile(payload: Record<string, unknown>): Promise<{ status: OcppClearChargingProfileStatus }>;
  /** Best-effort store of a profile without the CALLERROR-throwing validation (used for `RemoteStartTransaction.chargingProfile`). */
  tryStoreProfile(connectorId: number, profile: unknown): Promise<void>;
  listChargingProfiles(connectorId?: number): Promise<OcppChargingProfileEntry[]>;
}

/** Default {@link OcppChargingProfileStore}: an in-memory `Map`, used when no store is injected. */
function createInMemoryChargingProfileStore(): OcppChargingProfileStore {
  const profiles = new Map<number, OcppChargingProfileEntry>();
  return {
    async list() {
      return Array.from(profiles.values());
    },
    async set(chargingProfileId, entry) {
      profiles.set(chargingProfileId, entry);
    },
    async delete(chargingProfileId) {
      profiles.delete(chargingProfileId);
    },
  };
}

/**
 * Registers `SetChargingProfile`/`ClearChargingProfile` handling: validates profiles (per the
 * OCPP 1.6 `SetChargingProfile`/`ClearChargingProfile` schemas) and delegates storage (keyed by
 * `chargingProfileId`) to `store` (in-memory by default; a caller may inject a Prisma-backed one
 * — see `OcppChargingProfileStore`). `ClearChargingProfile`'s `id`/`connectorId`/
 * `chargingProfilePurpose`/`stackLevel` filtering happens here, over the store's full list, so
 * every store implementation only needs plain list/set/delete.
 */
export function createChargingProfileHandlers(
  isKnownConnectorId: (connectorId: number) => boolean,
  store: OcppChargingProfileStore = createInMemoryChargingProfileStore(),
): ChargingProfileHandlers {
  async function storeProfile(connectorId: number, profile: Record<string, unknown>): Promise<void> {
    await store.set(profile.chargingProfileId as number, { connectorId, profile });
  }

  async function handleSetChargingProfile(
    payload: Record<string, unknown>,
  ): Promise<{ status: OcppSetChargingProfileStatus }> {
    const { connectorId, csChargingProfiles } = payload;
    if (typeof connectorId !== "number") {
      throw new OcppCallError("PropertyConstraintViolation", "connectorId is required");
    }
    if (connectorId !== 0 && !isKnownConnectorId(connectorId)) {
      return { status: "Rejected" };
    }
    if (!isValidChargingProfile(csChargingProfiles)) {
      throw new OcppCallError("PropertyConstraintViolation", "csChargingProfiles is missing required fields");
    }
    if (csChargingProfiles.chargingProfilePurpose === "TxProfile" && connectorId === 0) {
      // TxProfile must target a specific connector/transaction, per spec.
      return { status: "Rejected" };
    }

    await storeProfile(connectorId, csChargingProfiles);
    return { status: "Accepted" };
  }

  async function handleClearChargingProfile(
    payload: Record<string, unknown>,
  ): Promise<{ status: OcppClearChargingProfileStatus }> {
    const id = typeof payload.id === "number" ? payload.id : undefined;
    const connectorId = typeof payload.connectorId === "number" ? payload.connectorId : undefined;
    const purpose = typeof payload.chargingProfilePurpose === "string" ? payload.chargingProfilePurpose : undefined;
    const stackLevel = typeof payload.stackLevel === "number" ? payload.stackLevel : undefined;

    const all = await store.list();
    let removed = 0;
    for (const entry of all) {
      const entryId = entry.profile.chargingProfileId as number;
      if (id !== undefined && entryId !== id) continue;
      if (connectorId !== undefined && entry.connectorId !== connectorId) continue;
      if (purpose !== undefined && entry.profile.chargingProfilePurpose !== purpose) continue;
      if (stackLevel !== undefined && entry.profile.stackLevel !== stackLevel) continue;
      await store.delete(entryId);
      removed += 1;
    }
    return { status: removed > 0 ? "Accepted" : "Unknown" };
  }

  return {
    handleSetChargingProfile,
    handleClearChargingProfile,
    tryStoreProfile: async (connectorId, profile) => {
      if (isValidChargingProfile(profile)) await storeProfile(connectorId, profile);
    },
    listChargingProfiles: async (connectorId) => {
      const all = await store.list();
      return connectorId === undefined ? all : all.filter((entry) => entry.connectorId === connectorId);
    },
  };
}
