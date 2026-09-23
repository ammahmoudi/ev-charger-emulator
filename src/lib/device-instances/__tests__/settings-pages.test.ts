import { describe, expect, it } from "vitest";

import { formatFirmwareDate, paginateBySortOrder, splitIntoColumns } from "../settings-pages";

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

describe("formatFirmwareDate", () => {
  it("formats an ISO updatedAt as \"YYYY y MM m DD d\", matching the reference screenshot's style", () => {
    expect(formatFirmwareDate({ value: "403", updatedAt: "2025-06-26T10:00:00.000Z" })).toBe("2025 y 06 m 26 d");
  });

  it("pads single-digit month/day", () => {
    expect(formatFirmwareDate({ value: "403", updatedAt: "2025-01-05T00:00:00.000Z" })).toBe("2025 y 01 m 05 d");
  });

  it("returns \"—\" when the value is still at the model default (null)", () => {
    expect(formatFirmwareDate({ value: null, updatedAt: "2025-06-26T10:00:00.000Z" })).toBe("—");
  });

  it("returns \"—\" when there's no updatedAt", () => {
    expect(formatFirmwareDate({ value: "403", updatedAt: null })).toBe("—");
  });

  it("returns \"—\" when the parameter itself is undefined (key not found)", () => {
    expect(formatFirmwareDate(undefined)).toBe("—");
  });
});
