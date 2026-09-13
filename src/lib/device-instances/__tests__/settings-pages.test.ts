import { describe, expect, it } from "vitest";

import { paginateBySortOrder, splitIntoColumns } from "../settings-pages";

function items(sortOrders: number[]) {
  return sortOrders.map((sortOrder) => ({ sortOrder }));
}

describe("paginateBySortOrder", () => {
  it("keeps a single page when sortOrders are contiguous", () => {
    const pages = paginateBySortOrder(items([1, 2, 3, 4, 5]));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(5);
  });

  it("breaks a new page when the sortOrder gap exceeds the threshold", () => {
    // Mirrors the PEVC3107E System tab: page 1 (10-12), page 2 (30-31), page 3 (50).
    const pages = paginateBySortOrder(items([10, 11, 12, 30, 31, 50]));
    expect(pages.map((page) => page.map((p) => p.sortOrder))).toEqual([
      [10, 11, 12],
      [30, 31],
      [50],
    ]);
  });

  it("sorts input before paginating", () => {
    const pages = paginateBySortOrder(items([12, 10, 11]));
    expect(pages).toEqual([items([10, 11, 12])]);
  });

  it("returns no pages for an empty input", () => {
    expect(paginateBySortOrder([])).toEqual([]);
  });
});

describe("splitIntoColumns", () => {
  it("puts the extra item in the first column for odd-length lists", () => {
    const [left, right] = splitIntoColumns([1, 2, 3]);
    expect(left).toEqual([1, 2]);
    expect(right).toEqual([3]);
  });

  it("splits evenly for even-length lists", () => {
    const [left, right] = splitIntoColumns([1, 2, 3, 4]);
    expect(left).toEqual([1, 2]);
    expect(right).toEqual([3, 4]);
  });

  it("returns two empty arrays for an empty list", () => {
    expect(splitIntoColumns([])).toEqual([[], []]);
  });
});
