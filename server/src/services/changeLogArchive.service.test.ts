import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  changeLogArchive: { createMany: vi.fn() },
  changeLog: { deleteMany: vi.fn() },
};
const prismaMock = vi.hoisted(() => ({
  changeLog: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));

import { archiveChangeLog, archiveCutoff } from "./changeLogArchive.service";

const row = (id: number) => ({ id, tableName: "daily_online_stock", recordId: 1, action: "UPDATE", changedById: 1, changedAt: new Date("2025-01-01"), oldValue: null, newValue: { a: 1 }, importBatchId: null, causedById: null });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation((fn: (t: typeof tx) => unknown) => fn(tx));
});

describe("archiveCutoff", () => {
  it("goes back the given number of months", () => {
    expect(archiveCutoff(12, new Date("2026-10-13T00:00:00Z")).toISOString().slice(0, 10)).toBe("2025-10-13");
  });
});

describe("archiveChangeLog", () => {
  it("copies then deletes each batch in one transaction, skipping import-linked rows", async () => {
    prismaMock.changeLog.findMany.mockResolvedValueOnce([row(1), row(2)]);
    const moved = await archiveChangeLog(new Date("2025-10-13"));

    expect(moved).toBe(2);
    expect(prismaMock.changeLog.findMany.mock.calls[0][0].where).toMatchObject({ importBatchId: null });
    expect(tx.changeLogArchive.createMany.mock.calls[0][0].data.map((r: { id: number }) => r.id)).toEqual([1, 2]);
    expect(tx.changeLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1, 2] } } });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });

  it("does nothing when there is nothing old enough", async () => {
    prismaMock.changeLog.findMany.mockResolvedValueOnce([]);
    expect(await archiveChangeLog(new Date())).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
