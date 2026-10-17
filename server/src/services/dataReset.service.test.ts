import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal in-memory stand-in for the handful of tables resetAllData
// touches - real enough (deleteMany empties a table and reports how many
// rows it removed, create appends one) to catch an actual regression (a
// table left out of the transaction, or one that shouldn't be there at
// all), without standing up a real database for what's otherwise a pure
// unit test.
const db = vi.hoisted(() => ({
  dailyOnlineStock: [] as Record<string, unknown>[],
  dailyOfflineStock: [] as Record<string, unknown>[],
  dailyStockExtra: [] as Record<string, unknown>[],
  manualCount: [] as Record<string, unknown>[],
  importBatch: [] as Record<string, unknown>[],
  changeLog: [] as Record<string, unknown>[],
  reportHistoryEntry: [] as Record<string, unknown>[],
  dayClosure: [] as Record<string, unknown>[],
  dailyReportSnapshot: [] as Record<string, unknown>[],
  extraColumnLabel: [] as Record<string, unknown>[],
  correctionRequest: [] as Record<string, unknown>[],
  changeLogArchive: [] as Record<string, unknown>[],
  idempotencyKey: [] as Record<string, unknown>[],
  monthClosure: [] as Record<string, unknown>[],
  pendingRelease: [] as Record<string, unknown>[],
}));

function makeModel(table: Record<string, unknown>[]) {
  return {
    deleteMany: vi.fn(async () => {
      const count = table.length;
      table.length = 0; // truncate in place - callers hold this same array reference
      return { count };
    }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: table.length + 1, ...data };
      table.push(row);
      return row;
    }),
  };
}

vi.mock("../lib/prisma", () => ({
  prisma: {
    $transaction: (cb: (tx: unknown) => unknown) =>
      cb({
        dailyOnlineStock: makeModel(db.dailyOnlineStock),
        dailyOfflineStock: makeModel(db.dailyOfflineStock),
        dailyStockExtra: makeModel(db.dailyStockExtra),
        manualCount: makeModel(db.manualCount),
        importBatch: makeModel(db.importBatch),
        changeLog: makeModel(db.changeLog),
        reportHistoryEntry: makeModel(db.reportHistoryEntry),
        dayClosure: makeModel(db.dayClosure),
        dailyReportSnapshot: makeModel(db.dailyReportSnapshot),
        extraColumnLabel: makeModel(db.extraColumnLabel),
        correctionRequest: makeModel(db.correctionRequest),
        changeLogArchive: makeModel(db.changeLogArchive),
        idempotencyKey: makeModel(db.idempotencyKey),
        monthClosure: makeModel(db.monthClosure),
        pendingRelease: makeModel(db.pendingRelease),
      }),
  },
}));

import { env } from "../config/env";
import type { AuthUser } from "../types/express";
import { resetAllData, verifyPasscode } from "./dataReset.service";

const USER: AuthUser = { id: 1, username: "admin", name: "Admin", role: "SUPERVISOR_ADMIN" };

beforeEach(() => {
  for (const table of Object.values(db)) table.length = 0;
});

describe("resetAllData", () => {
  it("wipes an Offline entry, leaving nothing behind", async () => {
    // upsellOut lives directly on the Offline entry row - deleting the row
    // is all that's needed to reset it too, nothing separate to assert.
    db.dailyOfflineStock.push({ id: 10, productId: 1, entryDate: new Date("2026-06-01"), shift: "NIGHT", deliveryOut: 12, upsellOut: 5 });
    // The individual amounts behind a column that was given extra input
    // columns belong to that entry, so they go with it.
    db.dailyStockExtra.push({ id: 1, location: "OFFLINE", productId: 1, entryDate: new Date("2026-06-01"), shift: "NIGHT", columnKey: "backloads", slotIndex: 1, amount: 12 });

    const token = verifyPasscode(env.dataResetPasscode, USER);
    if (!token) throw new Error("test setup: passcode didn't verify against env.dataResetPasscode");

    await resetAllData(token, USER);

    expect(db.dailyOfflineStock).toHaveLength(0);
    expect(db.dailyStockExtra).toHaveLength(0);
  });

  it("also clears what the per-page Finish day, snapshots and approvals left behind", async () => {
    db.dayClosure.push({ id: 1, entryDate: new Date("2026-06-01"), shift: "NIGHT", onlineLocked: true, offlineLocked: false });
    db.dailyReportSnapshot.push({ id: 1, entryDate: new Date("2026-06-01"), payload: {} });
    db.extraColumnLabel.push({ id: 1, location: "ONLINE", columnKey: "stockInOffToOl", slotIndex: 1, label: "Route A" });
    db.correctionRequest.push({ id: 1, tableName: "daily_online_stock", recordId: 10, field: "stockInOffToOl", status: "PENDING" });
    db.changeLogArchive.push({ id: 5, tableName: "daily_online_stock", recordId: 10 });
    db.idempotencyKey.push({ id: 1, key: "abc", userId: 1 });
    db.monthClosure.push({ id: 1, yearMonth: "2026-06", isClosed: true });
    db.pendingRelease.push({ id: 1, productId: 3, quantity: 12, status: "AWAITING" });

    const token = verifyPasscode(env.dataResetPasscode, USER);
    if (!token) throw new Error("test setup: passcode didn't verify against env.dataResetPasscode");
    const result = await resetAllData(token, USER);

    for (const table of [db.dayClosure, db.dailyReportSnapshot, db.extraColumnLabel, db.correctionRequest, db.changeLogArchive, db.idempotencyKey, db.monthClosure, db.pendingRelease]) {
      expect(table).toHaveLength(0);
    }
    expect(result.deleted).toMatchObject({ dayClosures: 1, reportSnapshots: 1, extraColumnLabels: 1, corrections: 1, changeLogArchive: 1, idempotencyKeys: 1, monthClosures: 1, pendingReleases: 1 });
  });
});
