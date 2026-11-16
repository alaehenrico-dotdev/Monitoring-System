import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { geminiApiKey: "k", geminiModel: "gemini-test" },
  getPeriodMonitoring: vi.fn(),
}));
vi.mock("../config/env", () => ({ env: mocks.env }));
vi.mock("../lib/cache", () => ({ getOrSet: (_k: string, _t: number, fn: () => Promise<unknown>) => fn() }));
vi.mock("./actionQueue.service", () => ({ localToday: () => new Date("2026-11-14T00:00:00Z") }));
vi.mock("./periodMonitoring.service", () => ({ getPeriodMonitoring: mocks.getPeriodMonitoring }));

import { buildChangeFacts, whatChanged } from "./aiWhatChanged.service";

type Period = Parameters<typeof buildChangeFacts>[0];
const row = (id: number, name: string, totalOut: number, absVariance = 0) => ({
  productId: id, sku: `S${id}`, name, category: "c", unit: "pc",
  onlineOut: totalOut, offlineOut: 0, totalOut, backloads: 0, rts: 0, productionIn: 0, netVariance: 0, absVariance,
});
const period = (from: string, to: string, products: ReturnType<typeof row>[], days = 7): Period => {
  const sum = (k: "totalOut" | "absVariance") => products.reduce((a, p) => a + p[k], 0);
  return {
    from, to, days,
    totals: {
      onlineOut: sum("totalOut"), offlineOut: 0, totalOut: sum("totalOut"), backloads: 0, rts: 0, productionIn: 0,
      netVariance: 0, absVariance: sum("absVariance"), flaggedProducts: products.filter((p) => p.absVariance > 0).length, countedDays: 1,
    },
    products,
  };
};

describe("buildChangeFacts", () => {
  const prev = period("2026-11-01", "2026-11-07", [row(1, "Soy", 100), row(2, "Oil", 50), row(3, "Salt", 10)]);
  const cur = period("2026-11-08", "2026-11-14", [row(1, "Soy", 130, 4), row(2, "Oil", 20), row(4, "Vinegar", 15)]);
  const f = buildChangeFacts(cur, prev, true);

  it("computes deltas and rounds the percentage to one decimal", () => {
    expect(f.totals.totalOut).toEqual({ previous: 160, current: 165, change: 5, changePct: 3.1 });
    expect(f.totals.absVariance).toMatchObject({ previous: 0, current: 4, change: 4, changePct: null });
  });

  it("ranks products that rose and fell, counting products that appear or vanish", () => {
    expect(f.outflowUp.map((m) => [m.name, m.change])).toEqual([["Soy", 30], ["Vinegar", 15]]);
    expect(f.outflowDown.map((m) => [m.name, m.change])).toEqual([["Oil", -30], ["Salt", -10]]);
    expect(f.varianceUp.map((m) => m.name)).toEqual(["Soy"]);
  });

  it("flags a partial current window and missing history", () => {
    expect(f.currentWindowMayBePartial).toBe(true);
    expect(f.enoughHistory).toBe(true);
    expect(buildChangeFacts(cur, period("a", "b", []), false).enoughHistory).toBe(false);
  });
});

describe("whatChanged", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.geminiApiKey = "k";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a window that is not offered", async () => {
    await expect(whatChanged(5)).rejects.toMatchObject({ status: 400 });
  });

  it("is not set up without a key and does not query anything", async () => {
    mocks.env.geminiApiKey = "";
    await expect(whatChanged(7)).rejects.toMatchObject({ status: 503 });
    expect(mocks.getPeriodMonitoring).not.toHaveBeenCalled();
  });

  it("compares the window with the one right before it, and sends only aggregates to the model", async () => {
    mocks.getPeriodMonitoring.mockImplementation(async (from: Date, to: Date) =>
      period(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), from.getUTCDate() < 8 ? [row(1, "Soy", 100)] : [row(1, "Soy", 130)]),
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Soy rose 30%." }] } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await whatChanged(7, new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T10:00:00Z"));
    expect(out.explanation).toBe("Soy rose 30%.");
    expect(out.facts.current).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    expect(out.facts.previous).toEqual({ from: "2026-11-01", to: "2026-11-07" });
    expect(out.facts.currentWindowMayBePartial).toBe(true);
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body).contents[0].parts[0].text;
    expect(JSON.parse(sent).totals.totalOut.changePct).toBe(30);
  });

  it("still returns the comparison when the AI cannot answer, saying so instead of failing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getPeriodMonitoring.mockImplementation(async (from: Date, to: Date) =>
      period(from.toISOString().slice(0, 10), to.toISOString().slice(0, 10), from.getUTCDate() < 8 ? [row(1, "Soy", 100)] : [row(1, "Soy", 140)]),
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const out = await whatChanged(7, new Date("2026-11-14T00:00:00Z"), new Date("2026-11-14T10:00:00Z"));
    expect(out.explanation).toBeNull();
    expect(out.unavailable).toContain("did not respond");
    expect(out.facts.totals.totalOut.change).toBe(40);
  });

  it("skips the model when there is nothing earlier to compare with", async () => {
    mocks.getPeriodMonitoring.mockResolvedValue(period("a", "b", []));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await whatChanged(7);
    expect(out).toMatchObject({ explanation: null, facts: { enoughHistory: false } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
