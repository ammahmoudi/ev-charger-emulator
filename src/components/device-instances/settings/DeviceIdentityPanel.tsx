import type { DeviceInstanceDetail, DeviceInstanceParameterView } from "@/lib/device-instances/types";
import { formatFirmwareDate } from "@/lib/device-instances/settings-pages";
import { SettingsFieldRow } from "./SettingsFieldRow";

/** Six identity rows on the left, four plug firmware/date rows on the right (field photo 10). */
export function DeviceIdentityPanel({ instance, parameters }: {
  instance: DeviceInstanceDetail;
  parameters: DeviceInstanceParameterView[];
}) {
  const byKey = new Map(parameters.map((p) => [p.key, p]));
  const left = [
    { label: "SN", value: instance.chargePointId },
    { label: "Model", value: instance.deviceModel.model },
    { label: "Firmware", value: byKey.get("firmwareVersion")?.value ?? "—" },
    { label: "UI", value: byKey.get("uiVersion")?.value ?? "—" },
    { label: "CRC", value: byKey.get("crc")?.value ?? "—" },
    { label: "Date", value: formatFirmwareDate(byKey.get("firmwareVersion")) },
  ];
  const right = [
    { label: "Plug A Firmware", value: byKey.get("plugAFirmwareVersion")?.value ?? "—" },
    { label: "Plug A Date", value: formatFirmwareDate(byKey.get("plugAFirmwareVersion")) },
    { label: "Plug B Firmware", value: byKey.get("plugBFirmwareVersion")?.value ?? "—" },
    { label: "Plug B Date", value: formatFirmwareDate(byKey.get("plugBFirmwareVersion")) },
  ];
  return <div aria-label="Device firmware information" className="grid min-h-[354px] flex-1 grid-cols-2 gap-x-[14px] pb-[8px]">
    {[left, right].map((column, i) => <div key={i} className={`grid ${i === 0 ? "grid-rows-6" : "grid-rows-4"}`}>
      {column.map((row) => <SettingsFieldRow key={row.label} label={row.label}>
        <bdi className="whitespace-nowrap text-[28px]">{row.value}</bdi>
      </SettingsFieldRow>)}
    </div>)}
  </div>;
}
