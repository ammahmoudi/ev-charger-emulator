import { OcppCallError } from "./errors";
import type {
  OcppChargingProfileEntry,
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
  handleSetChargingProfile(payload: Record<string, unknown>): { status: OcppSetChargingProfileStatus };
  handleClearChargingProfile(payload: Record<string, unknown>): { status: OcppClearChargingProfileStatus };
  /** Best-effort store of a profile without the CALLERROR-throwing validation (used for `RemoteStartTransaction.chargingProfile`). */
  tryStoreProfile(connectorId: number, profile: unknown): void;
  listChargingProfiles(connectorId?: number): OcppChargingProfileEntry[];
}

/**
 * Registers `SetChargingProfile`/`ClearChargingProfile` handling: validates and stores profiles
 * keyed by `chargingProfileId` (per the OCPP 1.6 `SetChargingProfile`/`ClearChargingProfile`
 * schemas), and supports `ClearChargingProfile`'s optional `id`/`connectorId`/
 * `chargingProfilePurpose`/`stackLevel` filters. Stored profiles aren't yet fed back into the
 * simulated charge rate — see `AUDIT-ocpp.md`'s "known limitations".
 */
export function createChargingProfileHandlers(isKnownConnectorId: (connectorId: number) => boolean): ChargingProfileHandlers {
  const profiles = new Map<number, OcppChargingProfileEntry>();

  function storeProfile(connectorId: number, profile: Record<string, unknown>): void {
    profiles.set(profile.chargingProfileId as number, { connectorId, profile });
  }

  function handleSetChargingProfile(payload: Record<string, unknown>): { status: OcppSetChargingProfileStatus } {
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

    storeProfile(connectorId, csChargingProfiles);
    return { status: "Accepted" };
  }

  function handleClearChargingProfile(payload: Record<string, unknown>): { status: OcppClearChargingProfileStatus } {
    const id = typeof payload.id === "number" ? payload.id : undefined;
    const connectorId = typeof payload.connectorId === "number" ? payload.connectorId : undefined;
    const purpose = typeof payload.chargingProfilePurpose === "string" ? payload.chargingProfilePurpose : undefined;
    const stackLevel = typeof payload.stackLevel === "number" ? payload.stackLevel : undefined;

    let removed = 0;
    for (const [key, entry] of profiles) {
      if (id !== undefined && key !== id) continue;
      if (connectorId !== undefined && entry.connectorId !== connectorId) continue;
      if (purpose !== undefined && entry.profile.chargingProfilePurpose !== purpose) continue;
      if (stackLevel !== undefined && entry.profile.stackLevel !== stackLevel) continue;
      profiles.delete(key);
      removed += 1;
    }
    return { status: removed > 0 ? "Accepted" : "Unknown" };
  }

  return {
    handleSetChargingProfile,
    handleClearChargingProfile,
    tryStoreProfile: (connectorId, profile) => {
      if (isValidChargingProfile(profile)) storeProfile(connectorId, profile);
    },
    listChargingProfiles: (connectorId) =>
      Array.from(profiles.values()).filter((entry) => connectorId === undefined || entry.connectorId === connectorId),
  };
}
