"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "", label: "Overview" },
  { href: "/events", label: "Event" },
  { href: "/cost", label: "Cost" },
  { href: "/lock", label: "Lock" },
];

/** Bottom-nav-inspired tab row linking an instance's Overview/Event/Cost/Lock screens (issue #14). */
export function InstanceSubNav({ instanceId }: { instanceId: string }) {
  const pathname = usePathname();
  const base = `/instances/${instanceId}`;

  return (
    <nav className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
      {TABS.map((tab) => {
        const href = `${base}${tab.href}`;
        const isActive = pathname === href;
        return (
          <Link
            key={tab.label}
            href={href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              isActive
                ? "border-black text-black dark:border-white dark:text-zinc-50"
                : "border-transparent text-zinc-500 hover:text-black dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
