import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/changeLog", () => ({ getRecentCells: vi.fn() }));

import { getRecentCells } from "../api/changeLog";
import { useRecentCells, type RecentCellRecord } from "./useRecentCells";

const lookup = vi.mocked(getRecentCells);

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  lookup.mockReset();
  lookup.mockResolvedValue({ 7: ["fulfillmentOut", "rts"], 8: ["productionIn"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const records = (version = "v1"): RecentCellRecord[] => [
  { recordId: 7, cell: "101", version },
  { recordId: 8, cell: "102", version },
  { recordId: undefined, cell: "103" },
];

describe("useRecentCells", () => {
  it("maps each record's changed fields onto its cell, and skips rows that were never saved", async () => {
    const { result } = renderHook(() => useRecentCells("daily_online_stock", records()));
    await settle();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith("daily_online_stock", [7, 8]);
    expect([...result.current].sort()).toEqual(["101:fulfillmentOut", "101:rts", "102:productionIn"]);
  });

  it("does nothing without a table or without saved rows", async () => {
    renderHook(() => useRecentCells(undefined, records()));
    renderHook(() => useRecentCells("daily_online_stock", [{ recordId: undefined, cell: "1" }]));
    await settle();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("keeps the lookup when the parent re-renders with an equal array (a new one every render)", async () => {
    const { result, rerender } = renderHook(() => useRecentCells("daily_online_stock", records()));
    // Re-render faster than the debounce, several times: the request must not be cancelled or repeated.
    for (let i = 0; i < 5; i++) {
      rerender();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await settle();
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(result.current.has("101:fulfillmentOut")).toBe(true);
  });

  it("looks again when a row is saved (its version moves)", async () => {
    let version = "v1";
    const { rerender } = renderHook(() => useRecentCells("daily_online_stock", records(version)));
    await settle();
    version = "v2";
    rerender();
    await settle();
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("looks again when the refresh key moves, e.g. a day was finished and no row changed", async () => {
    let realtime = 1;
    const { result, rerender } = renderHook(() => useRecentCells("daily_online_stock", records(), realtime));
    await settle();
    expect(result.current.size).toBe(3);
    // The day is finished: the server now has nothing to glow, though every row is unchanged.
    lookup.mockResolvedValue({});
    realtime = 2;
    rerender();
    await settle();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(result.current.size).toBe(0);
  });

  it("shows no glow from another sheet while the new one is loading", async () => {
    let rows = records();
    const { result, rerender } = renderHook(() => useRecentCells("daily_online_stock", rows));
    await settle();
    expect(result.current.size).toBe(3);
    rows = [{ recordId: 99, cell: "101", version: "v1" }];
    lookup.mockResolvedValue({});
    rerender();
    expect(result.current.size).toBe(0);
  });

  it("treats a failed lookup as no glow", async () => {
    lookup.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useRecentCells("daily_online_stock", records()));
    await settle();
    expect(result.current.size).toBe(0);
  });
});
