import { describe, expect, it } from "vitest";
import { normalizeSearch, parseSearchDate, rankPhoneSearch, type PhoneSearchSources } from "./phoneSearch";
import type { NavLinkDef } from "../config/navigation";
import { settingsTabsFor } from "../config/settingsTabs";
import type { Product, TotalStockRow } from "../types";

const TODAY = "2026-11-11";

const product = (id: number, sku: string | null, name: string, category: string) => ({ id, sku, name, category }) as Product;

const PRODUCTS = [
  product(1, "AFP001", "SWEET A", "Class A (Gallon)"),
  product(2, "AFP002", "MORE SWEET A", "Class A (Gallon)"),
  product(3, "AFP043", "LIQUID SEASONING", "Condiments"),
  product(4, "AFP057", "JAMPONG HOT CHILI SAUCE", "Condiments"),
  product(5, "AFP061", "CANE VINEGAR WHITE A", "Class A (Gallon)"),
  product(6, null, "NSC TOYOMANSI", "Condiments"),
];

const page = (to: string, label: string): NavLinkDef => ({ to, label, roles: ["SUPERVISOR_ADMIN"] });
const ADMIN_PAGES = [
  page("/dashboard", "Dashboard"),
  page("/total-stocks", "Consolidated"),
  page("/daily-out", "Daily Out"),
  page("/daily-report", "Daily Report"),
  page("/change-log", "Change Log"),
  page("/settings", "Settings"),
];

const stocks = new Map<number, TotalStockRow>(
  PRODUCTS.map((p, i) => [p.id, { product: p, onlineRemainingStock: 100 + i, offlineRemainingStock: 1000, totalRemainingStock: 1100 + i, totalManualCount: null, totalVariance: null }]),
);

const sources = (over: Partial<PhoneSearchSources> = {}): PhoneSearchSources => ({
  pages: ADMIN_PAGES,
  groupOf: () => "Page",
  settings: settingsTabsFor(true),
  products: PRODUCTS,
  stocks,
  today: TODAY,
  theme: "dark",
  ...over,
});

const search = (q: string, over?: Partial<PhoneSearchSources>) => rankPhoneSearch(q, sources(over));
const labels = (q: string, group: string, over?: Partial<PhoneSearchSources>) => search(q, over).filter((r) => r.group === group).map((r) => r.label);

describe("normalizeSearch", () => {
  it("lower-cases, drops accents and turns punctuation into single spaces", () => {
    expect(normalizeSearch("  Class A (Gallon) ")).toBe("class a gallon");
    expect(normalizeSearch("AFP-067")).toBe("afp 067");
    expect(normalizeSearch("Piña")).toBe("pina");
  });
});

