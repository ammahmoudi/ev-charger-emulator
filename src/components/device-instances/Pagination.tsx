"use client";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

const arrow =
  "absolute top-1/2 z-10 flex h-[56px] w-[28px] -translate-y-1/2 items-center justify-center bg-[#eef2f6] text-[44px] leading-none text-[#2f8cf0] disabled:invisible";

/** "page X of Y" footer with the blue edge arrows, matching the real device's Event/Cost screens. */
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  return (
    <>
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page" className={`${arrow} left-0 rounded-r-[6px]`}>
        ‹
      </button>
      <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="Next page" className={`${arrow} right-0 rounded-l-[6px]`}>
        ›
      </button>
      <div className="mt-auto flex flex-none items-baseline justify-center gap-[28px] pb-[10px] pt-[6px] text-[26px] text-[#888]">
        <span>
          page <span className="ml-[28px] text-[34px] text-[#444]">{page}</span>
        </span>
        <span>
          of <span className="ml-[28px] text-[34px] text-[#444]">{pageCount}</span>
        </span>
      </div>
    </>
  );
}
