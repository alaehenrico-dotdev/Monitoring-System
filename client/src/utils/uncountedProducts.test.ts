import { describe, expect, it } from "vitest";
import { uncountedProducts } from "./uncountedProducts";
import type { ManualCountGridRow } from "../types";

const row = (id: number, name: string, system: number, over: Partial<ManualCountGridRow> & { publishedAt?: string | null } = {}): ManualCountGridRow =>
  ({
    product: { id, name, category: "Premium (Liter)" },
    entry: { productId: id, systemRemainingStock: system, manualCount: null, variance: null, publishedAt: over.publishedAt ?? null },
    isSaved: over.isSaved ?? false,
    isFlagged: false,
  }) as unknown as ManualCountGridRow;

describe("uncountedProducts", () => {
  it("lists active products with no count, negatives first", () => {
    const out = uncountedProducts({
      ONLINE: [row(1, "A", 5), row(23, "SPECIAL", -96), row(3, "C", 0, { isSaved: true })],
      OFFLINE: [row(23, "SPECIAL", 96)],
    });
    expect(out.map((u) => `${u.name}:${u.location}:${u.system}`)).toEqual(["SPECIAL:ONLINE:-96", "A:ONLINE:5", "SPECIAL:OFFLINE:96"]);
  });

  it("does not list a count that was already published (it shows blank but carries publishedAt)", () => {
    const out = uncountedProducts({ ONLINE: [row(1, "A", 5, { publishedAt: "2026-10-30T20:00:00Z" })], OFFLINE: [] });
    expect(out).toEqual([]);
  });
});
