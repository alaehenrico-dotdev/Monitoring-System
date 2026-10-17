import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./changeLog.service", () => ({ recordChange: vi.fn() }));
vi.mock("./dayLock.service", () => ({}));

import { recordChange } from "./changeLog.service";
import { holdStaleOpening, STALE_OPENING_FIELD } from "./staleOpening.service";
import { canonical } from "./snapshotRefresh.service";

vi.mock("../lib/prisma", () => ({ prisma: {} }));
vi.mock("./reports.service", () => ({ buildDailyReport: vi.fn() }));
vi.mock("./dailyReportSnapshot.service", () => ({ findFrozenSnapshot: vi.fn(), saveSnapshot: vi.fn() }));

const db = {
  correctionRequest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
} as never as Parameters<typeof holdStaleOpening>[4] & {
  correctionRequest: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.correctionRequest.create.mockImplementation(async ({ data }: { data: object }) => ({ id: 9, ...data }));
  db.correctionRequest.update.mockImplementation(async ({ data }: { data: object }) => ({ id: 9, ...data }));
});

describe("holdStaleOpening", () => {
  const row = { id: 50, openingStock: "80.00" };

  it("files a pending request on the locked row's opening stock, naming the change that caused it", async () => {
    db.correctionRequest.findFirst.mockResolvedValue(null);
    await holdStaleOpening("ONLINE", row, 180, 3, db, 77);

    const { data } = db.correctionRequest.create.mock.calls[0][0];
    expect(data).toMatchObject({
      tableName: "daily_online_stock",
      recordId: 50,
      field: STALE_OPENING_FIELD,
      beforeValue: "80",
      proposedValue: "180",
      requestedById: 3,
    });
    expect(data.reason).toContain("Held for approval");
    expect(vi.mocked(recordChange).mock.calls[0][0]).toMatchObject({ tableName: "correction_requests", action: "CREATE", causedById: 77 });
  });

  it("uses the Offline table for an Offline row", async () => {
    db.correctionRequest.findFirst.mockResolvedValue(null);
    await holdStaleOpening("OFFLINE", row, 5, 3, db);
    expect(db.correctionRequest.create.mock.calls[0][0].data.tableName).toBe("daily_offline_stock");
  });

  it("refreshes the one pending request when the carried figure moves again, instead of stacking a second", async () => {
    db.correctionRequest.findFirst.mockResolvedValue({ id: 9, beforeValue: "80", proposedValue: "180" });
    await holdStaleOpening("ONLINE", row, 195, 3, db);
    expect(db.correctionRequest.create).not.toHaveBeenCalled();
    expect(db.correctionRequest.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { beforeValue: "80", proposedValue: "195", requestedById: 3 } });
  });

  it("writes nothing when the pending request already says exactly this", async () => {
    db.correctionRequest.findFirst.mockResolvedValue({ id: 9, beforeValue: "80", proposedValue: "180" });
    await holdStaleOpening("ONLINE", row, 180, 3, db);
    expect(db.correctionRequest.update).not.toHaveBeenCalled();
    expect(recordChange).not.toHaveBeenCalled();
  });
});

describe("canonical (snapshot comparison)", () => {
  it("ignores key order, which MySQL's JSON column does not preserve", () => {
    expect(canonical({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } })).toBe(canonical({ a: { c: null, d: [1, { x: 1, y: 2 }] }, b: 1 }));
  });

  it("still tells different payloads apart, including array order and values", () => {
    expect(canonical({ a: [1, 2] })).not.toBe(canonical({ a: [2, 1] }));
    expect(canonical({ a: "1" })).not.toBe(canonical({ a: 1 }));
    expect(canonical({ a: undefined })).toBe(canonical({ a: undefined }));
  });
});
