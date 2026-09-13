interface SettingsPagerProps {
  pageIndex: number;
  pageCount: number;
  onChange: (index: number) => void;
}

/** Prev/next arrows for a multi-page settings tab, matching the device's `<`/`>` page controls. */
export function SettingsPager({ pageIndex, pageCount, onChange }: SettingsPagerProps) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-4 pt-1">
      <button
        type="button"
        disabled={pageIndex === 0}
        onClick={() => onChange(pageIndex - 1)}
        aria-label="Previous page"
        className="flex h-7 w-7 items-center justify-center rounded-full text-blue-600 disabled:text-zinc-300 dark:disabled:text-zinc-700"
      >
        ‹
      </button>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        Page {pageIndex + 1} of {pageCount}
      </span>
      <button
        type="button"
        disabled={pageIndex === pageCount - 1}
        onClick={() => onChange(pageIndex + 1)}
        aria-label="Next page"
        className="flex h-7 w-7 items-center justify-center rounded-full text-blue-600 disabled:text-zinc-300 dark:disabled:text-zinc-700"
      >
        ›
      </button>
    </div>
  );
}
