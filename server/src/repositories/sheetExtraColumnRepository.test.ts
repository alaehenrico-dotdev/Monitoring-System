import { describe, expect, it, vi } from "vitest";
import { sheetExtraColumnRepository } from "./sheetExtraColumnRepository";

const day = new Date("2026-10-19");

function fakeDb() {
  return {
    sheetExtraColumn: { deleteMany: vi.fn().mockResolvedValue({}), createMany: vi.fn().mockResolvedValue({}) },
    dailyStockExtra: { deleteMany: vi.fn().mockResolvedValue({}) },
  };
}

describe("sheetExtraColumnRepository.sync", () => {
  it("stores every slot the save carries, empty ones included", async () => {
    const db = fakeDb();
    await sheetExtraColumnRepository.sync("OFFLINE", day, "NIGHT", [{ columnKey: "deliveryOut", slotIndex: 1 }, { columnKey: "deliveryOut", slotIndex: 2 }], [], db as never);
    expect(db.sheetExtraColumn.createMany).toHaveBeenCalledWith({
      data: [
        { location: "OFFLINE", entryDate: day, shift: "NIGHT", columnKey: "deliveryOut", slotIndex: 1 },
        { location: "OFFLINE", entryDate: day, shift: "NIGHT", columnKey: "deliveryOut", slotIndex: 2 },
      ],
      skipDuplicates: true,
    });
  });

  it("drops a column's slots that are no longer in the save", async () => {
    const db = fakeDb();
    await sheetExtraColumnRepository.sync("OFFLINE", day, "NIGHT", [{ columnKey: "deliveryOut", slotIndex: 1 }, { columnKey: "deliveryOut", slotIndex: 3 }], [], db as never);
    expect(db.sheetExtraColumn.deleteMany).toHaveBeenCalledWith({
      where: { location: "OFFLINE", entryDate: day, shift: "NIGHT", columnKey: "deliveryOut", slotIndex: { notIn: [1, 3] } },
    });
    // Only the empty leftovers of the removed slot go for other products - never a real amount.
    expect(db.dailyStockExtra.deleteMany).toHaveBeenCalledWith({
      where: { location: "OFFLINE", entryDate: day, shift: "NIGHT", columnKey: "deliveryOut", slotIndex: { notIn: [1, 3] }, amount: 0 },
    });
  });

  it("removes a cleared column outright, and touches nothing else", async () => {
    const db = fakeDb();
    await sheetExtraColumnRepository.sync("ONLINE", day, "NIGHT", [], ["rts"], db as never);
    expect(db.sheetExtraColumn.deleteMany).toHaveBeenCalledTimes(1);
    expect(db.sheetExtraColumn.deleteMany).toHaveBeenCalledWith({ where: { location: "ONLINE", entryDate: day, shift: "NIGHT", columnKey: { in: ["rts"] } } });
    expect(db.dailyStockExtra.deleteMany).toHaveBeenCalledWith({ where: { location: "ONLINE", entryDate: day, shift: "NIGHT", columnKey: { in: ["rts"] } } });
    expect(db.sheetExtraColumn.createMany).not.toHaveBeenCalled();
  });
});
