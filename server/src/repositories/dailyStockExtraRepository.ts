import { Shift, StockLocation } from "@prisma/client";
import { prisma, type Db } from "../lib/prisma";
import type { StockExtraInput } from "../utils/stockExtras";

export interface StockExtraRow {
  productId: number;
  columnKey: string;
  slotIndex: number;
  amount: unknown;
}

/// daily_stock_extra - the individual amounts behind a grid column that was
/// given extra input columns. The main column on daily_online_stock /
/// daily_offline_stock still holds their total; nothing reads these except the
/// grid that has to redraw the columns, so this repository is deliberately
/// small (load a sheet, replace one column's set).
export const dailyStockExtraRepository = {
  /// Every extra on one sheet, for a grid/report load. One query for the whole
  /// date+shift rather than one per product - the grid asks for ~60 products
  /// at once, which is exactly the N+1 the opening-stock lookups already avoid.
  findAllForDate(location: StockLocation, entryDate: Date, shift: Shift, db: Db = prisma): Promise<StockExtraRow[]> {
    return db.dailyStockExtra.findMany({
      where: { location, entryDate, shift },
      select: { productId: true, columnKey: true, slotIndex: true, amount: true },
      orderBy: [{ columnKey: "asc" }, { slotIndex: "asc" }],
    });
  },

  findForProduct(location: StockLocation, productId: number, entryDate: Date, shift: Shift, db: Db = prisma): Promise<StockExtraRow[]> {
    return db.dailyStockExtra.findMany({
      where: { location, productId, entryDate, shift },
      select: { productId: true, columnKey: true, slotIndex: true, amount: true },
      orderBy: [{ columnKey: "asc" }, { slotIndex: "asc" }],
    });
  },

  /**
   * Replaces one product's extras for the given columns outright: every stored
   * amount for those columns is deleted, then whatever is in `extras` is
   * written.
   *
   * Replace rather than upsert because a deleted column has to actually
   * disappear - an upsert would leave the row for a column the encoder removed
   * sitting in the table, and its amount would reappear (and no longer add up
   * to the main column's total) on the next load. Passing no `extras` for a
   * column is therefore how "Save total only" clears it.
   */
  async replaceColumns(
    location: StockLocation,
    productId: number,
    entryDate: Date,
    shift: Shift,
    columnKeys: string[],
    extras: StockExtraInput[],
    encodedById: number | undefined,
    db: Db = prisma,
  ) {
    if (columnKeys.length === 0) return;
    await db.dailyStockExtra.deleteMany({
      where: { location, productId, entryDate, shift, columnKey: { in: columnKeys } },
    });
    if (extras.length === 0) return;
    await db.dailyStockExtra.createMany({
      data: extras.map((e) => ({
        location,
        productId,
        entryDate,
        shift,
        columnKey: e.columnKey,
        slotIndex: e.slotIndex,
        amount: e.amount,
        encodedById,
      })),
    });
  },
};
