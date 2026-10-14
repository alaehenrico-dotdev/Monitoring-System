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
    await manualCountRepository.findLatestBefore(1, DATE, "MORNING", "ONLINE");
    expect(prismaMock.manualCount.findFirst.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null } });
  });

  it("a count opens the next day only - a Night shift never reads one", async () => {
    expect(await manualCountRepository.findLatestBefore(1, DATE, "NIGHT", "ONLINE")).toBeNull();
    expect(await manualCountRepository.findLatestBeforeForProducts([1], DATE, "NIGHT", "ONLINE")).toEqual([]);
    expect(prismaMock.manualCount.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.manualCount.findMany).not.toHaveBeenCalled();
  });

  it("findLatestBeforeForProducts ignores unpublished counts", async () => {
    await manualCountRepository.findLatestBeforeForProducts([1, 2], DATE, "MORNING", "OFFLINE");
    expect(prismaMock.manualCount.findMany.mock.calls[0][0].where).toMatchObject({ publishedAt: { not: null } });
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
