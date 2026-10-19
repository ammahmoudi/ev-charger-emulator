import type { ParameterCategory } from "@prisma/client";

import { PARAMETER_CATEGORY_LABELS, PARAMETER_CATEGORY_ORDER } from "@/lib/device-instances/types";

interface SettingsTabsProps {
  active: ParameterCategory;
  onSelect: (category: ParameterCategory) => void;
}

/** Tab row matching the real device's Setting screen: Device / System / Networks / Fee Rate / Other. */
export function SettingsTabs({ active, onSelect }: SettingsTabsProps) {
  return (
    <div className="flex flex-none items-end px-[12px] pt-[6px]">
      {PARAMETER_CATEGORY_ORDER.map((category) => {
        const isActive = category === active;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(category)}
            className={`flex-1 whitespace-nowrap px-[10px] py-[8px] text-[30px] ${
              isActive ? "rounded-t-[8px] bg-white font-medium text-[#2f8cf0] shadow-[0_-1px_4px_rgba(0,0,0,0.1)]" : "text-[#444]"
            }`}
          >
            {PARAMETER_CATEGORY_LABELS[category]}
          </button>
        );
      })}
    </div>
  );
}
