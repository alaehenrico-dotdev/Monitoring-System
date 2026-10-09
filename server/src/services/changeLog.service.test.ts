import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/changeLogRepository", () => ({
  REPORTS_TABLE: "reports",
  changeLogRepository: {
    create: vi.fn(),
    findPage: vi.fn(),
    findStockRecordsByIds: vi.fn(),
    findProductsByIds: vi.fn(),
    findForRecord: vi.fn(),
  },
}));

import { changeLogRepository } from "../repositories/changeLogRepository";
import { exportChangeLogCsv, getCellHistory, isCellHistoryTable, listChangeLog, recordChange } from "./changeLog.service";

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

function logRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    tableName: "manual_counts",
    recordId: 10,
    action: "UPDATE",
    changedById: 7,
    changedAt: new Date("2026-10-09T08:00:00Z"),
    oldValue: { productId: 5, entryDate: "2026-10-09T00:00:00.000Z", shift: "NIGHT", location: "ONLINE", manualCount: "12.00" },
    newValue: { productId: 5, entryDate: "2026-10-09T00:00:00.000Z", shift: "NIGHT", location: "ONLINE", manualCount: "10.00" },
    importBatchId: null,
    changedBy: { id: 7, name: "Ana", username: "ana", role: "ENCODER" },
    ...over,
  };
}

describe("listChangeLog", () => {
  beforeEach(() => {
    vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([] as never);
    vi.mocked(changeLogRepository.findProductsByIds).mockResolvedValue([{ id: 5, sku: "AFP007", name: "Soy Sauce 1L" }] as never);
  });

  it("passes the filters and the default page size to the repository", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([]);

    await listChangeLog({ tableName: "products", userId: 3 });

    expect(changeLogRepository.findPage).toHaveBeenCalledWith({ tableName: "products", userId: 3 }, { limit: 100, cursor: undefined });
  });

  it("caps the page size", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([]);
    await listChangeLog({}, { limit: 99999 });
    expect(changeLogRepository.findPage).toHaveBeenCalledWith({}, { limit: 500, cursor: undefined });
  });

  it("returns a nextCursor only when more rows exist, and drops the lookahead row", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow({ id: 30 }), logRow({ id: 29 }), logRow({ id: 28 })] as never);

    const page = await listChangeLog({}, { limit: 2, cursor: 31 });

    expect(page.items.map((i) => i.id)).toEqual([30, 29]);
    expect(page.nextCursor).toBe(29);
    expect(changeLogRepository.findPage).toHaveBeenCalledWith({}, { limit: 2, cursor: 31 });
  });

  it("has no nextCursor on the last page", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow({ id: 5 })] as never);
    expect((await listChangeLog({}, { limit: 2 })).nextCursor).toBeNull();
  });

  it("labels a stock row from the live record and its product", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow()] as never);
    vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([
      { id: 10, productId: 5, entryDate: new Date("2026-10-09T00:00:00Z"), shift: "NIGHT", location: "ONLINE" },
    ] as never);

    const [item] = (await listChangeLog({})).items;

    expect(item.context).toEqual({ productId: 5, sku: "AFP007", productName: "Soy Sauce 1L", entryDate: "2026-10-09", shift: "NIGHT", location: "ONLINE" });
    expect(item.summary).toBe("Manual count 12 → 10");
    expect(item.source).toBeNull();
  });

  it("falls back to the snapshot when the record was deleted", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow({ action: "DELETE", newValue: null })] as never);

    const [item] = (await listChangeLog({})).items;

    expect(item.context).toMatchObject({ productId: 5, entryDate: "2026-10-09", shift: "NIGHT", location: "ONLINE", sku: "AFP007" });
  });

  it("keeps the ids but no names when the product is gone too", async () => {
    vi.mocked(changeLogRepository.findProductsByIds).mockResolvedValue([] as never);
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow()] as never);

    const [item] = (await listChangeLog({})).items;

    expect(item.context).toMatchObject({ productId: 5, sku: null, productName: null, entryDate: "2026-10-09" });
  });

  it("uses the table to say Online / Offline for stock rows", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow({ tableName: "daily_offline_stock", newValue: { productId: 5, shift: "MORNING" } })] as never);
    const [item] = (await listChangeLog({})).items;
    expect(item.context?.location).toBe("OFFLINE");
    expect(item.context?.shift).toBe("MORNING");
  });

  it("describes a generated report with its section, and leaves it out when unrecorded", async () => {
    const report = (newValue: unknown) =>
      logRow({ tableName: "reports", recordId: 3, action: "CREATE", oldValue: null, newValue });
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([
      report({ type: "Daily Report", scope: "2026-10-09", section: "online", route: "/x" }),
      report({ type: "Variance Report", scope: "2026-10-09", section: null, route: "/y" }),
    ] as never);

    const items = (await listChangeLog({ tableName: "reports" })).items;

    expect(items.map((i) => i.summary)).toEqual(["Daily Report · Online · 2026-10-09", "Variance Report · 2026-10-09"]);
    expect(items[0].context).toBeNull();
    expect(items[0].changes).toEqual([]);
  });

  it("tags import and data-reset rows", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([
      logRow({ id: 3, importBatchId: 9 }),
      logRow({ id: 2, tableName: "system", recordId: 0, oldValue: null, newValue: { event: "data_reset", deleted: {} } }),
    ] as never);

    const items = (await listChangeLog({})).items;

    expect(items.map((i) => i.source)).toEqual(["import", "reset"]);
    expect(items[1].context).toBeNull();
  });
});

describe("exportChangeLogCsv", () => {
  beforeEach(() => {
    vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([] as never);
    vi.mocked(changeLogRepository.findProductsByIds).mockResolvedValue([{ id: 5, sku: "AFP007", name: 'Soy "Sauce", 1L' }] as never);
  });

  it("writes a header and one readable, escaped line per row", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow()] as never);

    const lines = (await exportChangeLogCsv({ shift: "NIGHT" })).split("\r\n");

    expect(lines[0]).toContain("When,Table,Action");
    expect(lines[1]).toBe('2026-10-09T08:00:00.000Z,manual_counts,UPDATE,,Ana,AFP007,"Soy ""Sauce"", 1L",2026-10-09,Night,Online,Manual count 12 → 10,10');
    expect(changeLogRepository.findPage).toHaveBeenCalledWith({ shift: "NIGHT" }, expect.objectContaining({ limit: 500 }));
  });

  it("follows the cursor until the last page", async () => {
    vi.mocked(changeLogRepository.findPage)
      .mockResolvedValueOnce(Array.from({ length: 501 }, (_, i) => logRow({ id: 2000 - i })) as never)
      .mockResolvedValueOnce([logRow({ id: 5 })] as never);

    const lines = (await exportChangeLogCsv({})).split("\r\n");

    expect(lines).toHaveLength(1 + 500 + 1);
    expect(vi.mocked(changeLogRepository.findPage).mock.calls[1][1].cursor).toBe(1501);
  });

  it("neutralises spreadsheet formulas", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([logRow({ changedBy: { id: 1, name: "=HYPERLINK(1)", username: "x", role: "ENCODER" } })] as never);
    expect(await exportChangeLogCsv({})).toContain("'=HYPERLINK(1)");
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
