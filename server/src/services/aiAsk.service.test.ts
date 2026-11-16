import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { geminiApiKey: "k", geminiModel: "gemini-test" },
  getPeriodMonitoring: vi.fn(),
  getVarianceReport: vi.fn(),
  getDaysOfStock: vi.fn(),
  getActionQueue: vi.fn(),
}));
vi.mock("../config/env", () => ({ env: mocks.env }));
vi.mock("../lib/cache", () => ({ getOrSet: (_k: string, _t: number, fn: () => Promise<unknown>) => fn() }));
vi.mock("./actionQueue.service", () => ({ localToday: () => new Date("2026-11-14T00:00:00Z"), getActionQueue: mocks.getActionQueue }));
vi.mock("./daysOfStock.service", () => ({ getDaysOfStock: mocks.getDaysOfStock }));
vi.mock("./manualCounts.service", () => ({ getVarianceReport: mocks.getVarianceReport }));
vi.mock("./periodMonitoring.service", () => ({ getPeriodMonitoring: mocks.getPeriodMonitoring, MAX_PERIOD_DAYS: 366 }));

import { askData, runTool } from "./aiAsk.service";

const TODAY = new Date("2026-11-14T00:00:00Z");
const text = (t: string) => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: t }] } }] }) });
const call = (name: string, args: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name, args }, ...extra }] } }] }),
});
const bodyOf = (fetchMock: ReturnType<typeof vi.fn>, i: number) => JSON.parse(fetchMock.mock.calls[i][1].body);

const vrow = (productId: number, name: string, variance: number, day: number) => ({
  productId, product: { name, sku: `S${productId}`, unit: "pc" }, variance, entryDate: new Date(Date.UTC(2026, 10, day)), shift: "NIGHT", location: "ONLINE",
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.geminiApiKey = "k";
});
afterEach(() => vi.unstubAllGlobals());

describe("askData - the tool loop", () => {
  it("lets the model call a tool, feeds the result back, and returns the answer with its sources", async () => {
    mocks.getPeriodMonitoring.mockResolvedValue({
      from: "2026-11-01", to: "2026-11-14", days: 14,
      totals: { totalOut: 90 },
      products: [{ sku: "S1", name: "Soy", unit: "pc", category: "c", onlineOut: 90, offlineOut: 0, totalOut: 90, backloads: 0, rts: 0, productionIn: 0, netVariance: 0, absVariance: 0 }],
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(call("period_summary", { from: "2026-11-01", to: "2026-11-14" }, { thoughtSignature: "sig-1" }))
      .mockResolvedValueOnce(text("Soy moved 90 units from 2026-11-01 to 2026-11-14."));
    vi.stubGlobal("fetch", fetchMock);

    const out = await askData("How much Soy went out this month?", TODAY);
    expect(out.answer).toContain("90 units");
    expect(out.sources).toHaveLength(1);
    expect(out.sources[0]).toMatchObject({ tool: "period_summary", args: { from: "2026-11-01", to: "2026-11-14" } });

    // The second request carries the model's own turn (signature intact) and the tool result.
    const second = bodyOf(fetchMock, 1).contents;
    expect(second[1]).toMatchObject({ role: "model", parts: [{ thoughtSignature: "sig-1" }] });
    expect(second[2].parts[0].functionResponse.name).toBe("period_summary");
    expect(second[2].parts[0].functionResponse.response.result.totals.totalOut).toBe(90);
    // Today's date is given to the model so relative dates resolve.
    expect(bodyOf(fetchMock, 0).systemInstruction.parts[0].text).toContain("2026-11-14");
  });

  it("answers directly when no tool is needed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(text("I can only help with your stock data.")));
    const out = await askData("What is the capital of France?", TODAY);
    expect(out.sources).toEqual([]);
  });

  it("stops a model that keeps calling tools: bounded calls, then a forced plain answer", async () => {
    mocks.getActionQueue.mockResolvedValue({ total: 0, counts: {}, items: [] });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) =>
      JSON.parse(init.body).toolConfig.functionCallingConfig.mode === "NONE" ? text("Nothing needs attention.") : call("open_issues", {}),
    );
    vi.stubGlobal("fetch", fetchMock);
    const out = await askData("What needs attention?", TODAY);
    expect(out.answer).toBe("Nothing needs attention.");
    expect(out.sources.length).toBeLessThanOrEqual(6);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(5);
    expect(bodyOf(fetchMock, fetchMock.mock.calls.length - 1).toolConfig.functionCallingConfig.mode).toBe("NONE");
  });

  it("validates the question and the key before doing anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(askData("hi", TODAY)).rejects.toMatchObject({ status: 400 });
    await expect(askData("x".repeat(301), TODAY)).rejects.toMatchObject({ status: 400 });
    mocks.env.geminiApiKey = "";
    await expect(askData("What needs attention?", TODAY)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a model failure as a 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    await expect(askData("What needs attention?", TODAY)).rejects.toMatchObject({ status: 502 });
  });
});