describe("rankPhoneSearch - what it finds", () => {
  it("lists the pages alone, in bar order, before anything is typed", () => {
    expect(search("").map((r) => r.label)).toEqual(ADMIN_PAGES.map((p) => p.label));
    expect(search("   ")).toHaveLength(ADMIN_PAGES.length);
  });

  it("finds a product by name, by SKU and by words in any order", () => {
    expect(labels("liquid", "Products")).toEqual(["LIQUID SEASONING"]);
    expect(labels("afp057", "Products")).toEqual(["JAMPONG HOT CHILI SAUCE"]);
    expect(labels("a sweet", "Products")).toEqual(["SWEET A", "MORE SWEET A"]);
    expect(labels("white vinegar", "Products")).toEqual(["CANE VINEGAR WHITE A"]);
  });

  it("forgives one slip in a word of four letters or more, but not in a short one", () => {
    expect(labels("vinegr", "Products")).toEqual(["CANE VINEGAR WHITE A"]);
    expect(labels("seasonnig", "Products")).toEqual(["LIQUID SEASONING"]);
    expect(labels("pasword", "Settings")).toContain("My Account");
    expect(labels("hxt", "Products")).toEqual([]);
  });

  it("does not take a short word for a near miss of an unrelated keyword", () => {
    // "sheet" is one of the Daily Report's keywords; "sweet" is a product.
    expect(labels("sweet", "Pages")).toEqual([]);
    expect(labels("histroy", "Pages")).toEqual(["Change Log"]);
  });

  it("puts a name that starts with the whole phrase ahead of one that only contains it", () => {
    expect(labels("sweet", "Products")[0]).toBe("SWEET A");
  });

  it("shows today's remaining stock under a product, and nothing until it has loaded", () => {
    const hit = search("liquid").find((r) => r.group === "Products");
    expect(hit?.detail).toBe("Online 102 · Offline 1,000 · Total 1,102");
    expect(search("liquid", { stocks: null }).find((r) => r.group === "Products")?.detail).toBeUndefined();
  });

  it("opens Consolidated filtered to the product (its SKU, or its name when it has none)", () => {
    const bySku = search("liquid").find((r) => r.group === "Products");
    expect(bySku).toMatchObject({ kind: "link", to: "/total-stocks", handoff: { key: "stocks-query", value: "AFP043" } });
    const byName = search("toyomansi").find((r) => r.group === "Products");
    expect(byName).toMatchObject({ handoff: { key: "stocks-query", value: "NSC TOYOMANSI" } });
  });

  it("finds a category, with its product count and total", () => {
    const hit = search("gallon").find((r) => r.group === "Categories");
    expect(hit).toMatchObject({ label: "Class A (Gallon)", hint: "3 products", handoff: { key: "stocks-category", value: "Class A (Gallon)" } });
    expect(hit?.detail).toBe("Total remaining 3,305");
  });

  it("finds a page by what it is for, and a settings section by what it holds", () => {
    expect(labels("history", "Pages")).toEqual(["Change Log"]);
    expect(labels("inventory", "Pages")).toEqual(["Consolidated"]);
    expect(labels("backup", "Settings")).toEqual(["Backup & Restore", "Google Drive"]);
    expect(search("backup").find((r) => r.label === "Backup & Restore")).toMatchObject({ to: "/settings", handoff: { key: "settings-tab", value: "backup" } });
  });

  it("offers to switch the colour mode, named for the mode it switches to", () => {
    // Already dark: "dark mode" still finds the switch, which now goes the other way.
    expect(labels("dark mode", "Actions")).toEqual(["Switch to light mode"]);
    expect(labels("light mode", "Actions")).toEqual(["Switch to light mode"]);
    expect(labels("theme", "Actions")).toEqual(["Switch to light mode"]);
    expect(labels("theme", "Actions", { theme: "light" })).toEqual(["Switch to dark mode"]);
  });

  it("reads a date and offers that day's Daily Report first", () => {
    const [first] = search("nov 9");
    expect(first).toMatchObject({ group: "Reports", label: "Daily Report · November 9, 2026", to: "/daily-report", handoff: { key: "report-date", value: "2026-11-09" } });
    expect(search("today")[0]).toMatchObject({ group: "Reports", hint: "Today" });
  });

  it("ends with a search of the Change Log, carrying the text as typed", () => {
    const all = search("Vinegar");
    expect(all[all.length - 1]).toMatchObject({ group: "Change Log", label: "Search the Change Log for “Vinegar”", handoff: { key: "changelog-query", value: "Vinegar" } });
    expect(search("v").some((r) => r.group === "Change Log")).toBe(false);
  });

  it("keeps each group together, the best-matching group first", () => {
    const groups = search("sweet").map((r) => r.group);
    expect(groups).toEqual([...groups].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)));
    expect(groups[0]).toBe("Products");
  });
});

describe("rankPhoneSearch - only what this role may open", () => {
  const ENCODER_PAGES = [page("/daily-report", "Daily Report"), page("/total-stocks", "Consolidated"), page("/daily-out", "Daily Out"), page("/settings", "Settings")];
  const encoder = { pages: ENCODER_PAGES, settings: settingsTabsFor(false) };

  it("offers an Encoder no Change Log search and no admin settings", () => {
    expect(search("vinegar", encoder).some((r) => r.group === "Change Log")).toBe(false);
    expect(labels("backup", "Settings", encoder)).toEqual([]);
    expect(labels("password", "Settings", encoder)).toEqual(["My Account"]);
  });

  it("offers nothing that needs a page the role does not have", () => {
    const noStocks = { pages: [page("/settings", "Settings")], settings: settingsTabsFor(false) };
    expect(search("sweet", noStocks)).toEqual([]);
    expect(search("nov 9", noStocks)).toEqual([]);
  });
});

describe("parseSearchDate", () => {
  const parse = (q: string) => parseSearchDate(q, TODAY);

  it("reads the usual ways of writing a day", () => {
    expect(parse("today")).toBe("2026-11-11");
    expect(parse("Yesterday")).toBe("2026-11-10");
    expect(parse("2026-11-09")).toBe("2026-11-09");
    expect(parse("11/9")).toBe("2026-11-09");
    expect(parse("11/9/26")).toBe("2026-11-09");
    expect(parse("11-9-2026")).toBe("2026-11-09");
    expect(parse("nov 9")).toBe("2026-11-09");
    expect(parse("November 9, 2026")).toBe("2026-11-09");
    expect(parse("9 nov")).toBe("2026-11-09");
  });

  it("takes a day without a year to be the most recent one", () => {
    expect(parse("dec 25")).toBe("2025-12-25");
    expect(parse("12/25")).toBe("2025-12-25");
  });

  it("crosses a month and a year going back from the first", () => {
    expect(parseSearchDate("yesterday", "2026-01-01")).toBe("2025-12-31");
  });

  it("is not a date when it is not one, or has not happened yet", () => {
    expect(parse("sweet a")).toBeNull();
    expect(parse("no 9")).toBeNull();
    expect(parse("2/30")).toBeNull();
    expect(parse("13/1")).toBeNull();
    expect(parse("dec 25 2026")).toBeNull();
    expect(parse("")).toBeNull();
  });
});
