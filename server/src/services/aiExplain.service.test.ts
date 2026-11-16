import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: { geminiApiKey: "test-key", geminiModel: "gemini-test" },
  getVarianceTrace: vi.fn(),
}));
vi.mock("../config/env", () => ({ env: mocks.env }));
vi.mock("./manualCounts.service", () => ({ getVarianceTrace: mocks.getVarianceTrace }));

import { buildPayload, explainVariance } from "./aiExplain.service";

const trace = (over: Record<string, unknown> = {}) => ({
  product: { id: 1, sku: "SKU-1", name: "Secret Product Name" },
  location: "ONLINE" as const,
  entryDate: "2026-11-14",
  shift: "NIGHT",
  count: {
    manualCount: 8,
    systemRemainingStock: 20,
    variance: -12,
    remarks: "Spoilage",
    countedBy: "Maria Santos",
    countedAt: new Date("2026-11-14T15:00:00Z"),
    publishedAt: null,
  },
  opening: { expected: 30, actual: 30, isBreak: false, source: "system" as const },
  entrySaved: true,
  encodedBy: "Juan Dela Cruz",
  figures: [{ label: "Delivery (Out)", value: "5" }],
  history: [
    { at: new Date("2026-11-14T16:00:00Z"), who: "Juan Dela Cruz", what: "Entry", action: "UPDATE", summary: "Delivery 0 -> 5", auto: false, afterCount: true },
    { at: new Date("2026-11-14T16:00:01Z"), who: "Juan Dela Cruz", what: "Entry", action: "UPDATE", summary: "Remaining 20", auto: true, afterCount: true },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.geminiApiKey = "test-key";
  mocks.getVarianceTrace.mockResolvedValue(trace());
});
afterEach(() => vi.unstubAllGlobals());

describe("buildPayload - what leaves the server", () => {
  it("contains no person names and no product name", () => {
    const json = JSON.stringify(buildPayload(trace() as never));
    expect(json).not.toContain("Maria");
    expect(json).not.toContain("Juan");
    expect(json).not.toContain("Secret Product Name");
    expect(json).toContain("SKU-1");
    expect(json).toContain('"by":"system"');
    expect(json).toContain('"by":"a user"');
  });

  it("caps the history at 25 items", () => {
    const history = Array.from({ length: 60 }, (_, i) => ({
      at: new Date(2026, 10, 14, 0, i), who: null, what: "Entry", action: "UPDATE", summary: `s${i}`, auto: false, afterCount: false,
    }));
    expect(buildPayload(trace({ history }) as never).history).toHaveLength(25);
  });
});

describe("explainVariance", () => {
  it("says it is not set up when there is no key, without calling Google", async () => {
    mocks.env.geminiApiKey = "";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when no count is saved", async () => {
    mocks.getVarianceTrace.mockResolvedValue(trace({ count: null }));
    vi.stubGlobal("fetch", vi.fn());
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({ status: 400 });
  });

  it("sends the key in a header (not the URL) and returns the model's text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "Short by 12. " }, { text: "Check the late edit." }] } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const out = await explainVariance(1, new Date(), "NIGHT" as never, "ONLINE");
    expect(out).toEqual({ explanation: "Short by 12. Check the late edit.", model: "gemini-test" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("gemini-test:generateContent");
    expect(url).not.toContain("test-key");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
  });

  it("maps a Google error to a 502 that does not leak the response", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "secret detail" }) }));
    const err = await explainVariance(1, new Date(), "NIGHT" as never, "ONLINE").catch((e) => e);
    expect(err).toMatchObject({ status: 502 });
    expect(err.message).not.toContain("secret");
  });

  it("tells the person when the key or the model is the problem, and logs Google's reason", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const google = (status: number, message: string) =>
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { status: "X", message } }) }));

    google(404, "This model is no longer available to new users.");
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("GEMINI_MODEL"),
    });
    expect(String(log.mock.calls.at(-1)?.[0])).toContain("no longer available");

    google(403, "API key not valid");
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({
      message: expect.stringContaining("GEMINI_API_KEY"),
    });
    // The key itself never reaches a log line.
    expect(log.mock.calls.every((c) => !String(c[0]).includes("test-key"))).toBe(true);
  });

  it("recognises Google's other ways of saying the key or the region is the problem (a bad key is a 400)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const google = (status: number, message: string) =>
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { status: "X", message } }) }));
    const run = () => explainVariance(1, new Date(), "NIGHT" as never, "ONLINE");

    google(400, "API key not valid. Please pass a valid API key.");
    await expect(run()).rejects.toMatchObject({ message: expect.stringContaining("GEMINI_API_KEY") });
    google(400, "User location is not supported for the API use.");
    await expect(run()).rejects.toMatchObject({ message: expect.stringContaining("country this server is hosted in") });
    google(403, "Requests from referer <empty> are blocked.");
    await expect(run()).rejects.toMatchObject({ message: expect.stringContaining("GEMINI_API_KEY") });
    google(400, "Something else is wrong with the request.");
    await expect(run()).rejects.toMatchObject({ message: "The AI service could not answer that." });
  });

  it("says a Google usage limit is a usage limit (not 'busy'), keeps the metric in the log, and never the key", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const longMessage = "You exceeded your current quota. " + "x".repeat(400) + " Quota exceeded for metric: generate_content_free_tier_requests, limit: 5";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: longMessage } }) }));
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining("usage limit"),
    });
    const line = String(log.mock.calls.at(-1)?.[0]);
    expect(line).toContain("RESOURCE_EXHAUSTED");
    expect(line).toContain("limit: 5");
    expect(line).not.toContain("test-key");
  });

  it("maps a network failure/timeout to a 502", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({ status: 502 });
  });

  it("treats an empty answer as an error rather than showing a blank box", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) }));
    await expect(explainVariance(1, new Date(), "NIGHT" as never, "ONLINE")).rejects.toMatchObject({ status: 502 });
  });
});
