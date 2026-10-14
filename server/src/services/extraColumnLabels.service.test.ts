import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  extraColumnLabel: { findUnique: vi.fn(), upsert: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
}));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
const assertPeriodOpen = vi.hoisted(() => vi.fn());
vi.mock("./dayLock.service", () => ({ assertPeriodOpen, assertEarlierDaysFinished: vi.fn() }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ logSystemEvent }));

import { saveExtraLabel } from "./extraColumnLabels.service";

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
