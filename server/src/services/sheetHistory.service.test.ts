import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ findForSheet: vi.fn(), findProductsByIds: vi.fn() }));
vi.mock("../repositories/changeLogRepository", () => ({ changeLogRepository: repo }));

import { getSheetVersion, listPublishHistory, listSheetVersions } from "./sheetHistory.service";

const MIN = 60_000;
const T0 = new Date("2026-10-19T01:00:00.000Z").getTime();
const ana = { id: 1, name: "Ana" };
const ben = { id: 2, name: "Ben" };

function row(id: number, minutes: number, user: typeof ana | null, recordId: number, newValue: unknown, oldValue: unknown = null, action = "UPDATE") {
  return { id, tableName: "daily_online_stock", recordId, action, changedAt: new Date(T0 + minutes * MIN), changedBy: user, newValue, oldValue };
}

beforeEach(() => {
  repo.findForSheet.mockReset();
  repo.findProductsByIds.mockReset();
  repo.findProductsByIds.mockResolvedValue([{ id: 7, sku: "A1", name: "APPLE" }]);
});

describe("listSheetVersions", () => {
  it("folds close edits by one person into one version, newest first", async () => {
    repo.findForSheet.mockResolvedValue([
      row(1, 0, ana, 10, {}),
      row(2, 5, ana, 11, {}),
      row(3, 30, ana, 10, {}), // gap over 10 minutes: new version
      row(4, 32, ben, 10, {}), // different person: new version
    ]);
    const v = await listSheetVersions("online", "2026-10-19", "NIGHT");
    expect(v.map((x) => [x.user?.name, x.changes, x.products, x.after, x.upTo])).toEqual([
      ["Ben", 1, 1, 3, 4],
      ["Ana", 1, 1, 2, 3],
      ["Ana", 2, 2, 0, 2],
    ]);
  });

  it("returns nothing for a sheet with no edits", async () => {
    repo.findForSheet.mockResolvedValue([]);
    expect(await listSheetVersions("online", "2026-10-19", "NIGHT")).toEqual([]);
  });
});

describe("getSheetVersion", () => {
  const rows = [
    row(1, 0, ana, 10, { productId: 7, entryDate: "2026-10-19", shift: "NIGHT", stocksIn: "5.00", remainingStock: "5.00" }, null, "CREATE"),
    row(2, 40, ben, 10, { productId: 7, entryDate: "2026-10-19", shift: "NIGHT", stocksIn: "8.00", remainingStock: "8.00" }),
  ];

  it("replays to the chosen change and flags fields changed since `after`", async () => {
    repo.findForSheet.mockResolvedValue(rows);
    const at2 = await getSheetVersion("online", "2026-10-19", "NIGHT", 2, 1);
    expect(at2.rows).toHaveLength(1);
    expect(at2.rows[0]).toMatchObject({ name: "APPLE", sku: "A1", values: { stocksIn: "8.00", remainingStock: "8.00" }, changed: ["stocksIn", "remainingStock"] });
    expect(at2.rows[0].values).not.toHaveProperty("productId");

    const at1 = await getSheetVersion("online", "2026-10-19", "NIGHT", 1, 0);
    expect(at1.rows[0].values.stocksIn).toBe("5.00");
  });

  it("hides the delivery1..5 storage columns but keeps the added columns", async () => {
    repo.findForSheet.mockResolvedValue([
      row(1, 0, ana, 10, { productId: 7, entryDate: "2026-10-19", shift: "NIGHT", deliveryOut: "9.00", delivery1: "4.00", delivery2: "5.00", deliveryOut__x1: 4, deliveryOut__x2: 5 }, null, "CREATE"),
    ]);
    const { rows: out } = await getSheetVersion("offline", "2026-10-19", "NIGHT", 1);
    expect(Object.keys(out[0].values)).toEqual(["deliveryOut", "deliveryOut__x1", "deliveryOut__x2"]);
  });

  it("drops a record whose last change before the cutoff was a DELETE", async () => {
    repo.findForSheet.mockResolvedValue([...rows, row(3, 50, ben, 10, null, rows[1].newValue, "DELETE")]);
    expect((await getSheetVersion("online", "2026-10-19", "NIGHT", 3)).rows).toEqual([]);
    expect((await getSheetVersion("online", "2026-10-19", "NIGHT", 2)).rows).toHaveLength(1);
  });
});

describe("listPublishHistory", () => {
  const pub = "2026-10-19T05:00:00.000Z";
  it("groups counts sharing one publishedAt into a single publish", async () => {
    repo.findForSheet.mockResolvedValue([
      row(1, 0, ana, 1, { publishedAt: null }),
      row(2, 60, ben, 1, { publishedAt: pub, appliedToOpening: true }, { publishedAt: null }),
      row(3, 60, ben, 2, { publishedAt: pub, appliedToOpening: false }, { publishedAt: null }),
      row(4, 70, ana, 2, { publishedAt: null }, { publishedAt: pub }), // saved again: not a publish
    ]);
    const p = await listPublishHistory("2026-10-19", "NIGHT");
    expect(p).toEqual([{ publishedAt: pub, upTo: 3, user: ben, counts: 2, appliedToOpening: true }]);
  });

  it("ignores rows that were already published with the same stamp", async () => {
    repo.findForSheet.mockResolvedValue([row(1, 0, ana, 1, { publishedAt: pub }, { publishedAt: pub })]);
    expect(await listPublishHistory("2026-10-19", "NIGHT")).toEqual([]);
  });
});
