/** Sort-order gap beyond which consecutive parameters are treated as belonging to different settings pages. */
const PAGE_GAP_THRESHOLD = 5;

/**
 * Splits a category's parameters into settings-screen pages by sortOrder. There's no explicit
 * "page" column on DeviceModelParameter — the PEVC3107E seed instead leaves a >5 sortOrder gap
 * between each settings page's block of fields (e.g. System p1 ends at 21, p2 starts at 30), so
 * a page break is recovered from that gap rather than needing a schema change.
 */
export function paginateBySortOrder<T extends { sortOrder: number }>(items: T[]): T[][] {
  const sorted = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const pages: T[][] = [];
  for (const item of sorted) {
    const currentPage = pages[pages.length - 1];
    const previous = currentPage?.[currentPage.length - 1];
    if (currentPage && previous && item.sortOrder - previous.sortOrder <= PAGE_GAP_THRESHOLD) {
      currentPage.push(item);
    } else {
      pages.push([item]);
    }
  }
  return pages;
}

/** Splits a page's fields into two top-to-bottom columns, matching the real device's two-column settings layout. */
export function splitIntoColumns<T>(items: T[]): [T[], T[]] {
  const half = Math.ceil(items.length / 2);
  return [items.slice(0, half), items.slice(half)];
}
