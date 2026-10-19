import { DeviceHeaderChrome } from "../DeviceHeaderChrome";

/** Blue header of the real device's secondary screens — "Hi" logo + the white home tab; the title sits at the right. */
export function DeviceHeaderBar({ instanceId, title }: { instanceId: string; title: string }) {
  return (
    <DeviceHeaderChrome instanceId={instanceId} homeTitle="Back to device">
      <span className="ml-auto truncate text-[26px] font-medium opacity-90">{title}</span>
    </DeviceHeaderChrome>
  );
}
