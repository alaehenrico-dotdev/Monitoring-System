import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    geminiApiKey: "k",
    geminiApiKeys: undefined as string[] | undefined,
    geminiModel: "m",
    aiDailyCallLimit: 3,
    openrouterApiKey: "",
    openrouterModel: "",
    openrouterDataCollection: "deny" as "deny" | "allow",
  },
}));
vi.mock("../config/env", () => ({ env: mocks.env }));

import { generate, resetAiUsage } from "./gemini";

const okResponse = () => ({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "hi" }] } }] }) });
const call = () => generate({ system: "s", contents: [{ role: "user", parts: [{ text: "q" }] }], event: "t" });

beforeEach(() => {
  resetAiUsage();
  mocks.env.geminiApiKey = "k";
  mocks.env.geminiApiKeys = undefined;
  mocks.env.aiDailyCallLimit = 3;
  mocks.env.openrouterApiKey = "";
  mocks.env.openrouterModel = "";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse()));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the server-wide daily AI call cap", () => {
  it("allows calls up to the cap, then refuses with a 429 an admin can act on - without calling Google", async () => {
    for (let i = 0; i < 3; i++) await call();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await expect(call()).rejects.toMatchObject({ status: 429, message: expect.stringContaining("AI_DAILY_CALL_LIMIT") });
    expect(fetchMock).toHaveBeenCalledTimes(3); // the refused call never reached Google
  });

  it("counts attempts that fail too, because Google counts them", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    for (let i = 0; i < 3; i++) await call().catch(() => undefined);
    await expect(call()).rejects.toMatchObject({ status: 429 });
  });

  it("starts a new allowance on the next UTC day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T23:59:00Z"));
    for (let i = 0; i < 3; i++) await call();
    await expect(call()).rejects.toMatchObject({ status: 429 });

    vi.setSystemTime(new Date("2026-11-17T00:01:00Z"));
    await expect(call()).resolves.toBeTruthy();
  });

  it("is off when the limit is 0", async () => {
    mocks.env.aiDailyCallLimit = 0;
    for (let i = 0; i < 10; i++) await call();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(10);
  });

  it("does not use up the allowance when the AI is not set up at all", async () => {
    mocks.env.geminiApiKey = "";
    await expect(call()).rejects.toMatchObject({ status: 503 });
    mocks.env.geminiApiKey = "k";
    for (let i = 0; i < 3; i++) await call();
  });
});

