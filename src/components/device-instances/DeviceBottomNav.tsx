import Link from "next/link";

/**
 * One icon per nav item, matching the real device's bottom nav (see
 * docs/device-reference/PEVC3107E/manual-pages, e.g. Page13_Image2.jpg) — code brackets / gear /
 * wrench / note-with-pen / receipt / card. Deliberately simple line icons, same stroke
 * conventions as ConnectorChargeCard's ConnectorGlyph.
 */
function DeviceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 8 5 12l4 4M15 8l4 4-4 4" />
    </svg>
  );
}

function SettingIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.55 1.55M7.15 16.85 5.6 18.4M18.4 18.4l-1.55-1.55M7.15 7.15 5.6 5.6" />
    </svg>
  );
}

function MaintenanceIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.7 6.3a4 4 0 0 1-5.1 5.1L4 17l3 3 5.6-5.6a4 4 0 0 1 5.1-5.1L15 12l-3-3 2.7-2.7Z" />
    </svg>
  );
}

function EventIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3M9 12h6M9 16h4" />
    </svg>
  );
}

function CostIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z" />
      <path d="M9 9h6M9 13h6" />
    </svg>
  );
}

function LockNavIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M7 15h4" />
    </svg>
  );
}

const NAV_ITEMS = [
  { label: "Device", icon: DeviceIcon, href: (instanceId: string) => `/instances/${instanceId}/device-test` },
  { label: "Setting", icon: SettingIcon, href: (instanceId: string) => `/instances/${instanceId}/settings` },
  { label: "Maintenance", icon: MaintenanceIcon, href: (instanceId: string) => `/instances/${instanceId}/maintenance` },
  { label: "Event", icon: EventIcon, href: (instanceId: string) => `/instances/${instanceId}/events` },
  { label: "Cost", icon: CostIcon, href: (instanceId: string) => `/instances/${instanceId}/cost` },
  { label: "Lock", icon: LockNavIcon, href: (instanceId: string) => `/instances/${instanceId}/lock` },
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
        const Icon = item.icon;
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
            <Icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
