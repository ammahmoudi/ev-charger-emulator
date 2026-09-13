/**
 * Only known status vocabulary gets colorized — a "good" reading (Closed/Normal/Locked/...)
 * renders black/zinc, a flagged one (Open/Error/Blown/...) renders amber, matching #4's
 * convention of flagging non-normal fields visually. Arbitrary identifier strings (ICCID,
 * IMEI, ...) aren't status values and always render neutral.
 */
const FLAGGED_VALUES = new Set(["Open", "Error", "Blown", "Unlocked", "Fault", "Offline", "Disconnected"]);

function toneClassName(value: string): string {
  if (FLAGGED_VALUES.has(value)) return "text-amber-700 dark:text-amber-400";
  return "text-black dark:text-zinc-50";
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
    <div className="flex flex-col gap-0.5 rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className={`text-sm font-medium ${typeof value === "string" ? toneClassName(value) : "text-black dark:text-zinc-50"}`}>
        {display}
        {unit ? <span className="ml-1 text-xs font-normal text-zinc-400">{unit}</span> : null}
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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-44 shrink-0 text-sm text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onAction(option.value)}
            className={`rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50 ${
              activeValue === option.value
                ? "border-black bg-black text-white dark:border-white dark:bg-white dark:text-black"
                : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
