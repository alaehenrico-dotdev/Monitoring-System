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
  offlineEntryDelivery: [] as Record<string, unknown>[],
  manualCount: [] as Record<string, unknown>[],
  receipt: [] as Record<string, unknown>[],
  changeLog: [] as Record<string, unknown>[],
  deliveryDestination: [] as Record<string, unknown>[],
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
        offlineEntryDelivery: makeModel(db.offlineEntryDelivery),
        manualCount: makeModel(db.manualCount),
        receipt: makeModel(db.receipt),
        changeLog: makeModel(db.changeLog),
        // Present on tx (like every other model) purely so a future change
        // that mistakenly starts calling deleteMany on it would still show
        // up as a genuine row disappearing in the assertions below - never
        // called by resetAllData itself.
        deliveryDestination: makeModel(db.deliveryDestination),
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
  it("wipes an Offline entry and its OfflineEntryDelivery breakdown, leaving the DeliveryDestination it referenced untouched", async () => {
    const destination = {
      id: 1,
      name: "West",
      isActive: true,
      sortOrder: 0,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    };
    db.deliveryDestination.push({ ...destination });
    // upsellOut lives directly on the Offline entry row - deleting the row
    // is all that's needed to reset it too, nothing separate to assert.
    db.dailyOfflineStock.push({ id: 10, productId: 1, entryDate: new Date("2026-06-01"), shift: "NIGHT", deliveryOut: 12, upsellOut: 5 });
    db.offlineEntryDelivery.push({ id: 100, offlineEntryId: 10, destinationId: 1, quantity: 12 });

    const token = verifyPasscode(env.dataResetPasscode, USER);
    if (!token) throw new Error("test setup: passcode didn't verify against env.dataResetPasscode");

    await resetAllData(token, USER);

    expect(db.dailyOfflineStock).toHaveLength(0);
    expect(db.offlineEntryDelivery).toHaveLength(0);
    // Not just "still present" - unchanged, so the reset can't have
    // silently touched it either (e.g. an accidental isActive flip).
    expect(db.deliveryDestination).toEqual([destination]);
  });
});