describe("backup keys (failover)", () => {
  const quota = { ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota" } }) };
  const badKey = { ok: false, status: 400, json: async () => ({ error: { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." } }) };
  const keysUsed = () => vi.mocked(fetch).mock.calls.map((c) => (c[1] as { headers: Record<string, string> }).headers["x-goog-api-key"]);
  /// A fetch that answers by which key it was called with.
  const byKey = (answers: Record<string, unknown>) =>
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_u: string, init: { headers: Record<string, string> }) => answers[init.headers["x-goog-api-key"]]));

  beforeEach(() => {
    mocks.env.geminiApiKeys = ["key-A", "key-B", "key-C"];
    mocks.env.aiDailyCallLimit = 0; // these tests are about keys, not the daily cap (one test below sets it)
  });

  it("uses the main key and never touches the backups while it works", async () => {
    byKey({ "key-A": okResponse() });
    await call();
    await call();
    expect(keysUsed()).toEqual(["key-A", "key-A"]);
  });

  it("moves to the next key when the main key is out of quota, and the caller still gets an answer", async () => {
    byKey({ "key-A": quota, "key-B": okResponse() });
    await expect(call()).resolves.toMatchObject({ parts: [{ text: "hi" }] });
    expect(keysUsed()).toEqual(["key-A", "key-B"]);
  });

  it("goes on to the third key when the second is also refused", async () => {
    byKey({ "key-A": quota, "key-B": badKey, "key-C": okResponse() });
    await call();
    expect(keysUsed()).toEqual(["key-A", "key-B", "key-C"]);
  });

  it("skips a key that was just refused, so the next requests do not waste a call on it", async () => {
    byKey({ "key-A": quota, "key-B": okResponse() });
    await call();
    vi.mocked(fetch).mockClear();
    await call();
    await call();
    expect(keysUsed()).toEqual(["key-B", "key-B"]);
  });

  it("goes back to the main key once its cooldown is over (a per-minute limit clears)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    byKey({ "key-A": quota, "key-B": okResponse() });
    await call();
    byKey({ "key-A": okResponse(), "key-B": okResponse() });
    await call();
    expect(keysUsed()).toEqual(["key-B"]); // A is still cooling

    vi.setSystemTime(new Date("2026-11-16T10:02:00Z"));
    await call();
    expect(keysUsed().at(-1)).toBe("key-A");
  });

  it("when every key is refused, says why - and the next request does not call Google at all while they cool", async () => {
    byKey({ "key-A": quota, "key-B": quota, "key-C": quota });
    await expect(call()).rejects.toMatchObject({ status: 502, message: expect.stringContaining("usage limit") });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    await expect(call()).rejects.toMatchObject({ status: 502 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });

  it("does NOT switch keys for a problem a different key would not fix", async () => {
    byKey({ "key-A": { ok: false, status: 500, json: async () => ({}) }, "key-B": okResponse() });
    await expect(call()).rejects.toMatchObject({ status: 502 });
    expect(keysUsed()).toEqual(["key-A"]);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(call()).rejects.toMatchObject({ status: 502 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("counts every attempt against the daily cap, including the ones that fail over", async () => {
    mocks.env.aiDailyCallLimit = 2;
    byKey({ "key-A": quota, "key-B": quota, "key-C": okResponse() });
    // attempt 1 (A) and 2 (B) use the allowance; the third (C) is refused by the cap, not sent
    await expect(call()).rejects.toMatchObject({ status: 429, message: expect.stringContaining("AI_DAILY_CALL_LIMIT") });
    expect(keysUsed()).toEqual(["key-A", "key-B"]);
  });

  it("never writes a key into a log line", async () => {
    const log = vi.mocked(console.error);
    byKey({ "key-A": quota, "key-B": quota, "key-C": quota });
    await call().catch(() => undefined);
    await call().catch(() => undefined);
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    for (const k of ["key-A", "key-B", "key-C"]) expect(logged).not.toContain(k);
    expect(logged).toContain("ai-key-failover");
  });

  it("with ONE key, a refusal is never remembered - Try again really asks Google again", async () => {
    mocks.env.geminiApiKeys = ["only"];
    byKey({ only: quota });
    await expect(call()).rejects.toMatchObject({ status: 502 });
    byKey({ only: okResponse() });
    await expect(call()).resolves.toBeTruthy();
    expect(keysUsed()).toEqual(["only"]);
  });

  it("falls back to the single geminiApiKey setting when no list is given", async () => {
    mocks.env.geminiApiKeys = undefined;
    mocks.env.geminiApiKey = "only-key";
    byKey({ "only-key": okResponse() });
    await call();
    expect(keysUsed()).toEqual(["only-key"]);
  });
});

describe("OpenRouter fallback", () => {
  const quota = { ok: false, status: 429, json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota" } }) };
  const orOk = () => ({ ok: true, json: async () => ({ choices: [{ message: { content: "from openrouter" } }] }) });
  const orFail = (status: number) => ({ ok: false, status, json: async () => ({ error: { message: "nope" } }) });
  const isOr = (u: string) => u.includes("openrouter.ai");
  /// Routes by provider: gemini(...) answers Google calls, openrouter(...) answers OpenRouter calls.
  const route = (gemini: unknown, openrouter: unknown) =>
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (u: string) => (isOr(u) ? openrouter : gemini)));
  const orCalls = () => vi.mocked(fetch).mock.calls.filter((c) => isOr(String(c[0]))).length;
  const textOf = (r: { parts: { text?: string }[] }) => r.parts.map((p) => p.text).join("");

  beforeEach(() => {
    mocks.env.aiDailyCallLimit = 0;
    mocks.env.openrouterApiKey = "or-key";
    mocks.env.openrouterModel = "vendor/model:free";
  });

  it("is not used while Gemini works", async () => {
    route(okResponse(), orOk());
    expect(textOf((await call()) as never)).toBe("hi");
    expect(orCalls()).toBe(0);
  });

  it("answers from OpenRouter when Gemini is out of quota, and the caller notices nothing", async () => {
    route(quota, orOk());
    expect(textOf((await call()) as never)).toBe("from openrouter");
    expect(orCalls()).toBe(1);
  });

  it("also covers Google failing outright", async () => {
    route({ ok: false, status: 500, json: async () => ({}) }, orOk());
    expect(textOf((await call()) as never)).toBe("from openrouter");
  });

  it("does NOT fall back for our own daily cap - that is a decision, not Google failing", async () => {
    mocks.env.aiDailyCallLimit = 1;
    route(okResponse(), orOk());
    await call();
    await expect(call()).rejects.toMatchObject({ status: 429, message: expect.stringContaining("AI_DAILY_CALL_LIMIT") });
    expect(orCalls()).toBe(0);
  });

  it("counts the fallback's attempt against the same daily cap", async () => {
    mocks.env.aiDailyCallLimit = 2;
    route(quota, orOk());
    await call(); // Gemini attempt (1) + OpenRouter attempt (2)
    await expect(call()).rejects.toMatchObject({ status: 429 });
  });

  it("without the fallback configured, Gemini's own failure is what comes back", async () => {
    mocks.env.openrouterApiKey = "";
    route(quota, orOk());
    await expect(call()).rejects.toMatchObject({ status: 502, message: expect.stringContaining("usage limit") });
    expect(orCalls()).toBe(0);
  });

  it("needs both a key and a model - one alone is not 'configured'", async () => {
    mocks.env.openrouterModel = "";
    route(quota, orOk());
    await expect(call()).rejects.toMatchObject({ status: 502 });
    expect(orCalls()).toBe(0);
  });

  it("when both fail, reports Gemini's reason (the fallback's goes to the log)", async () => {
    route(quota, orFail(401));
    await expect(call()).rejects.toMatchObject({ message: expect.stringContaining("Google usage limit") });
    expect(orCalls()).toBe(1);
  });

  it("works as the ONLY provider, with no Gemini key at all", async () => {
    mocks.env.geminiApiKey = "";
    mocks.env.geminiApiKeys = undefined;
    route(okResponse(), orOk());
    expect(textOf((await call()) as never)).toBe("from openrouter");
    expect(vi.mocked(fetch).mock.calls.every((c) => isOr(String(c[0])))).toBe(true);
  });

  it("as the only provider, a refusal is never remembered - Try again really asks again", async () => {
    mocks.env.geminiApiKey = "";
    route(okResponse(), orFail(429));
    await expect(call()).rejects.toMatchObject({ status: 502 });
    route(okResponse(), orOk());
    await expect(call()).resolves.toBeTruthy();
  });

  it("with Gemini as well, a refused fallback is left alone for a minute so its small daily allowance is not wasted", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-16T10:00:00Z"));
    route(quota, orFail(429));
    await call().catch(() => undefined);
    await call().catch(() => undefined);
    expect(orCalls()).toBe(1); // the second request skipped the cooling fallback

    vi.setSystemTime(new Date("2026-11-16T10:02:00Z"));
    route(quota, orOk());
    expect(textOf((await call()) as never)).toBe("from openrouter");
  });

  it("never logs a key from either provider", async () => {
    const log = vi.mocked(console.error);
    route(quota, orFail(404));
    await call().catch(() => undefined);
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("ai-provider-fallback");
    expect(logged).not.toContain("or-key");
    expect(logged).not.toContain('"k"');
  });
});
