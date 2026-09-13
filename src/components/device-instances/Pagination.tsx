"use client";

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}

/** "‹ page X of Y ›" control, matching the real device's Event/Cost screen pagination footer. */
export function Pagination({ page, pageCount, onPageChange }: PaginationProps) {
  return (
    <div className="flex items-center justify-center gap-4 border-t border-zinc-200 py-3 text-sm text-zinc-500 dark:border-zinc-800">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        aria-label="Previous page"
        className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-black disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        ‹
      </button>
      <span>
        page <span className="font-medium text-black dark:text-zinc-50">{page}</span> of{" "}
        <span className="font-medium text-black dark:text-zinc-50">{pageCount}</span>
      </span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
        aria-label="Next page"
        className="rounded-md px-2 py-1 text-zinc-400 hover:bg-zinc-100 hover:text-black disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
      >
        ›
      </button>
    </div>
  );
}
