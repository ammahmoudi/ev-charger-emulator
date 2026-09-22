import type {
  OcppChangeConfigurationStatus,
  OcppConfigurationEntry,
  OcppConfigurationStore,
} from "./remote-command-types";

/** A handful of standard OCPP 1.6 configuration keys, reasonable as defaults for an emulator. */
const DEFAULT_CONFIGURATION_ENTRIES: OcppConfigurationEntry[] = [
  { key: "HeartbeatInterval", readonly: false, value: "300" },
  { key: "ConnectionTimeOut", readonly: false, value: "60" },
  { key: "NumberOfConnectors", readonly: true, value: "2" },
  { key: "MeterValueSampleInterval", readonly: false, value: "60" },
  {
    key: "MeterValuesSampledData",
    readonly: false,
    value: "Energy.Active.Import.Register,Power.Active.Import,Power.Offered,Voltage,Current.Import,SoC",
  },
  {
    key: "SupportedFeatureProfiles",
    readonly: true,
    value: "Core,FirmwareManagement,LocalAuthListManagement,Reservation,SmartCharging,RemoteTrigger",
  },
  { key: "ReserveConnectorZeroSupported", readonly: true, value: "true" },
  // Matches MAX_LOCAL_LIST_ENTRIES in ./local-list.ts.
  { key: "SendLocalListMaxLength", readonly: true, value: "500" },
];

/**
 * Simple in-memory {@link OcppConfigurationStore}, seeded with a few standard OCPP 1.6
 * keys. Used as the default in tests; real instances use `PrismaConfigurationStore`
 * (`src/lib/device-instances/prisma-configuration-store.ts`) instead.
 */
export class InMemoryConfigurationStore implements OcppConfigurationStore {
  private readonly entries: Map<string, OcppConfigurationEntry>;

  constructor(initial: OcppConfigurationEntry[] = DEFAULT_CONFIGURATION_ENTRIES) {
    this.entries = new Map(initial.map((entry) => [entry.key, entry]));
  }

  async list(keys?: string[]): Promise<{ known: OcppConfigurationEntry[]; unknown: string[] }> {
    if (!keys || keys.length === 0) {
      return { known: Array.from(this.entries.values()), unknown: [] };
    }

    const known: OcppConfigurationEntry[] = [];
    const unknown: string[] = [];
    for (const key of keys) {
      const entry = this.entries.get(key);
      if (entry) {
        known.push(entry);
      } else {
        unknown.push(key);
      }
    }
    return { known, unknown };
  }

  async set(key: string, value: string): Promise<OcppChangeConfigurationStatus> {
    const entry = this.entries.get(key);
    if (!entry) return "NotSupported";
    if (entry.readonly) return "Rejected";

    this.entries.set(key, { ...entry, value });
    return "Accepted";
  }
}
