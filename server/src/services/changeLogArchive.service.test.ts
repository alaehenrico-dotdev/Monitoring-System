import { beforeEach, describe, expect, it, vi } from "vitest";

const tx = {
  changeLogArchive: { createMany: vi.fn() },
  changeLog: { deleteMany: vi.fn() },
};
const prismaMock = vi.hoisted(() => ({
  changeLog: { findMany: vi.fn(), deleteMany: vi.fn() },
  changeLogArchive: { findMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("./changeLog.service", () => ({ logSystemEvent: vi.fn() }));

import { logSystemEvent } from "./changeLog.service";
import { archiveChangeLog, archiveCutoff, listArchive, NOISY_SYSTEM_EVENTS, purgeNoisySystemEvents } from "./changeLogArchive.service";

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

describe("purgeNoisySystemEvents", () => {
  const NOW = Date.parse("2026-11-25T00:00:00Z");

  it("does nothing when retention is 0", async () => {
    expect(await purgeNoisySystemEvents(0, NOW)).toBe(0);
    expect(prismaMock.changeLog.findMany).not.toHaveBeenCalled();
  });

  it("deletes only the listed failure events of the system log, older than the cutoff", async () => {
    prismaMock.changeLog.findMany.mockResolvedValueOnce([{ id: 4 }, { id: 9 }]);
    prismaMock.changeLog.deleteMany.mockResolvedValueOnce({ count: 2 });
    expect(await purgeNoisySystemEvents(90, NOW)).toBe(2);

    const where = prismaMock.changeLog.findMany.mock.calls[0][0].where;
    expect(where.tableName).toBe("system");
    expect(where.changedAt.lt.toISOString().slice(0, 10)).toBe("2026-08-27");
    const events = where.OR.map((c: { newValue: { equals: string } }) => c.newValue.equals);
    expect(events).toEqual([...NOISY_SYSTEM_EVENTS]);
    expect(prismaMock.changeLog.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [4, 9] } } });
    expect(logSystemEvent).toHaveBeenCalledWith("system_events_purged", {
      removed: 2,
      olderThanDays: 90,
      before: new Date(NOW - 90 * 86_400_000).toISOString(),
      events: NOISY_SYSTEM_EVENTS,
    });
  });

  it("says so in the log line when a run stopped at its batch limit", async () => {
    prismaMock.changeLog.findMany.mockResolvedValue(Array.from({ length: 1000 }, (_, i) => ({ id: i + 1 })));
    prismaMock.changeLog.deleteMany.mockResolvedValue({ count: 1000 });
    expect(await purgeNoisySystemEvents(90, NOW)).toBe(50_000);
    expect(vi.mocked(logSystemEvent).mock.calls[0][1]).toMatchObject({ removed: 50_000, moreToDelete: true });
    prismaMock.changeLog.findMany.mockReset();
    prismaMock.changeLog.deleteMany.mockReset();
  });

  it("never lists sign-ins or successful security changes as noise", () => {
    for (const keep of ["login", "password_changed", "password_reset_by_code", "mfa_enabled", "recovery_email_confirmed", "backup_restore"]) {
      expect(NOISY_SYSTEM_EVENTS).not.toContain(keep);
    }
  });

  it("writes no log line when there was nothing to delete", async () => {
    prismaMock.changeLog.findMany.mockResolvedValueOnce([]);
    expect(await purgeNoisySystemEvents(90, NOW)).toBe(0);
    expect(logSystemEvent).not.toHaveBeenCalled();
    expect(prismaMock.changeLog.deleteMany).not.toHaveBeenCalled();
  });
});

describe("listArchive", () => {
  it("applies the date, user and action filters and caps the count", async () => {
    prismaMock.changeLogArchive.findMany
      .mockResolvedValueOnce([row(5)])
      .mockResolvedValueOnce(Array.from({ length: 10_001 }, (_, i) => ({ id: i })));
    const dateFrom = new Date("2025-01-01");

    const out = await listArchive({ limit: 100, dateFrom, userId: 3, action: "DELETE" });

    const where = prismaMock.changeLogArchive.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ changedAt: { gte: dateFrom }, changedById: 3, action: "DELETE" });
    expect(out).toMatchObject({ total: 10_000, totalCapped: true });
    expect(out.items).toHaveLength(1);
  });

  it("reports an exact total under the cap", async () => {
    prismaMock.changeLogArchive.findMany.mockResolvedValueOnce([row(5)]).mockResolvedValueOnce([{ id: 5 }]);
    expect(await listArchive({ limit: 100 })).toEqual({ items: [row(5)], total: 1 });
  });
});
