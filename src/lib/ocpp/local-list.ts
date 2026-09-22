import { OcppCallError } from "./errors";
import type {
  OcppIdTagInfo,
  OcppLocalAuthListStore,
  OcppLocalListEntry,
  OcppSendLocalListStatus,
} from "./remote-command-types";

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
  handleSendLocalList(payload: Record<string, unknown>): Promise<{ status: OcppSendLocalListStatus }>;
  handleGetLocalListVersion(): Promise<{ listVersion: number }>;
  getVersion(): Promise<number>;
  listEntries(): Promise<OcppLocalListEntry[]>;
}

/** Default {@link OcppLocalAuthListStore}: an in-memory version counter + `Map`, used when no store is injected. */
function createInMemoryLocalAuthListStore(): OcppLocalAuthListStore {
  let version = 0;
  const entries = new Map<string, OcppIdTagInfo>();
  return {
    async getVersion() {
      return version;
    },
    async setVersion(newVersion) {
      version = newVersion;
    },
    async listEntries() {
      return Array.from(entries.entries()).map(([idTag, idTagInfo]) => ({ idTag, idTagInfo }));
    },
    async setEntry(idTag, idTagInfo) {
      entries.set(idTag, idTagInfo);
    },
    async deleteEntry(idTag) {
      entries.delete(idTag);
    },
    async clearEntries() {
      entries.clear();
    },
  };
}

/**
 * Registers `SendLocalList`/`GetLocalListVersion` handling. `Full` replaces the whole list,
 * `Differential` upserts/removes individual entries (an entry with no `idTagInfo` means
 * "remove", per spec). `VersionMismatch` is returned whenever `listVersion` doesn't advance past
 * the current version, matching the CSMS-side expectation (per CitrineOS) that it falls back to
 * a `Full` update after seeing that status.
 *
 * The version counter and entries are delegated to `store` (in-memory by default; a caller may
 * inject a Prisma-backed one — see `OcppLocalAuthListStore`); the `Full`/`Differential` update
 * semantics themselves stay here.
 */
export function createLocalAuthListHandlers(
  store: OcppLocalAuthListStore = createInMemoryLocalAuthListStore(),
): LocalAuthListHandlers {
  async function handleSendLocalList(
    payload: Record<string, unknown>,
  ): Promise<{ status: OcppSendLocalListStatus }> {
    const { listVersion, updateType } = payload;
    if (typeof listVersion !== "number" || (updateType !== "Full" && updateType !== "Differential")) {
      throw new OcppCallError("PropertyConstraintViolation", "listVersion and updateType are required");
    }
    const rawList = Array.isArray(payload.localAuthorizationList) ? payload.localAuthorizationList : [];

    const currentVersion = await store.getVersion();
    if (listVersion <= currentVersion) {
      return { status: "VersionMismatch" };
    }
    if (rawList.length > MAX_LOCAL_LIST_ENTRIES) {
      return { status: "Failed" };
    }
    const existingEntries = await store.listEntries();
    if (updateType === "Differential" && currentVersion === 0 && existingEntries.length === 0) {
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
      await store.clearEntries();
    }
    for (const entry of rawList as RawLocalListEntry[]) {
      if (entry.idTagInfo) {
        await store.setEntry(entry.idTag, entry.idTagInfo);
      } else {
        await store.deleteEntry(entry.idTag);
      }
    }

    await store.setVersion(listVersion);
    return { status: "Accepted" };
  }

  return {
    handleSendLocalList,
    handleGetLocalListVersion: async () => ({ listVersion: await store.getVersion() }),
    getVersion: () => store.getVersion(),
    listEntries: () => store.listEntries(),
  };
}
