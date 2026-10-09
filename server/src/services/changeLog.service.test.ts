import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/changeLogRepository", () => ({
  changeLogRepository: {
    create: vi.fn(),
    findMany: vi.fn(),
    findForRecord: vi.fn(),
  },
}));

import { changeLogRepository } from "../repositories/changeLogRepository";
import { getCellHistory, isCellHistoryTable, listChangeLog, recordChange } from "./changeLog.service";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordChange", () => {
  it("forwards the change to the repository, defaulting db to the shared prisma client", async () => {
    vi.mocked(changeLogRepository.create).mockResolvedValue({} as never);

    await recordChange({ tableName: "products", recordId: 1, action: "UPDATE", changedById: 7, oldValue: { a: 1 }, newValue: { a: 2 } });

    expect(changeLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "products", recordId: 1, action: "UPDATE", changedById: 7 }),
      expect.anything(),
    );
  });

  it("passes through an explicit transaction client instead of the default", async () => {
    vi.mocked(changeLogRepository.create).mockResolvedValue({} as never);
    const tx = { fake: "transaction-client" } as never;

    await recordChange({ tableName: "receipts", recordId: 10, action: "CREATE" }, tx);

    expect(changeLogRepository.create).toHaveBeenCalledWith(expect.objectContaining({ tableName: "receipts" }), tx);
  });
});

describe("listChangeLog", () => {
  it("delegates the filters straight through to the repository", async () => {
    vi.mocked(changeLogRepository.findMany).mockResolvedValue([]);

    await listChangeLog({ tableName: "products", recordId: 1 });

    expect(changeLogRepository.findMany).toHaveBeenCalledWith({ tableName: "products", recordId: 1 });
  });
});

/// change_log rows as the repository returns them - whole-row JSON snapshots,
/// newest first.
function entry(action: "CREATE" | "UPDATE", oldValue: unknown, newValue: unknown, who = "Ana", changedAt = new Date("2026-10-09T08:00:00Z")) {
  return { action, oldValue, newValue, changedAt, changedBy: who === null ? null : { name: who } };
}

function mockEntries(rows: unknown[]) {
  vi.mocked(changeLogRepository.findForRecord).mockResolvedValue(rows as never);
}

const ONLINE = { tableName: "daily_online_stock", recordId: 100, field: "stockIn", limit: 10 };

describe("isCellHistoryTable", () => {
  it("allows the stock entry grids", () => {
    expect(isCellHistoryTable("daily_online_stock")).toBe(true);
    expect(isCellHistoryTable("daily_offline_stock")).toBe(true);
    expect(isCellHistoryTable("manual_counts")).toBe(true);
  });

  it("refuses every other audited table", () => {
    for (const t of ["products", "users", "import_batches", "change_log", ""]) {
      expect(isCellHistoryTable(t)).toBe(false);
    }
  });
});

describe("getCellHistory", () => {
  it("returns only the entries in which the requested field moved", async () => {
    mockEntries([
      entry("UPDATE", { stockIn: 5, productionIn: 1 }, { stockIn: 9, productionIn: 1 }),
      entry("UPDATE", { stockIn: 9, productionIn: 1 }, { stockIn: 9, productionIn: 4 }),
    ]);

    const out = await getCellHistory(ONLINE);

    expect(out).toEqual([
      { changedAt: new Date("2026-10-09T08:00:00Z"), who: "Ana", oldValue: 5, newValue: 9 },
    ]);
  });

  it("never leaks the other columns on the row", async () => {
    mockEntries([entry("UPDATE", { stockIn: 5, secret: 999 }, { stockIn: 9, secret: 999 })]);

    const out = await getCellHistory(ONLINE);

    expect(Object.keys(out[0])).toEqual(["changedAt", "who", "oldValue", "newValue"]);
    expect(JSON.stringify(out)).not.toContain("999");
  });

  it("counts a CREATE as setting a non-zero field", async () => {
    mockEntries([entry("CREATE", null, { stockIn: 12 })]);
    expect(await getCellHistory(ONLINE)).toEqual([
      { changedAt: new Date("2026-10-09T08:00:00Z"), who: "Ana", oldValue: null, newValue: 12 },
    ]);
  });

  it("ignores fields a CREATE merely left at their zero default", async () => {
    mockEntries([entry("CREATE", null, { stockIn: 0, productionIn: 3 })]);
    expect(await getCellHistory(ONLINE)).toEqual([]);
  });

  it("honours the limit", async () => {
    mockEntries(Array.from({ length: 30 }, (_, i) => entry("UPDATE", { stockIn: i }, { stockIn: i + 1 })));

    expect(await getCellHistory({ ...ONLINE, limit: 3 })).toHaveLength(3);
    expect(await getCellHistory({ ...ONLINE, limit: 10 })).toHaveLength(10);
  });

  it("compares Decimal strings numerically, not textually", async () => {
    mockEntries([
      entry("UPDATE", { stockIn: "5.00" }, { stockIn: "9.50" }),
      // Same number, different representation - not a change.
      entry("UPDATE", { stockIn: "9.50" }, { stockIn: 9.5 }),
    ]);

    expect(await getCellHistory(ONLINE)).toEqual([
      { changedAt: new Date("2026-10-09T08:00:00Z"), who: "Ana", oldValue: 5, newValue: 9.5 },
    ]);
  });

  it("reports a deleted user as null rather than failing", async () => {
    mockEntries([entry("CREATE", null, { stockIn: 2 }, null as never)]);
    expect((await getCellHistory(ONLINE))[0].who).toBeNull();
  });

  it("returns nothing when the record has no history at all", async () => {
    mockEntries([]);
    expect(await getCellHistory(ONLINE)).toEqual([]);
  });

  it("asks the repository for this exact record", async () => {
    mockEntries([]);
    await getCellHistory(ONLINE);
    expect(changeLogRepository.findForRecord).toHaveBeenCalledWith("daily_online_stock", 100);
  });
});
