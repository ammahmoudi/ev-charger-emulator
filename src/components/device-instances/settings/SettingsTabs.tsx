import type { ParameterCategory } from "@prisma/client";

import { PARAMETER_CATEGORY_LABELS, PARAMETER_CATEGORY_ORDER } from "@/lib/device-instances/types";

interface SettingsTabsProps {
  active: ParameterCategory;
  onSelect: (category: ParameterCategory) => void;
}

/** Tab row matching the real device's Setting screen: Device / System / Networks / Fee Rate / Other. */
export function SettingsTabs({ active, onSelect }: SettingsTabsProps) {
  return (
    <div className="flex overflow-x-auto border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      {PARAMETER_CATEGORY_ORDER.map((category) => {
        const isActive = category === active;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(category)}
            className={`shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap ${
              isActive
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {PARAMETER_CATEGORY_LABELS[category]}
          </button>
        );
      })}
    </div>
  );
}
