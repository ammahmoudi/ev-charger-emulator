import type { OcppChangeConfigurationStatus, OcppConfigurationEntry, OcppConfigurationStore } from "@/lib/ocpp";
import { ParameterValidationError, validateParameterValue } from "@/lib/device-instances/parameters";
import { prisma } from "@/lib/prisma";

/**
 * `OcppConfigurationStore` backed by an instance's `DeviceInstanceParameter` rows — the same
 * values the Settings screen reads and edits (`src/app/instances/[id]/settings/page.tsx`). A
 * real CSMS's `GetConfiguration`/`ChangeConfiguration` therefore reads/writes the same data
 * instead of a disconnected placeholder; this is what `InMemoryConfigurationStore` (kept only as
 * the test default) was standing in for.
 *
 * Every instance parameter is reported read/write (`readonly: false`) — the Settings screen
 * already allows editing all of them, so there's no separate read-only concept to enforce here.
 * `set()` does run the same `validateParameterValue` the Settings-UI edit path
 * (`PATCH /api/device-instances/[id]`) already applies, though — a CSMS-initiated
 * `ChangeConfiguration` shouldn't be able to push a value the UI itself would have rejected.
 */
export class PrismaConfigurationStore implements OcppConfigurationStore {
  constructor(private readonly deviceInstanceId: string) {}

  async list(keys?: string[]): Promise<{ known: OcppConfigurationEntry[]; unknown: string[] }> {
    const params = await prisma.deviceInstanceParameter.findMany({
      where: {
        deviceInstanceId: this.deviceInstanceId,
        ...(keys ? { deviceModelParameter: { key: { in: keys } } } : {}),
      },
      include: { deviceModelParameter: { select: { key: true, defaultValue: true } } },
    });

    const known: OcppConfigurationEntry[] = params.map((p) => ({
      key: p.deviceModelParameter.key,
      readonly: false,
      value: p.value ?? p.deviceModelParameter.defaultValue ?? "",
    }));

    if (!keys) return { known, unknown: [] };

    const knownKeys = new Set(known.map((entry) => entry.key));
    return { known, unknown: keys.filter((key) => !knownKeys.has(key)) };
  }

  /**
   * Writes a CSMS-initiated `ChangeConfiguration` value, first validating it against the same
   * `valueType`/`enumOptions`/min/max rules the Settings-UI edit path enforces
   * (`validateParameterValue`) — returns `"Rejected"` (rather than silently persisting an
   * out-of-range or wrongly-typed value) if it fails, `"NotSupported"` for an unknown key.
   */
  async set(key: string, value: string): Promise<OcppChangeConfigurationStatus> {
    const param = await prisma.deviceInstanceParameter.findFirst({
      where: { deviceInstanceId: this.deviceInstanceId, deviceModelParameter: { key } },
      select: {
        id: true,
        deviceModelParameter: {
          select: { id: true, key: true, label: true, valueType: true, enumOptions: true, minValue: true, maxValue: true, defaultValue: true },
        },
      },
    });
    if (!param) return "NotSupported";

    let validated: string | null;
    try {
      validated = validateParameterValue(param.deviceModelParameter, value);
    } catch (err) {
      if (err instanceof ParameterValidationError) return "Rejected";
      throw err;
    }

    await prisma.deviceInstanceParameter.update({ where: { id: param.id }, data: { value: validated } });
    return "Accepted";
  }
}