describe("runTool - the guard rails", () => {
  it("reports an unknown tool back to the model instead of throwing", async () => {
    expect(await runTool("drop_table", {}, TODAY)).toEqual({ error: 'Unknown tool "drop_table".' });
  });

  it("rejects bad dates and oversized limits as an error result", async () => {
    expect(await runTool("period_summary", { from: "yesterday", to: "2026-11-14" }, TODAY)).toMatchObject({ error: expect.stringContaining("YYYY-MM-DD") });
    expect(await runTool("period_summary", { from: "2026-11-01", to: "2026-11-14", limit: 500 }, TODAY)).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
    expect(mocks.getPeriodMonitoring).not.toHaveBeenCalled();
  });

  it("rejects a backwards or over-long range", async () => {
    expect(await runTool("period_summary", { from: "2026-11-14", to: "2026-11-01" }, TODAY)).toMatchObject({ error: expect.stringContaining("after") });
    expect(await runTool("variance_by_product", { from: "2024-01-01", to: "2026-11-14" }, TODAY)).toMatchObject({ error: expect.stringContaining("at most 366") });
  });

  it("does not hand an oversized result to the model", async () => {
    mocks.getActionQueue.mockResolvedValue({ total: 30, counts: {}, items: Array.from({ length: 30 }, (_, i) => ({ kind: "variance", severity: "low", title: "t".repeat(300), detail: "d".repeat(300) + i })) });
    expect(await runTool("open_issues", {}, TODAY)).toMatchObject({ error: expect.stringContaining("too large") });
  });

  it("does not leak an unexpected failure's message", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getActionQueue.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:3306"));
    expect(await runTool("open_issues", {}, TODAY)).toEqual({ error: "That lookup failed." });
  });
});

describe("variance_by_product", () => {
  it("counts short/over audits, ranks by size, and finds the current run of shorts", async () => {
    // Newest first, as getVarianceReport returns them.
    mocks.getVarianceReport.mockResolvedValue([
      vrow(1, "Soy", -3, 14), vrow(1, "Soy", -2, 13), vrow(1, "Soy", -1, 12), vrow(1, "Soy", 4, 11), vrow(1, "Soy", -5, 10),
      vrow(2, "Oil", 20, 14), vrow(2, "Oil", 0, 13),
    ]);
    const out = (await runTool("variance_by_product", { from: "2026-11-01", to: "2026-11-14" }, TODAY)) as { products: Record<string, unknown>[] };
    expect(out.products.map((p) => p.name)).toEqual(["Oil", "Soy"]);
    expect(out.products[0]).toMatchObject({ audits: 2, overAudits: 1, shortAudits: 0, absVariance: 20, consecutiveShortAudits: 0 });
    expect(out.products[1]).toMatchObject({ audits: 5, shortAudits: 4, overAudits: 1, netVariance: -7, absVariance: 15, consecutiveShortAudits: 3 });
  });

  it("filters by a search word on name or SKU", async () => {
    mocks.getVarianceReport.mockResolvedValue([vrow(1, "Soy Sauce", -3, 14), vrow(2, "Oil", 5, 14)]);
    const out = (await runTool("variance_by_product", { from: "2026-11-01", to: "2026-11-14", search: "s2" }, TODAY)) as { products: { name: string }[] };
    expect(out.products.map((p) => p.name)).toEqual(["Oil"]);
  });
});

describe("days_of_stock", () => {
  it("lists the lowest days-left first, with unknowns last, and honours only_needs_restock", async () => {
    const r = (name: string, daysLeft: number | null, needsRestock: boolean) => ({
      sku: name, name, unit: "pc", totalRemainingStock: 5, lowStockThreshold: 10, needsRestock, averageDailyOutflow: 1, daysLeft, daysWithData: 14, productId: 1, category: "c",
    });
    mocks.getDaysOfStock.mockResolvedValue([r("A", null, true), r("B", 9, false), r("C", 2, true)]);
    const all = (await runTool("days_of_stock", {}, TODAY)) as { products: { name: string }[] };
    expect(all.products.map((p) => p.name)).toEqual(["C", "B", "A"]);
    const low = (await runTool("days_of_stock", { only_needs_restock: true }, TODAY)) as { products: { name: string }[] };
    expect(low.products.map((p) => p.name)).toEqual(["C", "A"]);
  });
});
