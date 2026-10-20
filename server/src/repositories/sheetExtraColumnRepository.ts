import { Shift, StockLocation } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import type { StockExtraInput } from "../utils/stockExtras";

/// sheet_extra_columns - which added columns a sheet was saved with, whether or
/// not any product has an amount in them (daily_stock_extra only holds
/// amounts, so an empty column left no trace there).
export const sheetExtraColumnRepository = {
  findForSheet(location: StockLocation, entryDate: Date, shift: Shift, db: Db = prisma) {
    return db.sheetExtraColumn.findMany({
      where: { location, entryDate, shift },
      select: { columnKey: true, slotIndex: true },
      orderBy: [{ columnKey: "asc" }, { slotIndex: "asc" }],
    });
  },

  /**
   * Makes the stored layout for each column named in `extras` match the slots
   * the save carries (a column deleted from the middle drops out), and removes
   * the columns in `clearColumns` outright. Columns this save does not mention
   * are left alone.
   */
  async sync(
    location: StockLocation,
    entryDate: Date,
    shift: Shift,
    extras: Pick<StockExtraInput, "columnKey" | "slotIndex">[],
    clearColumns: string[],
    db: Db = prisma,
  ) {
    const slotsByColumn = new Map<string, number[]>();
    for (const e of extras) slotsByColumn.set(e.columnKey, [...(slotsByColumn.get(e.columnKey) ?? []), e.slotIndex]);
    const cleared = clearColumns.filter((c) => !slotsByColumn.has(c));
    // A column cleared outright (every added column of it deleted) goes for every
    // product, amounts included: the encoder removed it deliberately.
    if (cleared.length > 0) {
      await db.sheetExtraColumn.deleteMany({ where: { location, entryDate, shift, columnKey: { in: cleared } } });
      await db.dailyStockExtra.deleteMany({ where: { location, entryDate, shift, columnKey: { in: cleared } } });
    }
    for (const [columnKey, slots] of slotsByColumn) {
      const gone = { location, entryDate, shift, columnKey, slotIndex: { notIn: slots } };
      await db.sheetExtraColumn.deleteMany({ where: gone });
      // Only EMPTY leftovers of the removed slot go for other products. A
      // non-zero amount is real data: the entry page re-saves every product
      // that holds one when a column is removed, and a stale browser tab that
      // simply never had this slot must not be able to wipe it.
      await db.dailyStockExtra.deleteMany({ where: { ...gone, amount: 0 } });
    }
    if (extras.length > 0) {
      await db.sheetExtraColumn.createMany({
        data: extras.map((e) => ({ location, entryDate, shift, columnKey: e.columnKey, slotIndex: e.slotIndex })),
        skipDuplicates: true,
      });
    }
  },
};
