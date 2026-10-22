import type { OcppChangeConfigurationStatus, OcppConfigurationEntry, OcppConfigurationStore } from "@/lib/ocpp";
import { ParameterValidationError, validateParameterValue } from "@/lib/device-instances/parameters";
import { prisma } from "@/lib/prisma";

/** Only advertise protocol settings the runtime implements. Firmware-only keys stay unknown. */
const PROTOCOL_DEFAULTS: Record<string, { value: string; readonly: boolean; kind?: "seconds" | "meterSeconds" | "boolean" }> = {
  HeartbeatInterval: { value: "300", readonly: false, kind: "seconds" },
  ConnectionTimeOut: { value: "60", readonly: false, kind: "seconds" },
  MeterValueSampleInterval: { value: "60", readonly: false, kind: "meterSeconds" },
  AuthorizeRemoteTxRequests: { value: "true", readonly: false, kind: "boolean" },
  GetConfigurationMaxKeys: { value: "10", readonly: true },
  SupportedFeatureProfiles: { value: "Core,FirmwareManagement,Reservation,LocalAuthListManagement,SmartCharging,RemoteTrigger", readonly: true },
  StopTransactionOnEVSideDisconnect: { value: "true", readonly: true },
};
const PARAMETER_ALIASES: Record<string, string> = { QRcodeConnectID1: "qrCodeUrl1", QRcodeConnectID2: "qrCodeUrl2" };
const IDENTITY_KEYS = new Set(["firmwareVersion", "uiVersion", "crc", "plugAFirmwareVersion", "plugBFirmwareVersion"]);

/** Persistent OCPP settings plus canonical aliases for the same HMI parameter values. */
export class PrismaConfigurationStore implements OcppConfigurationStore {
  constructor(private readonly deviceInstanceId: string) {}

  async list(keys?: string[]): Promise<{ known: OcppConfigurationEntry[]; unknown: string[] }> {
    const [instance, params, overrides] = await Promise.all([
      prisma.deviceInstance.findUniqueOrThrow({ where: { id: this.deviceInstanceId },
        select: { csmsUrl: true, deviceModel: { select: { _count: { select: { connectors: true } } } } } }),
      prisma.deviceModelParameter.findMany({ where: { deviceModel: { instances: { some: { id: this.deviceInstanceId } } } },
        include: { instanceValues: { where: { deviceInstanceId: this.deviceInstanceId }, take: 1 } } }),
      prisma.deviceInstanceOcppConfiguration.findMany({ where: { deviceInstanceId: this.deviceInstanceId } }),
    ]);
    const entries = new Map<string, OcppConfigurationEntry>();
    for (const param of params) {
      const key = param.key;
      entries.set(key, { key, readonly: IDENTITY_KEYS.has(key), value: param.instanceValues[0]?.value ?? param.defaultValue ?? "" });
    }
    for (const [key, definition] of Object.entries(PROTOCOL_DEFAULTS)) {
      entries.set(key, { key, readonly: definition.readonly,
        value: overrides.find((row) => row.key === key)?.value ?? definition.value });
    }
    for (const [key, parameter] of Object.entries(PARAMETER_ALIASES)) {
      if (entries.has(parameter)) entries.set(key, { key, readonly: false, value: entries.get(parameter)!.value });
    }
    entries.set("NumberOfConnectors", { key: "NumberOfConnectors", readonly: true, value: String(instance.deviceModel._count.connectors) });
    // Repointing the active WebSocket is not implemented as a firmware reboot operation.
    entries.set("ServerURL", { key: "ServerURL", readonly: true, value: instance.csmsUrl });
    const requested = keys?.length ? [...new Set(keys)] : [...entries.keys()].sort();
    return {
      known: requested.flatMap((key) => entries.has(key) ? [entries.get(key)!] : []),
      unknown: requested.filter((key) => !entries.has(key)),
    };
  }

  async set(key: string, value: string): Promise<OcppChangeConfigurationStatus> {
    if (key === "NumberOfConnectors" || key === "ServerURL" || IDENTITY_KEYS.has(key)) return "Rejected";
    const definition = PROTOCOL_DEFAULTS[key];
    if (definition) {
      if (definition.readonly) return "Rejected";
      if (definition.kind === "boolean" && !["true", "false"].includes(value)) return "Rejected";
      if (definition.kind === "seconds" || definition.kind === "meterSeconds") {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 2_147_483 || Number(value) < (definition.kind === "seconds" ? 1 : 0)) return "Rejected";
        value = String(Number(value));
      }
      await prisma.deviceInstanceOcppConfiguration.upsert({
        where: { deviceInstanceId_key: { deviceInstanceId: this.deviceInstanceId, key } },
        create: { deviceInstanceId: this.deviceInstanceId, key, value }, update: { value },
      });
      return "Accepted";
    }
    const parameterKey = PARAMETER_ALIASES[key] ?? key;
    const modelParameter = await prisma.deviceModelParameter.findFirst({
      where: { deviceModel: { instances: { some: { id: this.deviceInstanceId } } }, key: parameterKey },
    });
    if (!modelParameter) return "NotSupported";
    let validated: string | null;
    try {
      validated = value === "" && modelParameter.valueType === "STRING" ? "" : validateParameterValue(modelParameter, value);
    } catch (err) {
      if (err instanceof ParameterValidationError) return "Rejected";
      throw err;
    }
    await prisma.deviceInstanceParameter.upsert({
      where: { deviceInstanceId_deviceModelParameterId: { deviceInstanceId: this.deviceInstanceId, deviceModelParameterId: modelParameter.id } },
      create: { deviceInstanceId: this.deviceInstanceId, deviceModelParameterId: modelParameter.id, key: parameterKey, value: validated },
      update: { value: validated },
    });
    return "Accepted";
  }
}

/** Runtime interval lookup avoids loading the entire HMI catalogue on hot state reads. */
export async function getOcppIntervalMs(deviceInstanceId: string, key: string, defaultSeconds: number): Promise<number> {
  const row = await prisma.deviceInstanceOcppConfiguration.findUnique({ where: { deviceInstanceId_key: { deviceInstanceId, key } } });
  return (row ? Number(row.value) : defaultSeconds) * 1000;
}
