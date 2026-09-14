import type { OcppChangeConfigurationStatus, OcppConfigurationEntry, OcppConfigurationStore } from "@/lib/ocpp";
import { isValidWebSocketUrl } from "@/lib/device-instances/http";
import { prisma } from "@/lib/prisma";

/**
 * The two device-model parameters (`OTHER` category, seeded in `prisma/seed.ts`) that back the
 * QR-code overlay screen (`/instances/[id]/qr`) — real OCPP 1.6 config keys on the reference CSMS
 * this emulator was checked against, so they're handled by `PrismaConfigurationStore` alongside
 * the standard keys below rather than as app-invented names.
 */
const QR_PARAMETER_KEYS = ["QRcodeConnectID1", "QRcodeConnectID2"] as const;

/**
 * Standard OCPP 1.6 Core/SmartCharging/LocalAuthListManagement/RemoteTrigger configuration keys,
 * with the readonly-ness and representative default values confirmed against a real CSMS's
 * `GetConfiguration` response for a PEVC3107E-class station. Values here are static per-emulator
 * (unlike `DeviceModelParameter`, nothing here varies by device model) — `list()` layers dynamic
 * values (`ServerURL`, `NumberOfConnectors`) and any persisted `set()` overrides on top.
 */
const STANDARD_KEYS: Record<string, { readonly: boolean; defaultValue: string }> = {
  AuthorizationKey: { readonly: false, defaultValue: "" },
  AuthorizeRemoteTxRequests: { readonly: false, defaultValue: "true" },
  ChargingScheduleAllowedChargingRateUnit: { readonly: true, defaultValue: "W" },
  ChargingScheduleMaxPeriods: { readonly: true, defaultValue: "12" },
  ClearChargeRecord: { readonly: false, defaultValue: "" },
  ClockAlignedDataInterval: { readonly: false, defaultValue: "0" },
  ConnectionTimeOut: { readonly: false, defaultValue: "160" },
  GetConfigurationMaxKeys: { readonly: true, defaultValue: "10" },
  HeartbeatInterval: { readonly: false, defaultValue: "30" },
  LocalAuthListEnabled: { readonly: false, defaultValue: "true" },
  LocalAuthListMaxLength: { readonly: true, defaultValue: "5" },
  LocalAuthorizeOffline: { readonly: false, defaultValue: "false" },
  LocalPreAuthorize: { readonly: false, defaultValue: "false" },
  MaxChargingProfilesInstalled: { readonly: true, defaultValue: "3" },
  MeterValuesAlignedData: { readonly: false, defaultValue: "Energy.Active.Import.Register" },
  MeterValueSampleInterval: { readonly: false, defaultValue: "30" },
  MeterValuesSampledData: {
    readonly: false,
    defaultValue: "Voltage,Current.Import,Energy.Active.Import.Register,SoC,Power.Active.Import,Power.Offered",
  },
  ResetRetries: { readonly: false, defaultValue: "3" },
  SendLocalListMaxLength: { readonly: true, defaultValue: "5" },
  StopTransactionOnEVSideDisconnect: { readonly: true, defaultValue: "true" },
  StopTransactionOnInvalidId: { readonly: false, defaultValue: "false" },
  SupportedFeatureProfiles: {
    readonly: true,
    defaultValue: "Core,FirmwareManagement,Reservation,LocalAuthListManagement,SmartCharging,RemoteTrigger",
  },
  TransactionMessageAttempts: { readonly: false, defaultValue: "3" },
  TransactionMessageRetryInterval: { readonly: false, defaultValue: "10" },
  UnlockConnectorOnEVSideDisconnect: { readonly: false, defaultValue: "false" },
};

/** `NumberOfConnectors` and `ServerURL` are derived from live instance data rather than static. */
const DYNAMIC_KEYS = new Set(["NumberOfConnectors", "ServerURL"]);

function isPlainStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `OcppConfigurationStore` for real OCPP protocol config, as a real CSMS's `GetConfiguration`/
 * `ChangeConfiguration` actually sees it — distinct from `DeviceInstanceParameter`, which mirrors
 * the physical device's own *touchscreen* Settings-screen fields (none of which are real OCPP
 * config keys; compare the reference screenshots in docs/device-reference/PEVC3107E, none of
 * which show a "Heartbeat Interval" field). Three kinds of key here:
 *
 * - Static standard keys (`STANDARD_KEYS`): defaults confirmed against a real CSMS's
 *   `GetConfiguration` response; writable ones persist overrides to `DeviceInstance.ocppConfigOverrides`.
 * - Dynamic keys (`NumberOfConnectors`, `ServerURL`): derived from live instance data.
 *   `ServerURL` writes update `DeviceInstance.csmsUrl` directly (the same field the Settings
 *   screen's Networks tab edits) rather than the override JSON, and report `RebootRequired`
 *   since a real charger needs to reconnect for a new CSMS URL to take effect.
 * - `QRcodeConnectID1`/`QRcodeConnectID2` (`QR_PARAMETER_KEYS`): ordinary `DeviceInstanceParameter`
 *   rows (also shown in Settings), since — unlike the rest — these are both a real OCPP config
 *   key on the reference CSMS *and* something an operator would reasonably want to edit locally.
 */
export class PrismaConfigurationStore implements OcppConfigurationStore {
  constructor(private readonly deviceInstanceId: string) {}

  private async loadInstance() {
    return prisma.deviceInstance.findUniqueOrThrow({
      where: { id: this.deviceInstanceId },
      select: {
        csmsUrl: true,
        ocppConfigOverrides: true,
        deviceModel: { select: { connectors: { select: { id: true } } } },
      },
    });
  }

  private async loadQrEntries(keys?: string[]): Promise<OcppConfigurationEntry[]> {
    const requestedQrKeys: string[] = keys ? QR_PARAMETER_KEYS.filter((k) => keys.includes(k)) : [...QR_PARAMETER_KEYS];
    if (requestedQrKeys.length === 0) return [];

    const params = await prisma.deviceInstanceParameter.findMany({
      where: { deviceInstanceId: this.deviceInstanceId, deviceModelParameter: { key: { in: requestedQrKeys } } },
      include: { deviceModelParameter: { select: { key: true, defaultValue: true } } },
    });

    return params.map((p) => ({
      key: p.deviceModelParameter.key,
      readonly: false,
      value: p.value ?? p.deviceModelParameter.defaultValue ?? "",
    }));
  }

  async list(keys?: string[]): Promise<{ known: OcppConfigurationEntry[]; unknown: string[] }> {
    const instance = await this.loadInstance();
    const overrides = isPlainStringRecord(instance.ocppConfigOverrides) ? instance.ocppConfigOverrides : {};

    const requestedStandardKeys = keys
      ? keys.filter((key) => key in STANDARD_KEYS || DYNAMIC_KEYS.has(key))
      : [...Object.keys(STANDARD_KEYS), ...DYNAMIC_KEYS];

    const known: OcppConfigurationEntry[] = requestedStandardKeys.map((key) => {
      if (key === "NumberOfConnectors") {
        return { key, readonly: true, value: String(instance.deviceModel.connectors.length) };
      }
      if (key === "ServerURL") {
        return { key, readonly: false, value: instance.csmsUrl };
      }
      const standard = STANDARD_KEYS[key];
      return { key, readonly: standard.readonly, value: overrides[key] ?? standard.defaultValue };
    });

    known.push(...(await this.loadQrEntries(keys)));

    if (!keys) return { known, unknown: [] };
    const knownKeys = new Set(known.map((entry) => entry.key));
    return { known, unknown: keys.filter((key) => !knownKeys.has(key)) };
  }

  async set(key: string, value: string): Promise<OcppChangeConfigurationStatus> {
    if ((QR_PARAMETER_KEYS as readonly string[]).includes(key)) {
      const param = await prisma.deviceInstanceParameter.findFirst({
        where: { deviceInstanceId: this.deviceInstanceId, deviceModelParameter: { key } },
        select: { id: true },
      });
      if (!param) return "NotSupported";
      await prisma.deviceInstanceParameter.update({ where: { id: param.id }, data: { value } });
      return "Accepted";
    }

    if (key === "ServerURL") {
      if (!isValidWebSocketUrl(value)) return "Rejected";
      await prisma.deviceInstance.update({ where: { id: this.deviceInstanceId }, data: { csmsUrl: value } });
      // Takes effect on the next (re)connect, mirroring a real charger needing a reboot for a new
      // CSMS URL — deliberately doesn't force-disconnect the live connection here.
      return "RebootRequired";
    }
    if (key === "NumberOfConnectors") return "Rejected";

    const standard = STANDARD_KEYS[key];
    if (!standard) return "NotSupported";
    if (standard.readonly) return "Rejected";

    const instance = await prisma.deviceInstance.findUniqueOrThrow({
      where: { id: this.deviceInstanceId },
      select: { ocppConfigOverrides: true },
    });
    const overrides = isPlainStringRecord(instance.ocppConfigOverrides) ? instance.ocppConfigOverrides : {};
    await prisma.deviceInstance.update({
      where: { id: this.deviceInstanceId },
      data: { ocppConfigOverrides: { ...overrides, [key]: value } },
    });
    return "Accepted";
  }
}
