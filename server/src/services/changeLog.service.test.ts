import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../repositories/changeLogRepository", () => ({
  REPORTS_TABLE: "reports",
  SNAPSHOT_TABLE: "daily_report_snapshots",
  changeLogRepository: {
    create: vi.fn(),
    findPage: vi.fn(),
    findStockRecordsByIds: vi.fn(),
    findProductsByIds: vi.fn(),
    findForRecord: vi.fn(),
    findRecentUserEdits: vi.fn(),
    findDayClosures: vi.fn(),
  },
}));

import { changeLogRepository } from "../repositories/changeLogRepository";
import { exportChangeLogCsv, getCellHistory, getRecentlyChangedCells, isCellHistoryTable, listChangeLog, recordChange } from "./changeLog.service";

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

  it("describes a saved daily report without dumping its payload", async () => {
    vi.mocked(changeLogRepository.findPage).mockResolvedValue([
      logRow({ tableName: "daily_report_snapshots", action: "UPDATE", oldValue: { payload: { online: [] } }, newValue: { entryDate: "2026-10-14" } }),
    ] as never);

    const [item] = (await listChangeLog({})).items;

    expect(item.summary).toMatch(/saved again; the previous version is kept/);
    expect(item.changes).toEqual([]);
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

describe("getRecentlyChangedCells", () => {
  // No sheet is finished unless a test says so.
  beforeEach(() => {
    vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([]);
    vi.mocked(changeLogRepository.findDayClosures).mockResolvedValue([]);
  });

  it("keeps cells from earlier saves when a later save touched something else", async () => {
    vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
      { recordId: 7, action: "UPDATE", oldValue: { delivered: 1, remarks: 0 }, newValue: { delivered: 1, remarks: 4 } },
      { recordId: 7, action: "UPDATE", oldValue: { delivered: 0 }, newValue: { delivered: 1 } },
    ] as never);
    const out = await getRecentlyChangedCells("daily_online_stock", [7]);
    expect(out[7].sort()).toEqual(["delivered", "remarks"]);
  });

  it("glows the Delivery (Out) cell: it is typed directly in the Offline grid, not only a sum", async () => {
    vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
      {
        recordId: 9,
        action: "UPDATE",
        oldValue: { delivery1: 5, deliveryOut: 5, offlineStock: 20, remainingStock: 15 },
        newValue: { delivery1: 8, deliveryOut: 8, offlineStock: 20, remainingStock: 12 },
      },
    ] as never);
    const out = await getRecentlyChangedCells("daily_offline_stock", [9]);
    expect(out[9].sort()).toEqual(["delivery1", "deliveryOut"]);
  });

  it("glows only the Delivery added column whose amount moved, not every one saved with it", async () => {
    // The old snapshot holds delivery1..5; the new one also carries them as deliveryOut__x1..x3.
    vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
      {
        recordId: 9,
        action: "UPDATE",
        oldValue: { delivery1: 5, delivery2: 3, delivery3: 0, deliveryOut: 8 },
        newValue: { delivery1: 5, delivery2: 4, delivery3: 0, deliveryOut: 9, deliveryOut__x1: 5, deliveryOut__x2: 4, deliveryOut__x3: 0 },
      },
    ] as never);
    const out = await getRecentlyChangedCells("daily_offline_stock", [9]);
    expect(out[9]).toContain("deliveryOut__x2");
    expect(out[9]).not.toContain("deliveryOut__x1");
    expect(out[9]).not.toContain("deliveryOut__x3");
  });

  it("does not glow a new added column that was saved empty", async () => {
    vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
      {
        recordId: 4,
        action: "UPDATE",
        oldValue: { fulfillmentOut: 6 },
        newValue: { fulfillmentOut: 6, fulfillmentOut__x1: 0, fulfillmentOut__x2: 0 },
      },
    ] as never);
    const out = await getRecentlyChangedCells("daily_online_stock", [4]);
    expect(out[4]).toBeUndefined();
  });

  it("still glows a new added column that holds an amount", async () => {
    vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
      {
        recordId: 4,
        action: "UPDATE",
        oldValue: { fulfillmentOut: 6 },
        newValue: { fulfillmentOut: 6, fulfillmentOut__x1: 2, fulfillmentOut__x2: 4 },
      },
    ] as never);
    const out = await getRecentlyChangedCells("daily_online_stock", [4]);
    expect(out[4].sort()).toEqual(["fulfillmentOut__x1", "fulfillmentOut__x2"]);
  });

  describe("until the sheet is finished", () => {
    const D = new Date("2026-10-20T00:00:00.000Z");
    const record = (id: number, shift = "NIGHT") => ({ id, productId: id, entryDate: D, shift });
    const closure = (over: object) => ({
      entryDate: D,
      shift: "NIGHT",
      onlineLocked: false,
      offlineLocked: false,
      closedAt: new Date("2026-10-21T02:00:00.000Z"),
      unlockedAt: null,
      ...over,
    });
    const edit = (changedAt: string, key: string, from: number, to: number) => ({
      recordId: 5,
      action: "UPDATE",
      changedAt: new Date(changedAt),
      oldValue: { [key]: from },
      newValue: { [key]: to },
    });

    it("has no time limit on a sheet nobody has finished", async () => {
      vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([record(5)] as never);
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([edit("2025-01-01T00:00:00.000Z", "rts", 1, 2)] as never);
      const out = await getRecentlyChangedCells("daily_online_stock", [5]);
      expect(out[5]).toEqual(["rts"]);
      expect(vi.mocked(changeLogRepository.findRecentUserEdits).mock.calls[0][2]).toBeUndefined();
    });

    it("stops glowing what was typed before the page was finished", async () => {
      vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([record(5)] as never);
      vi.mocked(changeLogRepository.findDayClosures).mockResolvedValue([closure({ onlineLocked: true })] as never);
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([edit("2026-10-21T01:00:00.000Z", "rts", 1, 2)] as never);
      expect(await getRecentlyChangedCells("daily_online_stock", [5])).toEqual({});
      // ...and only reads the log from the finish onwards.
      expect(vi.mocked(changeLogRepository.findRecentUserEdits).mock.calls[0][2]).toEqual(new Date("2026-10-21T02:00:00.000Z"));
    });

    it("glows an edit that came in after the finish (an approved correction)", async () => {
      vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([record(5)] as never);
      vi.mocked(changeLogRepository.findDayClosures).mockResolvedValue([closure({ onlineLocked: true })] as never);
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
        edit("2026-10-22T09:00:00.000Z", "productionIn", 3, 4),
        edit("2026-10-21T01:00:00.000Z", "rts", 1, 2),
      ] as never);
      const out = await getRecentlyChangedCells("daily_online_stock", [5]);
      expect(out[5]).toEqual(["productionIn"]);
    });

    it("starts again at the unlock when a finished page was reopened", async () => {
      vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([record(5)] as never);
      vi.mocked(changeLogRepository.findDayClosures).mockResolvedValue([
        closure({ onlineLocked: false, unlockedAt: new Date("2026-10-22T08:00:00.000Z") }),
      ] as never);
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
        edit("2026-10-22T09:00:00.000Z", "fulfillmentOut", 5, 6),
        edit("2026-10-21T01:00:00.000Z", "rts", 1, 2),
      ] as never);
      const out = await getRecentlyChangedCells("daily_online_stock", [5]);
      expect(out[5]).toEqual(["fulfillmentOut"]);
    });

    it("keeps this page glowing while only the OTHER page has been finished", async () => {
      vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([record(5)] as never);
      // Offline finished, Online (the page asked about) still open and never finished.
      vi.mocked(changeLogRepository.findDayClosures).mockResolvedValue([closure({ offlineLocked: true })] as never);
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([edit("2026-10-20T10:00:00.000Z", "rts", 1, 2)] as never);
      const out = await getRecentlyChangedCells("daily_online_stock", [5]);
      expect(out[5]).toEqual(["rts"]);
    });

    it("finishing one sheet does not touch another date or shift", async () => {
      vi.mocked(changeLogRepository.findStockRecordsByIds).mockResolvedValue([record(5, "MORNING")] as never);
      // The closure is for the NIGHT sheet; this record is on the MORNING sheet.
      vi.mocked(changeLogRepository.findDayClosures).mockResolvedValue([closure({ onlineLocked: true })] as never);
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([edit("2026-10-20T10:00:00.000Z", "rts", 1, 2)] as never);
      const out = await getRecentlyChangedCells("daily_online_stock", [5]);
      expect(out[5]).toEqual(["rts"]);
    });
  });

  describe("manual counts glow until published", () => {
    const save = (changedAt: string, count: number, publishedAt: string | null = null) => ({
      recordId: 3,
      action: "UPDATE",
      changedAt: new Date(changedAt),
      oldValue: { manualCount: count - 1, publishedAt: null },
      newValue: { manualCount: count, publishedAt },
    });
    const publish = (changedAt: string) => ({
      recordId: 3,
      action: "UPDATE",
      changedAt: new Date(changedAt),
      oldValue: { manualCount: 9, publishedAt: null },
      newValue: { manualCount: 9, publishedAt: "2026-10-21T03:00:00.000Z" },
    });

    it("glows a saved, unpublished count however long ago it was saved", async () => {
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([save("2025-03-01T00:00:00.000Z", 9)] as never);
      const out = await getRecentlyChangedCells("manual_counts", [3]);
      expect(out[3]).toEqual(["manualCount"]);
      expect(vi.mocked(changeLogRepository.findRecentUserEdits).mock.calls[0][2]).toBeUndefined();
    });

    it("stops once the count is published", async () => {
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
        publish("2026-10-21T03:00:00.000Z"),
        save("2026-10-21T01:00:00.000Z", 9),
      ] as never);
      expect(await getRecentlyChangedCells("manual_counts", [3])).toEqual({});
    });

    it("glows again when a published count is saved anew, and not for what came before the publish", async () => {
      vi.mocked(changeLogRepository.findRecentUserEdits).mockResolvedValue([
        save("2026-10-22T09:00:00.000Z", 12), // saved again: un-published
        publish("2026-10-21T03:00:00.000Z"),
        save("2026-10-21T01:00:00.000Z", 9),
      ] as never);
      const out = await getRecentlyChangedCells("manual_counts", [3]);
      expect(out[3]).toEqual(["manualCount"]);
    });
  });
});
