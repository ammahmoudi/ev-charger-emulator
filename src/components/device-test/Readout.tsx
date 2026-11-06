/** Idle contacts and released locks are neutral; only fault states receive an alarm color. */
const FLAGGED_VALUES = new Set(["Error", "Blown", "Fault", "Offline"]);

function toneClassName(value: string): string {
  if (FLAGGED_VALUES.has(value)) return "text-[#d97706]";
  return "text-[#333]";
}

interface ReadoutProps {
  label: string;
  value: string | number;
  unit?: string;
  compact?: boolean;
}

/** One label/value diagnostic readout, e.g. "CC1 status: Closed". */
export function Readout({ label, value, unit, compact = false }: ReadoutProps) {
  const display = typeof value === "number" ? value.toString() : value;
  return (
    <div className={`flex items-center justify-between gap-2 border border-[#e3e6ea] bg-white px-[12px] py-[2px] ${compact ? "min-h-[42px]" : "min-h-[54px]"}`}>
      <span className={`${compact ? "text-[18px] leading-[20px]" : "text-[22px] leading-[24px]"} text-[#4a4a4a]`}>{label}</span>
      <span className={`${compact ? "text-[26px]" : "text-[28px]"} ${typeof value === "string" ? toneClassName(value) : "text-[#333]"}`}>
        {display}
        {unit ? <span className="ml-1 text-[18px] text-[#999]">{unit}</span> : null}
      </span>
    </div>
  );
}

interface ActionOption {
  value: string;
  label: string;
}

interface ActionButtonGroupProps {
  label: string;
  options: ActionOption[];
  activeValue?: string;
  disabled?: boolean;
  compact?: boolean;
  onAction: (value: string) => void;
}

/** A labeled row of manual test-action buttons, e.g. "Contactor action" → Start / Stop. */
export function ActionButtonGroup({ label, options, activeValue, disabled, onAction, compact = false }: ActionButtonGroupProps) {
  const tone = (v: string) => (v === "stop" ? "from-[#ff5a52] to-[#d6241d]" : "from-[#4cd45c] to-[#1fa032]");
  return (
    <div className={`flex items-center gap-[10px] ${compact ? "flex-col" : "flex-wrap"}`}>
      <span className={`${compact ? "text-[18px]" : "min-w-[210px] text-[22px]"} leading-[24px] text-[#4a4a4a]`}>{label}</span>
      <div className="flex gap-[10px]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onAction(option.value)}
            aria-pressed={activeValue === option.value}
            className={`rounded-[4px] bg-gradient-to-b ${compact ? "px-[12px] text-[20px]" : "px-[18px] text-[24px]"} py-[2px] font-bold uppercase tracking-wide text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.2)] disabled:opacity-50 ${tone(option.value)} ${
              activeValue === option.value ? "ring-2 ring-[#1a6fd8] ring-offset-1" : ""
            }`}
          >
            {option.value === "stop" ? "■" : "▶"} {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
