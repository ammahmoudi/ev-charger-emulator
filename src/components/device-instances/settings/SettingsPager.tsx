interface SettingsPagerProps {
  pageIndex: number;
  pageCount: number;
  onChange: (index: number) => void;
}

const arrow =
  "absolute top-1/2 z-10 flex h-[56px] w-[28px] -translate-y-1/2 items-center justify-center bg-[#eef2f6] text-[44px] leading-none text-[#2f8cf0] disabled:invisible";

/** Prev/next edge arrows for a multi-page settings tab, matching the device's blue `<`/`>` page controls at the panel edges. */
export function SettingsPager({ pageIndex, pageCount, onChange }: SettingsPagerProps) {
  if (pageCount <= 1) return null;

  return (
    <>
      <button type="button" disabled={pageIndex === 0} onClick={() => onChange(pageIndex - 1)} aria-label="Previous page" className={`${arrow} left-0 rounded-r-[6px]`}>
        ‹
      </button>
      <button type="button" disabled={pageIndex === pageCount - 1} onClick={() => onChange(pageIndex + 1)} aria-label="Next page" className={`${arrow} right-0 rounded-l-[6px]`}>
        ›
      </button>
      <span className="sr-only">
        Page {pageIndex + 1} of {pageCount}
      </span>
    </>
  );
}
