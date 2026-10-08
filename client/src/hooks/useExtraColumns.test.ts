import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Product } from "../types";
import type { GridRow } from "../components/StockGrid";
import type { PendingByProduct } from "./usePendingEntryChanges";
import {
  extraColumnKey,
  extraColumnList,
  isExtraColumnKey,
  MAX_EXTRAS_PER_COLUMN,
  parseExtraColumnKey,
  sumExtraColumns,
  useGridExtraColumns,
  withoutExtraColumns,
} from "./useExtraColumns";

const columns = [
  { key: "stockIn", label: "Stocks In" },
  { key: "openingStock", label: "Opening" },
];

function rows(): GridRow[] {
  return [
    {
      product: { id: 1, sku: "A", name: "A", category: "Sauces" } as Product,
      entry: { stockIn: 6, openingStock: 10 },
    },
    {
      product: { id: 2, sku: "B", name: "B", category: "Sauces" } as Product,
      entry: { stockIn: 0, openingStock: 10 },
    },
  ];
}

/// A stand-in for usePendingEntryChanges: records what was staged and folds it
/// into a pending map, so the hook's next call sees its own earlier edits.
function harness(initialPending: PendingByProduct = {}) {
  const pending: PendingByProduct = structuredClone(initialPending);
  const stageMany = vi.fn(
    (edits: { productId: number; key: string; value: number; savedValue: number }[]) => {
      for (const e of edits) {
        const forProduct = (pending[e.productId] ??= {});
        if (e.value === e.savedValue) delete forProduct[e.key];
        else forProduct[e.key] = e.value;
      }
    },
  );
  const data = rows();
  const getSavedValue = (productId: number, key: string) => {
    const raw = data.find((r) => r.product.id === productId)?.entry[key];
    return raw === undefined ? undefined : Number(raw);
  };
  const render = () =>
    renderHook(() =>
      useGridExtraColumns({
        storageKey: undefined,
        rows: data,
        pending,
        stageMany,
        getSavedValue,
        columns,
      }),
    );
  return { pending, stageMany, render };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("extra column keys", () => {
  it("round-trips a main key and slot, and ignores ordinary column keys", () => {
    const key = extraColumnKey("stockIn", 3);
    expect(parseExtraColumnKey(key)).toEqual({ mainKey: "stockIn", slot: 3 });
    expect(isExtraColumnKey(key)).toBe(true);
    for (const plain of ["stockIn", "delivery1", "openingStock", ""]) {
      expect(isExtraColumnKey(plain)).toBe(false);
    }
  });

  it("labels each added column under its main column", () => {
    expect(extraColumnList(columns, { stockIn: [1, 4] })).toEqual([
      { key: extraColumnKey("stockIn", 1), label: "Stocks In +1" },
      { key: extraColumnKey("stockIn", 4), label: "Stocks In +4" },
    ]);
  });

  it("sums the added columns, honouring a value being committed right now", () => {
    const values: Record<string, number> = {
      [extraColumnKey("stockIn", 1)]: 2,
      [extraColumnKey("stockIn", 2)]: 3,
    };
    const read = (k: string) => values[k] ?? 0;
    expect(sumExtraColumns("stockIn", [1, 2], read)).toBe(5);
    expect(
      sumExtraColumns("stockIn", [1, 2], read, {
        key: extraColumnKey("stockIn", 2),
        value: 10,
      }),
    ).toBe(12);
  });
});

describe("saving with \"Save total only\"", () => {
  it("submits the main column's sum and no added-column amounts", () => {
    const { pending, render } = harness();
    const { result, rerender } = render();
    act(() => {
      result.current.addColumns("stockIn", 2);
    });
    rerender();
    act(() => {
      result.current.commitExtraCell(1, extraColumnKey("stockIn", 2), 4);
    });
    rerender();

    // 6 moved into +1 when the columns appeared, plus the 4 just typed.
    expect(withoutExtraColumns(pending[1])).toEqual({ stockIn: 10 });
  });

  it("clears the affected columns once the save succeeds", () => {
    const { render } = harness();
    const { result, rerender } = render();
    act(() => {
      result.current.addColumns("stockIn", 2);
    });
    rerender();
    expect(result.current.saveColumns.map((c) => c.mainKey)).toEqual(["stockIn"]);

    act(() => {
      result.current.clearColumns(result.current.saveColumns.map((c) => c.mainKey));
    });
    rerender();
    expect(result.current.extras).toEqual({});
    expect(result.current.extraColumnDefs).toEqual([]);
  });
});

describe("useGridExtraColumns", () => {
  it("adds +1 / +2 / +5 columns and caps at ten per column", () => {
    const { render } = harness();
    const { result, rerender } = render();

    for (const n of [1, 2, 5]) {
      act(() => {
        expect(result.current.addColumns("stockIn", n)).toBe(n);
      });
      rerender();
    }
    expect(result.current.extras.stockIn).toHaveLength(8);

    // Only the two remaining slots are added, then nothing at all.
    act(() => {
      expect(result.current.addColumns("stockIn", 5)).toBe(2);
    });
    rerender();
    expect(result.current.extras.stockIn).toHaveLength(MAX_EXTRAS_PER_COLUMN);
    act(() => {
      expect(result.current.addColumns("stockIn", 1)).toBe(0);
    });
  });

  it("moves the main column's value into the first added column, so nothing is lost", () => {
    const { pending, render } = harness();
    const { result } = render();
    act(() => {
      result.current.addColumns("stockIn", 2);
    });
    // Product 1 had 6 in Stocks In; product 2 had nothing to move.
    expect(pending[1]?.[extraColumnKey("stockIn", 1)]).toBe(6);
    expect(pending[2]?.[extraColumnKey("stockIn", 1)]).toBeUndefined();
  });

  it("keeps the main column equal to the sum of its added columns", () => {
    const { pending, render } = harness();
    const { result, rerender } = render();
    act(() => {
      result.current.addColumns("stockIn", 2);
    });
    rerender();

    act(() => {
      expect(
        result.current.commitExtraCell(1, extraColumnKey("stockIn", 2), 4),
      ).toBe(true);
    });
    // 6 already in column +1, plus the 4 just typed into +2.
    expect(pending[1][extraColumnKey("stockIn", 2)]).toBe(4);
    expect(pending[1].stockIn).toBe(10);
  });

  it("takes a deleted column's amount back out of the main column", () => {
    const { pending, render } = harness();
    const { result, rerender } = render();
    act(() => {
      result.current.addColumns("stockIn", 2);
    });
    rerender();
    act(() => {
      result.current.commitExtraCell(1, extraColumnKey("stockIn", 2), 4);
    });
    rerender();
    expect(pending[1].stockIn).toBe(10);

    act(() => {
      result.current.removeColumns("stockIn", [2]);
    });
    rerender();
    expect(result.current.extras.stockIn).toEqual([1]);
    // The deleted column's staged amount is gone, and the main column is back
    // to the sum of what is left (6) - which is also what it had saved, so it
    // correctly drops out of the pending set rather than lingering as a no-op.
    expect(pending[1][extraColumnKey("stockIn", 2)]).toBeUndefined();
    expect(pending[1].stockIn).toBeUndefined();

    // Deleting a column whose amount is NOT already the saved figure does
    // leave the main column staged, at the new, lower sum.
    act(() => {
      result.current.commitExtraCell(1, extraColumnKey("stockIn", 1), 9);
    });
    rerender();
    expect(pending[1].stockIn).toBe(9);
    act(() => {
      result.current.removeColumns("stockIn", [1]);
    });
    rerender();
    expect(result.current.extras.stockIn).toBeUndefined();
    expect(pending[1].stockIn).toBe(0);
  });

  it("re-totals the main column for a batch that zeroes its added columns", () => {
    const { pending, render } = harness();
    const { result, rerender } = render();
    act(() => {
      result.current.addColumns("stockIn", 2);
    });
    rerender();
    act(() => {
      result.current.commitExtraCell(1, extraColumnKey("stockIn", 2), 4);
    });
    rerender();
    expect(pending[1].stockIn).toBe(10);

    // What Quick Fill's "Zero all" hands over: the added columns only.
    const zeroed = [1, 2].map((slot) => ({
      productId: 1,
      key: extraColumnKey("stockIn", slot),
      value: 0,
      savedValue: 0,
    }));
    const batch = result.current.withExtraTotals(zeroed);
    expect(batch).toHaveLength(3);
    expect(batch[2]).toEqual({
      productId: 1,
      key: "stockIn",
      value: 0,
      savedValue: 6,
    });
  });

  it("leaves a batch that touches no added column exactly as it was", () => {
    const { render } = harness();
    const { result } = render();
    const edits = [
      { productId: 1, key: "stockIn", value: 3, savedValue: 6 },
    ];
    expect(result.current.withExtraTotals(edits)).toBe(edits);
  });

  it("leaves non-extra keys to the page's own commit path", () => {
    const { render } = harness();
    const { result } = render();
    expect(result.current.commitExtraCell(1, "stockIn", 9)).toBe(false);
    // ...and an extra key whose column no longer exists, too.
    expect(
      result.current.commitExtraCell(1, extraColumnKey("stockIn", 1), 9),
    ).toBe(false);
  });

  it("lists only the columns that actually hold a staged amount", () => {
    const { render } = harness();
    const { result, rerender } = render();
    act(() => {
      result.current.addColumns("openingStock", 1);
    });
    rerender();
    // Opening Stock was 10 on both rows, so adding a column moved 10+10 in.
    expect(result.current.saveColumns).toEqual([
      { mainKey: "openingStock", label: "Opening", count: 1, total: 20 },
    ]);

    act(() => {
      result.current.clearColumns(["openingStock"]);
    });
    rerender();
    expect(result.current.saveColumns).toEqual([]);
    expect(result.current.extras.openingStock).toBeUndefined();
  });

  it("persists which columns exist under the sheet's own storage key", () => {
    const data = rows();
    const args = {
      storageKey: "ala-eh-extracols:online:2026-10-08:MORNING",
      rows: data,
      pending: {} as PendingByProduct,
      stageMany: vi.fn(),
      getSavedValue: () => undefined,
      columns,
    };
    const first = renderHook(() => useGridExtraColumns(args));
    act(() => {
      first.result.current.addColumns("stockIn", 2);
    });
    first.unmount();

    const second = renderHook(() => useGridExtraColumns(args));
    expect(second.result.current.extras.stockIn).toEqual([1, 2]);
  });
});
