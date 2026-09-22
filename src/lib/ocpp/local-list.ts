import { OcppCallError } from "./errors";
import type { OcppLocalListEntry, OcppIdTagInfo, OcppSendLocalListStatus } from "./remote-command-types";

/** Matches the `SendLocalListMaxLength` value this module advertises via configuration. */
export const MAX_LOCAL_LIST_ENTRIES = 500;

interface RawLocalListEntry {
  idTag: string;
  idTagInfo?: OcppIdTagInfo;
}

function isRawLocalListEntry(value: unknown): value is RawLocalListEntry {
  return !!value && typeof value === "object" && typeof (value as Record<string, unknown>).idTag === "string";
}

export interface LocalAuthListHandlers {
  handleSendLocalList(payload: Record<string, unknown>): { status: OcppSendLocalListStatus };
  handleGetLocalListVersion(): { listVersion: number };
  getVersion(): number;
  listEntries(): OcppLocalListEntry[];
}

/**
 * Registers `SendLocalList`/`GetLocalListVersion` handling. Maintains a version counter plus an
 * idTag→idTagInfo map: `Full` replaces the whole list, `Differential` upserts/removes individual
 * entries (an entry with no `idTagInfo` means "remove", per spec). `VersionMismatch` is returned
 * whenever `listVersion` doesn't advance past the current version, matching the CSMS-side
 * expectation (per CitrineOS) that it falls back to a `Full` update after seeing that status.
 */
export function createLocalAuthListHandlers(): LocalAuthListHandlers {
  let version = 0;
  const entries = new Map<string, OcppIdTagInfo>();

  function handleSendLocalList(payload: Record<string, unknown>): { status: OcppSendLocalListStatus } {
    const { listVersion, updateType } = payload;
    if (typeof listVersion !== "number" || (updateType !== "Full" && updateType !== "Differential")) {
      throw new OcppCallError("PropertyConstraintViolation", "listVersion and updateType are required");
    }
    const rawList = Array.isArray(payload.localAuthorizationList) ? payload.localAuthorizationList : [];

    if (listVersion <= version) {
      return { status: "VersionMismatch" };
    }
    if (rawList.length > MAX_LOCAL_LIST_ENTRIES) {
      return { status: "Failed" };
    }
    if (updateType === "Differential" && version === 0 && entries.size === 0) {
      // Nothing to diff against yet — a real Charge Point requires a Full list first.
      return { status: "Failed" };
    }
    if (!rawList.every(isRawLocalListEntry)) {
      return { status: "Failed" };
    }
    if (updateType === "Full" && !rawList.every((entry) => entry.idTagInfo)) {
      return { status: "Failed" };
    }

    if (updateType === "Full") {
      entries.clear();
    }
    for (const entry of rawList as RawLocalListEntry[]) {
      if (entry.idTagInfo) {
        entries.set(entry.idTag, entry.idTagInfo);
      } else {
        entries.delete(entry.idTag);
      }
    }

    version = listVersion;
    return { status: "Accepted" };
  }

  return {
    handleSendLocalList,
    handleGetLocalListVersion: () => ({ listVersion: version }),
    getVersion: () => version,
    listEntries: () => Array.from(entries.entries()).map(([idTag, idTagInfo]) => ({ idTag, idTagInfo })),
  };
}
