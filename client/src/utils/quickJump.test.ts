import { describe, expect, it } from "vitest";
import { rankQuickJump, QUICK_JUMP_LIMIT } from "./quickJump";
import { pagesForRole, navGroups } from "../config/navigation";
import type { Product } from "../types";

function product(id: number, name: string, sku: string | null, category = "Class A (Liter)"): Product {
  return { id, sku, name, category, unit: "Liter", isActive: true, sortOrder: 0, lowStockThreshold: null };
}

const PRODUCTS = [
  product(1, "Sweet A", "AFP001"),
  product(2, "Green Mango", "AFP002"),
  product(3, "Mango Supreme", "AFP003"),
  product(4, "Spiced Vinegar", "AFP004", "Class B (Gallon)"),
];

const PAGES = pagesForRole("SUPERVISOR_ADMIN");

describe("rankQuickJump - ranking", () => {
  it("lists pages only (in ribbon order) for an empty query", () => {
    const results = rankQuickJump("", PAGES, PRODUCTS);
    expect(results.every((r) => r.kind === "page")).toBe(true);
    expect(results.map((r) => r.label)).toEqual(PAGES.map((p) => p.label));
  });

  it("ranks a prefix match above a mid-word match", () => {
    const results = rankQuickJump("mango", PAGES, PRODUCTS);
    const labels = results.map((r) => r.label);
    // "Mango Supreme" starts with the query; "Green Mango" only contains it
    // at a word boundary.
    expect(labels.indexOf("Mango Supreme")).toBeLessThan(labels.indexOf("Green Mango"));
  });

  it("ranks an exact match first", () => {
    const results = rankQuickJump("sweet a", PAGES, PRODUCTS);
    expect(results[0].label).toBe("Sweet A");
  });

  it("matches anywhere in the name, not just the start", () => {
    const labels = rankQuickJump("preme", PAGES, PRODUCTS).map((r) => r.label);
    expect(labels).toContain("Mango Supreme");
  });

  it("matches on SKU as well as name", () => {
    const results = rankQuickJump("afp004", PAGES, PRODUCTS);
    expect(results[0]).toMatchObject({ kind: "product", productId: 4 });
  });

  it("is case-insensitive on both sides", () => {
    expect(rankQuickJump("SWEET", PAGES, PRODUCTS)[0].label).toBe("Sweet A");
    expect(rankQuickJump("aFp002", PAGES, PRODUCTS)[0].label).toBe("Green Mango");
  });

  it("puts a page ahead of a product matching at the same tier", () => {
    // Both "Daily Report" (page) and a product named "Dairy" would be
    // prefix hits on "da" - the page wins.
    const withDairy = [...PRODUCTS, product(5, "Dairy Blend", "AFP005")];
    const results = rankQuickJump("da", PAGES, withDairy);
    expect(results[0].kind).toBe("page");
  });

  it("returns nothing when nothing matches", () => {
    expect(rankQuickJump("zzzzz", PAGES, PRODUCTS)).toEqual([]);
  });

  it("treats a bracketed category word as a word-boundary match", () => {
    // Regex-special characters in the query must not blow up the scan.
    expect(() => rankQuickJump("(gallon)", PAGES, PRODUCTS)).not.toThrow();
  });

  it(`caps results at ${QUICK_JUMP_LIMIT}`, () => {
    const many = Array.from({ length: 200 }, (_, i) => product(i + 1, `Mango ${i}`, `SKU${i}`));
    expect(rankQuickJump("mango", PAGES, many)).toHaveLength(QUICK_JUMP_LIMIT);
  });

  it("carries the SKU and category as the row hint", () => {
    const hit = rankQuickJump("afp004", PAGES, PRODUCTS)[0];
    expect(hit.hint).toBe("AFP004 · Class B (Gallon)");
  });
});

describe("rankQuickJump - role filtering", () => {
  const groupOf = (p: { to: string }) =>
    navGroups.find((g) => g.links.some((l) => l.to === p.to))?.heading ?? "Page";

  it("offers an online encoder only the pages their role can open", () => {
    const labels = rankQuickJump("", pagesForRole("ONLINE_ENCODER"), [], groupOf).map((r) => r.label);
    expect(labels).toEqual(["Audit", "Online Entry", "Offline Entry", "Total Stocks"]);
    expect(labels).not.toContain("Dashboard");
    expect(labels).not.toContain("Change Log");
  });

  it("never surfaces an admin-only page to an encoder, even on a direct match", () => {
    for (const role of ["ONLINE_ENCODER", "OFFLINE_ENCODER"] as const) {
      const pages = pagesForRole(role);
      expect(rankQuickJump("dashboard", pages, [])).toEqual([]);
      expect(rankQuickJump("change log", pages, [])).toEqual([]);
      expect(rankQuickJump("variance", pages, [])).toEqual([]);
    }
  });

  it("gives a supervisor/admin every page", () => {
    const labels = rankQuickJump("", pagesForRole("SUPERVISOR_ADMIN"), []).map((r) => r.label);
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Change Log");
    expect(labels).toContain("Settings");
  });

  it("tags each page with its ribbon group", () => {
    const results = rankQuickJump("variance report", PAGES, [], groupOf);
    expect(results[0]).toMatchObject({ label: "Variance Report", hint: "Reports" });
  });
});
