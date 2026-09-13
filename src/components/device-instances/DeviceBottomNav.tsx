import Link from "next/link";

const NAV_ITEMS = [
  { label: "Device", href: (instanceId: string) => `/instances/${instanceId}/device-test` },
  { label: "Setting", href: (instanceId: string) => `/instances/${instanceId}/settings` },
  { label: "Maintenance", href: (instanceId: string) => `/instances/${instanceId}/maintenance` },
  { label: "Event", href: (instanceId: string) => `/instances/${instanceId}/events` },
  { label: "Cost", href: (instanceId: string) => `/instances/${instanceId}/cost` },
  { label: "Lock", href: (instanceId: string) => `/instances/${instanceId}/lock` },
] as const;

export type DeviceBottomNavKey = (typeof NAV_ITEMS)[number]["label"];

/**
 * Bottom nav matching the real device's chrome (Device/Setting/Maintenance/Event/Cost/Lock).
 * "Device" here is the hardware test/diagnostics screen (issue #16) — distinct from the
 * "Device" tab inside Setting (identity info); see docs/device-reference/PEVC3107E/README.md.
 * There's no "Home" tab: the real device gets back to its Home screen (this instance's `/`
 * route) via the home icon in each screen's header bar, not the bottom nav.
 */
export function DeviceBottomNav({ instanceId, active }: { instanceId: string; active?: DeviceBottomNavKey }) {
  return (
    <div className="flex border-t border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950">
      {NAV_ITEMS.map((item) => {
        const isActive = item.label === active;
        return (
          <Link
            key={item.label}
            href={item.href(instanceId)}
            className={`flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${
              isActive
                ? "text-blue-600"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
