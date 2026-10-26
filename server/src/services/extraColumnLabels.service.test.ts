import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  extraColumnLabel: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
const assertPeriodOpen = vi.hoisted(() => vi.fn());
vi.mock("./dayLock.service", () => ({ assertPeriodOpen, assertEarlierDaysFinished: vi.fn() }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ logSystemEvent }));

import { getDayExtraNames, saveExtraLabel } from "./extraColumnLabels.service";

const DATE = new Date("2026-10-14T00:00:00.000Z");
const base = { location: "OFFLINE" as const, entryDate: DATE, shift: "NIGHT" as const, columnKey: "deliveryOut", slotIndex: 1 };

describe("saveExtraLabel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("stores a trimmed name and logs it", async () => {
    prismaMock.extraColumnLabel.findUnique.mockResolvedValue(null);
    await saveExtraLabel({ ...base, label: "  Route   A " }, 7);
    expect(prismaMock.extraColumnLabel.upsert.mock.calls[0][0].create.label).toBe("Route A");
    expect(logSystemEvent).toHaveBeenCalledWith("extra_column_label", expect.objectContaining({ to: "Route A" }), 7, "CREATE");
  });

  it("deletes the row for a blank name", async () => {
    prismaMock.extraColumnLabel.findUnique.mockResolvedValue({ label: "Route A" });
    await saveExtraLabel({ ...base, label: " " }, 7);
    expect(prismaMock.extraColumnLabel.delete).toHaveBeenCalled();
    expect(logSystemEvent.mock.calls[0][3]).toBe("DELETE");
  });

  it("does nothing when the name is unchanged", async () => {
    prismaMock.extraColumnLabel.findUnique.mockResolvedValue({ label: "Route A" });
    await saveExtraLabel({ ...base, label: "Route A" });
    expect(prismaMock.extraColumnLabel.upsert).not.toHaveBeenCalled();
    expect(logSystemEvent).not.toHaveBeenCalled();
  });

  it("rejects a column that cannot have extras and a locked day", async () => {
    await expect(saveExtraLabel({ ...base, columnKey: "remainingStock", label: "x" })).rejects.toThrow();
    assertPeriodOpen.mockRejectedValueOnce(new Error("closed"));
    await expect(saveExtraLabel({ ...base, label: "x" })).rejects.toThrow("closed");
  });
});

describe("getDayExtraNames", () => {
  beforeEach(() => vi.clearAllMocks());
  const row = (location: string, shift: string, columnKey: string, slotIndex: number, label: string) => ({ location, shift, columnKey, slotIndex, label });

  it("keys the names by the column's key in a report row, per location", async () => {
    prismaMock.extraColumnLabel.findMany.mockResolvedValue([row("OFFLINE", "NIGHT", "deliveryOut", 1, "Route A"), row("ONLINE", "NIGHT", "fulfillmentOut", 2, "Shopee")]);
    expect(await getDayExtraNames(DATE)).toEqual({ ONLINE: { fulfillmentOut__x2: "Shopee" }, OFFLINE: { deliveryOut__x1: "Route A" } });
    expect(prismaMock.extraColumnLabel.findMany.mock.calls[0][0].where).toEqual({ entryDate: DATE });
  });

  it("shows both names, Morning first, when the two shifts named a slot differently", async () => {
    // Returned Night-first on purpose: the order must not depend on the database's.
    prismaMock.extraColumnLabel.findMany.mockResolvedValue([row("OFFLINE", "NIGHT", "deliveryOut", 1, "Route B"), row("OFFLINE", "MORNING", "deliveryOut", 1, "Route A")]);
    expect((await getDayExtraNames(DATE)).OFFLINE.deliveryOut__x1).toBe("Route A / Route B");
  });

  it("does not repeat a name both shifts agree on", async () => {
    prismaMock.extraColumnLabel.findMany.mockResolvedValue([row("OFFLINE", "MORNING", "deliveryOut", 1, "Route A"), row("OFFLINE", "NIGHT", "deliveryOut", 1, "Route A")]);
    expect((await getDayExtraNames(DATE)).OFFLINE.deliveryOut__x1).toBe("Route A");
  });

  it("is empty for a day with no names", async () => {
    prismaMock.extraColumnLabel.findMany.mockResolvedValue([]);
    expect(await getDayExtraNames(DATE)).toEqual({ ONLINE: {}, OFFLINE: {} });
  });
});
