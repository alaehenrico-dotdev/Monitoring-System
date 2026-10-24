import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  manualCount: { findFirst: vi.fn(), findMany: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import { manualCountRepository } from "./manualCountRepository";

const DATE = new Date("2026-06-15T00:00:00.000Z");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.manualCount.findFirst.mockResolvedValue(null);
  prismaMock.manualCount.findMany.mockResolvedValue([]);
});

describe("only published counts carry forward as an opening stock", () => {
  it("findLatestBefore ignores a count that has not been published", async () => {
    await manualCountRepository.findLatestBefore(1, DATE, "ONLINE");
    expect(prismaMock.manualCount.findFirst.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null } });
  });

  it("an applied count is the opening of whichever period comes next - a Night shift reads one too", async () => {
    prismaMock.manualCount.findFirst.mockResolvedValue({ entryDate: DATE, shift: "NIGHT", manualCount: 16 });
    expect(await manualCountRepository.findLatestBefore(1, DATE, "ONLINE")).toMatchObject({ manualCount: 16 });
    expect(prismaMock.manualCount.findFirst.mock.calls[0][0].where).toMatchObject({ appliedToOpening: true, entryDate: { lt: DATE } });
  });

  it("findLatestBeforeForProducts ignores unpublished counts", async () => {
    await manualCountRepository.findLatestBeforeForProducts([1, 2], DATE, "OFFLINE");
    expect(prismaMock.manualCount.findMany.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null } });
  });

  it("a saved row ignores a count published after the row was first saved", async () => {
    const savedAt = new Date("2026-06-10T08:00:00.000Z");
    await manualCountRepository.findLatestBefore(1, DATE, "ONLINE", undefined, savedAt);
    expect(prismaMock.manualCount.findFirst.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null, lte: savedAt } });
  });

  it("the batched lookup applies the same gate per product, falling back to an older count", async () => {
    const saved = new Date("2026-06-10T08:00:00.000Z");
    const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
    prismaMock.manualCount.findMany.mockResolvedValue([
      // Newest first. Product 1's newest count was published after its row was saved: skipped.
      { productId: 1, entryDate: day("2026-06-14"), shift: "NIGHT", manualCount: 50, publishedAt: new Date("2026-06-14T20:00:00.000Z") },
      { productId: 1, entryDate: day("2026-06-05"), shift: "NIGHT", manualCount: 40, publishedAt: new Date("2026-06-05T20:00:00.000Z") },
      // Product 2 has no saved row: its newest count is used.
      { productId: 2, entryDate: day("2026-06-14"), shift: "NIGHT", manualCount: 7, publishedAt: new Date("2026-06-14T20:00:00.000Z") },
    ]);
    const out = await manualCountRepository.findLatestBeforeForProducts([1, 2], DATE, "ONLINE", new Map([[1, saved]]));
    expect(out.map((c) => [c.productId, Number(c.manualCount)])).toEqual([
      [1, 40],
      [2, 7],
    ]);
    // The helper column is not part of the result.
    expect(out[0]).not.toHaveProperty("publishedAt");
  });

  it("findManyForKeys ignores unpublished counts", async () => {
    await manualCountRepository.findManyForKeys([{ productId: 1, entryDate: DATE, shift: "NIGHT" }], "ONLINE");
    expect(prismaMock.manualCount.findMany.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null } });
  });

  it("the Audit sheet's own list is not filtered - unpublished counts are still shown and editable", async () => {
    await manualCountRepository.findAllForDateAndLocation(DATE, "NIGHT", "ONLINE");
    expect(prismaMock.manualCount.findMany.mock.calls[0][0].where).not.toHaveProperty("publishedAt");
  });
});
