import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  clientError: { deleteMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));

import { purgeClientErrors, recordClientError } from "./clientError.service";

const NOW = Date.parse("2026-10-24T06:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.clientError.deleteMany.mockResolvedValue({ count: 0 });
  prismaMock.clientError.findFirst.mockResolvedValue(null);
});

describe("purgeClientErrors - the anonymous error-report table stays bounded", () => {
  it("deletes reports older than the retention window", async () => {
    prismaMock.clientError.deleteMany.mockResolvedValueOnce({ count: 7 });

    const removed = await purgeClientErrors({ olderThanDays: 90, maxRows: 0 }, NOW);

    expect(removed).toBe(7);
    expect(prismaMock.clientError.deleteMany).toHaveBeenCalledWith({ where: { createdAt: { lt: new Date(NOW - 90 * DAY) } } });
    // maxRows 0 = off: the row-cap lookup is never made.
    expect(prismaMock.clientError.findFirst).not.toHaveBeenCalled();
  });

  it("trims to the newest N rows by removing everything at or below the first row outside the cap", async () => {
    prismaMock.clientError.findFirst.mockResolvedValueOnce({ id: 1500 });
    prismaMock.clientError.deleteMany.mockResolvedValueOnce({ count: 1500 });

    const removed = await purgeClientErrors({ olderThanDays: 0, maxRows: 20_000 }, NOW);

    expect(removed).toBe(1500);
    // skip: maxRows -> the newest row that would be the (maxRows + 1)th.
    expect(prismaMock.clientError.findFirst).toHaveBeenCalledWith({ orderBy: { id: "desc" }, skip: 20_000, select: { id: true } });
    expect(prismaMock.clientError.deleteMany).toHaveBeenCalledWith({ where: { id: { lte: 1500 } } });
  });

  it("does nothing under the cap", async () => {
    prismaMock.clientError.findFirst.mockResolvedValueOnce(null);

    expect(await purgeClientErrors({ olderThanDays: 0, maxRows: 20_000 }, NOW)).toBe(0);
    expect(prismaMock.clientError.deleteMany).not.toHaveBeenCalled();
  });

  it("applies the age rule first, then the cap, and adds the two counts", async () => {
    prismaMock.clientError.deleteMany.mockResolvedValueOnce({ count: 4 }).mockResolvedValueOnce({ count: 6 });
    prismaMock.clientError.findFirst.mockResolvedValueOnce({ id: 99 });

    expect(await purgeClientErrors({ olderThanDays: 30, maxRows: 100 }, NOW)).toBe(10);
    expect(prismaMock.clientError.deleteMany).toHaveBeenNthCalledWith(1, { where: { createdAt: { lt: new Date(NOW - 30 * DAY) } } });
    expect(prismaMock.clientError.deleteMany).toHaveBeenNthCalledWith(2, { where: { id: { lte: 99 } } });
  });

  it("is a no-op with both limits off", async () => {
    expect(await purgeClientErrors({ olderThanDays: 0, maxRows: 0 }, NOW)).toBe(0);
    expect(prismaMock.clientError.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.clientError.findFirst).not.toHaveBeenCalled();
  });
});

describe("recordClientError", () => {
  it("cuts every field to its column size", async () => {
    prismaMock.clientError.create.mockResolvedValue({ id: 1 });
    await recordClientError({ page: "p".repeat(500), message: "m".repeat(2000), stack: "s".repeat(9000), source: "boundary", userAgent: "u".repeat(400) }, null);
    const data = prismaMock.clientError.create.mock.calls[0][0].data;
    expect([data.page.length, data.message.length, data.stack.length, data.userAgent.length]).toEqual([300, 1000, 8000, 300]);
  });
});
