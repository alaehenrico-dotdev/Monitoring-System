import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/changeLog", () => ({ getCellHistory: vi.fn() }));

import { getCellHistory } from "../api/changeLog";
import {
  describeWhen,
  fetchCellHistory,
  invalidateRecordHistory,
  lastChange,
  type CellChange,
} from "./cellHistory";

const AT = "2026-10-09T08:00:00.000Z";
const change = (newValue: number): CellChange => ({
  changedAt: AT,
  who: "Ana",
  oldValue: 0,
  newValue,
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidateRecordHistory();
});

describe("fetchCellHistory", () => {
  it("asks the per-cell endpoint for exactly this table, record and field", async () => {
    vi.mocked(getCellHistory).mockResolvedValue([change(9)]);

    await fetchCellHistory("daily_online_stock", 100, "stockIn");

    expect(getCellHistory).toHaveBeenCalledWith({
      tableName: "daily_online_stock",
      recordId: 100,
      field: "stockIn",
      limit: 10,
    });
  });

  it("serves a repeat lookup from cache instead of refetching", async () => {
    vi.mocked(getCellHistory).mockResolvedValue([change(9)]);

    await fetchCellHistory("daily_online_stock", 100, "stockIn");
    await fetchCellHistory("daily_online_stock", 100, "stockIn");

    expect(getCellHistory).toHaveBeenCalledTimes(1);
  });

  it("caches per field, so a different column is its own lookup", async () => {
    vi.mocked(getCellHistory).mockResolvedValue([change(9)]);

    await fetchCellHistory("daily_online_stock", 100, "stockIn");
    await fetchCellHistory("daily_online_stock", 100, "productionIn");

    expect(getCellHistory).toHaveBeenCalledTimes(2);
  });

  it("returns an empty history rather than throwing when the request fails", async () => {
    vi.mocked(getCellHistory).mockRejectedValue(new Error("403"));

    await expect(fetchCellHistory("daily_online_stock", 100, "stockIn")).resolves.toEqual([]);
  });

  it("does not cache a failure permanently - the next lookup retries", async () => {
    vi.mocked(getCellHistory).mockRejectedValueOnce(new Error("offline"));
    await fetchCellHistory("daily_online_stock", 100, "stockIn");

    vi.mocked(getCellHistory).mockResolvedValue([change(9)]);
    await expect(fetchCellHistory("daily_online_stock", 100, "stockIn")).resolves.toEqual([change(9)]);
    expect(getCellHistory).toHaveBeenCalledTimes(2);
  });
});

describe("invalidateRecordHistory", () => {
  it("clears everything when called with no arguments", async () => {
    vi.mocked(getCellHistory).mockResolvedValue([change(9)]);
    await fetchCellHistory("daily_online_stock", 100, "stockIn");

    invalidateRecordHistory();
    await fetchCellHistory("daily_online_stock", 100, "stockIn");

    expect(getCellHistory).toHaveBeenCalledTimes(2);
  });

  it("clears every field of one record, and leaves other records alone", async () => {
    vi.mocked(getCellHistory).mockResolvedValue([change(9)]);
    await fetchCellHistory("daily_online_stock", 100, "stockIn");
    await fetchCellHistory("daily_online_stock", 100, "productionIn");
    await fetchCellHistory("daily_online_stock", 200, "stockIn");
    expect(getCellHistory).toHaveBeenCalledTimes(3);

    invalidateRecordHistory("daily_online_stock", 100);

    await fetchCellHistory("daily_online_stock", 200, "stockIn"); // still cached
    expect(getCellHistory).toHaveBeenCalledTimes(3);
    await fetchCellHistory("daily_online_stock", 100, "stockIn"); // refetched
    await fetchCellHistory("daily_online_stock", 100, "productionIn"); // refetched
    expect(getCellHistory).toHaveBeenCalledTimes(5);
  });
});

describe("lastChange", () => {
  it("is the newest entry, since the endpoint returns newest first", () => {
    expect(lastChange([change(9), change(5)])).toEqual(change(9));
  });

  it("is undefined for a cell with no history", () => {
    expect(lastChange([])).toBeUndefined();
  });
});

describe("describeWhen", () => {
  it("describes recent times relatively", () => {
    const now = Date.now();
    expect(describeWhen(new Date(now - 10_000).toISOString())).toBe("just now");
    expect(describeWhen(new Date(now - 5 * 60_000).toISOString())).toBe("5m ago");
    expect(describeWhen(new Date(now - 3 * 3_600_000).toISOString())).toBe("3h ago");
  });

  it("falls back to a date once it is over a day old", () => {
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect(describeWhen(old)).toBe(new Date(old).toLocaleDateString());
  });

  it("returns nothing for an unparseable timestamp", () => {
    expect(describeWhen("not a date")).toBe("");
  });
});
