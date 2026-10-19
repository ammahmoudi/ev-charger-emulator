/**
 * Only known status vocabulary gets colorized — a "good" reading (Closed/Normal/Locked/...)
 * renders black/zinc, a flagged one (Open/Error/Blown/...) renders amber, matching #4's
 * convention of flagging non-normal fields visually. Arbitrary identifier strings (ICCID,
 * IMEI, ...) aren't status values and always render neutral.
 */
const FLAGGED_VALUES = new Set(["Open", "Error", "Blown", "Unlocked", "Fault", "Offline", "Disconnected"]);

function toneClassName(value: string): string {
  if (FLAGGED_VALUES.has(value)) return "text-[#d97706]";
  return "text-[#333]";
}

interface ReadoutProps {
  label: string;
  value: string | number;
  unit?: string;
}

/** One label/value diagnostic readout, e.g. "CC1 status: Closed". */
export function Readout({ label, value, unit }: ReadoutProps) {
  const display = typeof value === "number" ? value.toString() : value;
  return (
    <div className="flex min-h-[54px] items-center justify-between gap-2 border border-[#e3e6ea] bg-white px-[12px] py-[2px]">
      <span className="text-[22px] leading-[24px] text-[#4a4a4a]">{label}</span>
      <span className={`text-[28px] ${typeof value === "string" ? toneClassName(value) : "text-[#333]"}`}>
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
  onAction: (value: string) => void;
}

/** A labeled row of manual test-action buttons, e.g. "Contactor action" → Start / Stop. */
export function ActionButtonGroup({ label, options, activeValue, disabled, onAction }: ActionButtonGroupProps) {
  const tone = (v: string) => (v === "stop" ? "from-[#ff5a52] to-[#d6241d]" : "from-[#4cd45c] to-[#1fa032]");
  return (
    <div className="flex flex-wrap items-center gap-[10px]">
      <span className="min-w-[210px] text-[22px] leading-[24px] text-[#4a4a4a]">{label}</span>
      <div className="flex gap-[10px]">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onAction(option.value)}
            className={`rounded-[4px] bg-gradient-to-b px-[18px] py-[2px] text-[24px] font-bold uppercase tracking-wide text-white shadow-[inset_0_-2px_0_rgba(0,0,0,0.2)] disabled:opacity-50 ${tone(option.value)} ${
              activeValue === option.value ? "ring-2 ring-[#1a6fd8] ring-offset-1" : ""
            }`}
          >
            ▶ {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
