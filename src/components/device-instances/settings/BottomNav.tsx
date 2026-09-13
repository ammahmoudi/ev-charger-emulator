import Link from "next/link";

const NAV_ITEMS = [
  { label: "Device", href: (instanceId: string) => `/instances/${instanceId}`, enabled: true },
  { label: "Setting", href: (instanceId: string) => `/instances/${instanceId}/settings`, enabled: true },
  { label: "Maintenance", enabled: false },
  { label: "Event", enabled: false },
  { label: "Cost", enabled: false },
  { label: "Lock", enabled: false },
] as const;

/**
 * Decorative bottom nav matching the real device's chrome (Device/Setting/Maintenance/Event/Cost/Lock).
 * Only Device and Setting are implemented screens; the rest are disabled placeholders for visual fidelity.
 */
export function BottomNav({ instanceId, active }: { instanceId: string; active: "Device" | "Setting" }) {
  return (
    <div className="flex border-t border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-950">
      {NAV_ITEMS.map((item) => {
        const isActive = item.label === active;
        const className = `flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium ${
          isActive
            ? "text-blue-600"
            : item.enabled
              ? "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              : "cursor-not-allowed text-zinc-300 dark:text-zinc-700"
        }`;

        if (!item.enabled || !("href" in item)) {
          return (
            <span key={item.label} title="Not implemented in this emulator" className={className}>
              {item.label}
            </span>
          );
        }

        return (
          <Link key={item.label} href={item.href(instanceId)} className={className}>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
