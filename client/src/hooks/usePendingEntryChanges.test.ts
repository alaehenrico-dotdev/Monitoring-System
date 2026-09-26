import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { GridRow } from "../components/StockGrid";
import { usePendingEntryChanges } from "./usePendingEntryChanges";

const product = { id: 1, sku: "AFP001", name: "Sweet A", category: "Class A (Liter)", unit: "Liter", isActive: true, sortOrder: 0 };

const rows: GridRow[] = [
  { product, entry: { openingStock: 100, stockInOlToOff: 0, stockOutOffToOl: 0, offlineStock: 100, productionIn: 0, deliveryOut: 0, remainingStock: 100 }, isSaved: true },
];

beforeEach(() => {
  sessionStorage.clear();
});

describe("usePendingEntryChanges - displayRows without a recompute callback", () => {
  it("overlays only the staged field itself, leaving every other column at its last-saved value", () => {
    const { result } = renderHook(() => usePendingEntryChanges(rows));

    act(() => result.current.stage(1, "openingStock", 50, 100));

    const row = result.current.displayRows?.[0];
    expect(row?.entry.openingStock).toBe(50);
    // Nothing recomputes offlineStock/remainingStock without a recompute
    // callback - a caller that omits it (e.g. a read-only table) still gets
    // the old, simple overlay-only behavior.
    expect(row?.entry.offlineStock).toBe(100);
    expect(row?.entry.remainingStock).toBe(100);
    expect(row?.isSaved).toBe(false);
  });
});

describe("usePendingEntryChanges - displayRows WITH a recompute callback (Section 4.3 live preview)", () => {
  // A minimal stand-in for OfflineEntryPage's real computeOfflineFigures -
  // just enough to prove the wiring (recompute is called with the
  // last-saved entry + this product's own diff, and its result is merged
  // over the staged overlay) without duplicating the real stock-math tests.
  function recompute(entry: Record<string, unknown>, changes: Record<string, number>) {
    const openingStock = changes.openingStock ?? Number(entry.openingStock ?? 0);
    return { offlineStock: openingStock, remainingStock: openingStock };
  }

  it("reflects a staged Opening Stock change into Offline/Remaining Stock immediately, before Save", () => {
    const { result } = renderHook(() => usePendingEntryChanges(rows, undefined, recompute));

    act(() => result.current.stage(1, "openingStock", 50, 100));

    const row = result.current.displayRows?.[0];
    expect(row?.entry.openingStock).toBe(50);
    expect(row?.entry.offlineStock).toBe(50);
    expect(row?.entry.remainingStock).toBe(50);
  });

  it("un-stages back to the recomputed last-saved figures once the edit is reverted to its saved value", () => {
    const { result } = renderHook(() => usePendingEntryChanges(rows, undefined, recompute));

    act(() => result.current.stage(1, "openingStock", 50, 100));
    act(() => result.current.stage(1, "openingStock", 100, 100)); // back to the saved value - stage() drops it from pending

    // No pending changes left for this product - displayRows falls back to
    // the plain last-saved rows untouched, not a stale recomputed value.
    expect(result.current.pendingCount).toBe(0);
    expect(result.current.displayRows).toBe(rows);
  });
});
