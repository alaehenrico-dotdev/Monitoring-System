import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  dailyReportSnapshot: { findUnique: vi.fn(), upsert: vi.fn() },
  dayClosure: { findMany: vi.fn() },
  dailyOnlineStock: { groupBy: vi.fn() },
  dailyOfflineStock: { groupBy: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: db }));
const recordChange = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ recordChange }));

import { findFrozenSnapshot, saveSnapshot } from "./dailyReportSnapshot.service";

const DATE = new Date("2026-10-14T00:00:00.000Z");
const SNAP = { id: 1, entryDate: DATE, payload: { date: "2026-10-14" }, savedAt: new Date(), savedBy: null };

beforeEach(() => {
  vi.clearAllMocks();
  db.dailyReportSnapshot.findUnique.mockResolvedValue(SNAP);
  db.dailyOnlineStock.groupBy.mockResolvedValue([{ shift: "NIGHT" }]);
  db.dailyOfflineStock.groupBy.mockResolvedValue([{ shift: "NIGHT" }]);
});

describe("findFrozenSnapshot", () => {
  it("returns null when no snapshot exists", async () => {
    db.dailyReportSnapshot.findUnique.mockResolvedValue(null);
    expect(await findFrozenSnapshot(DATE)).toBeNull();
  });

  it("serves the snapshot when every shift with entries is closed", async () => {
    db.dayClosure.findMany.mockResolvedValue([{ shift: "NIGHT", isClosed: true }]);
    expect(await findFrozenSnapshot(DATE)).toBe(SNAP);
  });

  it("goes live when a shift with entries was never finished", async () => {
    db.dailyOnlineStock.groupBy.mockResolvedValue([{ shift: "MORNING" }, { shift: "NIGHT" }]);
    db.dayClosure.findMany.mockResolvedValue([{ shift: "MORNING", isClosed: true }]);
    expect(await findFrozenSnapshot(DATE)).toBeNull();
  });

  it("goes live once an admin unlocks the shift", async () => {
    db.dayClosure.findMany.mockResolvedValue([{ shift: "NIGHT", isClosed: false }]);
    expect(await findFrozenSnapshot(DATE)).toBeNull();
  });

  it("ignores a shift that has no entries at all", async () => {
    db.dailyOnlineStock.groupBy.mockResolvedValue([{ shift: "NIGHT" }]);
    db.dailyOfflineStock.groupBy.mockResolvedValue([]);
    db.dayClosure.findMany.mockResolvedValue([{ shift: "NIGHT", isClosed: true }]);
    expect(await findFrozenSnapshot(DATE)).toBe(SNAP);
  });
});

describe("saveSnapshot", () => {
  it("logs the first save as a CREATE with no old value", async () => {
    db.dailyReportSnapshot.findUnique.mockResolvedValue(null);
    db.dailyReportSnapshot.upsert.mockResolvedValue({ id: 4, savedAt: new Date("2026-10-14T01:00:00Z"), savedById: 3 });
    await saveSnapshot(DATE, { date: "2026-10-14" }, 3, db as never);
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "daily_report_snapshots", recordId: 4, action: "CREATE", changedById: 3, oldValue: undefined }),
      db,
    );
  });

  it("keeps the replaced version in full when a day is saved again", async () => {
    db.dailyReportSnapshot.findUnique.mockResolvedValue(SNAP);
    db.dailyReportSnapshot.upsert.mockResolvedValue({ id: 1, savedAt: new Date(), savedById: 3 });
    await saveSnapshot(DATE, { date: "2026-10-14", changed: true }, 3, db as never);
    const arg = recordChange.mock.calls[0][0];
    expect(arg.action).toBe("UPDATE");
    expect(arg.oldValue).toBe(SNAP);
    expect(arg.newValue).not.toHaveProperty("payload");
  });

  it("stores the JSON-roundtripped report, replacing any earlier snapshot", async () => {
    db.dailyReportSnapshot.upsert.mockResolvedValue({ id: 1, savedAt: new Date(), savedById: 3 });
    await saveSnapshot(DATE, { date: "2026-10-14", at: new Date("2026-10-14T01:00:00Z") }, 3, db as never);
    const arg = db.dailyReportSnapshot.upsert.mock.calls[0][0];
    expect(arg.create.payload).toEqual({ date: "2026-10-14", at: "2026-10-14T01:00:00.000Z" });
    expect(arg.update.savedById).toBe(3);
  });
});
