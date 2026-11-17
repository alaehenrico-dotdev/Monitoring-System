import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    openrouterApiKey: "or-secret-key",
    openrouterModel: "vendor/some-model:free",
    openrouterModels: undefined as string[] | undefined,
    openrouterDataCollection: "deny" as "deny" | "allow",
  },
}));
vi.mock("../config/env", () => ({ env: mocks.env }));

import { callOpenRouter, fromOpenAiResponse, OpenRouterError, toOpenAiMessages } from "./openrouter";
import type { GeminiContent } from "./gemini";

const user = (text: string): GeminiContent => ({ role: "user", parts: [{ text }] });
const opts = (over: Record<string, unknown> = {}) => ({ system: "sys", contents: [user("hello")], event: "t", ...over }) as Parameters<typeof callOpenRouter>[0];
const ok = (message: unknown) => ({ ok: true, json: async () => ({ choices: [{ message }] }) });
const fail = (status: number, message = "x") => ({ ok: false, status, json: async () => ({ error: { message } }) });
const sent = () => {
  const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
  return { url, headers: init.headers, body: JSON.parse(init.body) };
};

beforeEach(() => {
  mocks.env.openrouterApiKey = "or-secret-key";
  mocks.env.openrouterModel = "vendor/some-model:free";
  mocks.env.openrouterModels = undefined;
  mocks.env.openrouterDataCollection = "deny";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok({ content: "hi" })));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("toOpenAiMessages - Gemini-shaped conversation to OpenAI-style messages", () => {
  it("puts the system prompt first and keeps plain turns", () => {
    expect(toOpenAiMessages("be brief", [user("q"), { role: "model", parts: [{ text: "a" }] }, user("q2")])).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "q" },
      { role: "assistant", content: "a" },
      { role: "user", content: "q2" },
    ]);
  });

  it("turns a lookup round trip into tool_calls and a matching tool message", () => {
    const messages = toOpenAiMessages("s", [
      user("what needs attention?"),
      { role: "model", parts: [{ functionCall: { name: "open_issues", args: { limit: 3 }, id: "call-1" }, thoughtSignature: "opaque" }] },
      { role: "user", parts: [{ functionResponse: { name: "open_issues", id: "call-1", response: { result: { total: 2 } } } }] },
    ]);
    expect(messages[2]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call-1", type: "function", function: { name: "open_issues", arguments: '{"limit":3}' } }],
    });
    expect(messages[3]).toEqual({ role: "tool", tool_call_id: "call-1", content: '{"total":2}' });
  });

  it("invents ids when the model gave none and still pairs each answer with its own call, by name", () => {
    const messages = toOpenAiMessages("s", [
      user("q"),
      { role: "model", parts: [{ functionCall: { name: "a" } }, { functionCall: { name: "b" } }] },
      { role: "user", parts: [{ functionResponse: { name: "b", response: { result: 2 } } }, { functionResponse: { name: "a", response: { result: 1 } } }] },
    ]);
    const calls = (messages[2] as { tool_calls: { id: string; function: { name: string } }[] }).tool_calls;
    const idOf = (name: string) => calls.find((c) => c.function.name === name)!.id;
    expect(messages[3]).toMatchObject({ role: "tool", tool_call_id: idOf("b"), content: "2" });
    expect(messages[4]).toMatchObject({ role: "tool", tool_call_id: idOf("a"), content: "1" });
    expect(new Set(calls.map((c) => c.id)).size).toBe(2);
  });
});

describe("fromOpenAiResponse", () => {
  it("returns text as a text part", () => {
    expect(fromOpenAiResponse({ choices: [{ message: { content: "hello" } }] })).toEqual({ role: "model", parts: [{ text: "hello" }] });
  });

  it("returns tool calls as function calls with parsed arguments and their id", () => {
    const out = fromOpenAiResponse({ choices: [{ message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "days_of_stock", arguments: '{"limit":5}' } }] } }] });
    expect(out.parts).toEqual([{ functionCall: { name: "days_of_stock", args: { limit: 5 }, id: "c1" } }]);
  });

  it("treats unparsable or non-object arguments as no arguments, so the lookup's own check can answer", () => {
    for (const args of ["{not json", "[1,2]", '"text"', ""]) {
      const out = fromOpenAiResponse({ choices: [{ message: { tool_calls: [{ id: "c", type: "function", function: { name: "x", arguments: args } }] } }] });
      expect(out.parts[0]).toEqual({ functionCall: { name: "x", args: {}, id: "c" } });
    }
  });

  it("refuses an answer with neither text nor calls", () => {
    for (const bad of [{}, { choices: [] }, { choices: [{ message: { content: "   " } }] }, { choices: [{ message: { content: null } }] }]) {
      expect(() => fromOpenAiResponse(bad)).toThrowError(expect.objectContaining({ status: 502 }));
    }
  });
});

describe("callOpenRouter - what is sent", () => {
  it("sends the key in a header, the model, and asks for hosts that do not train on prompts", async () => {
    await callOpenRouter(opts());
    const { url, headers, body } = sent();
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(headers.Authorization).toBe("Bearer or-secret-key");
    expect(url).not.toContain("or-secret-key");
    expect(body.model).toBe("vendor/some-model:free");
    expect(body.provider).toEqual({ data_collection: "deny" });
    expect(body.messages[0]).toEqual({ role: "system", content: "sys" });
  });

  it("lifts the no-training restriction only when the admin explicitly allows it", async () => {
    mocks.env.openrouterDataCollection = "allow";
    await callOpenRouter(opts());
    expect(sent().body.provider).toEqual({ data_collection: "allow" });
  });

  it("maps lookups to OpenAI-style tools, and a forced plain answer to tool_choice none", async () => {
    const tools = [{ name: "open_issues", description: "d", parameters: { type: "object", properties: {} } }];
    await callOpenRouter(opts({ tools }));
    expect(sent().body.tools).toEqual([{ type: "function", function: { name: "open_issues", description: "d", parameters: { type: "object", properties: {} } } }]);
    expect(sent().body.tool_choice).toBe("auto");

    vi.mocked(fetch).mockClear();
    await callOpenRouter(opts({ tools, toolMode: "NONE" }));
    expect(sent().body.tool_choice).toBe("none");
  });

  it("leaves tools out entirely when there are none", async () => {
    await callOpenRouter(opts());
    expect(sent().body).not.toHaveProperty("tools");
    expect(sent().body).not.toHaveProperty("tool_choice");
  });
});

describe("callOpenRouter - free only", () => {
  it("refuses a model that is not free, before sending anything", async () => {
    mocks.env.openrouterModel = "openai/gpt-oss-120b";
    await expect(callOpenRouter(opts())).rejects.toMatchObject({ status: 503, message: expect.stringContaining(":free") });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("callOpenRouter - several free models", () => {
  const modelsTried = () => vi.mocked(fetch).mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body).model);

  beforeEach(() => {
    mocks.env.openrouterModels = ["a/one:free", "b/two:free", "c/three:free"];
  });

  it("uses the first model and never touches the others while it answers", async () => {
    await callOpenRouter(opts());
    expect(modelsTried()).toEqual(["a/one:free"]);
  });

  it("moves to the next model when one is busy (a free host's shared pool), and returns that answer", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(fail(429, "Provider returned error") as never).mockResolvedValueOnce(ok({ content: "from two" }) as never);
    expect(await callOpenRouter(opts())).toEqual({ role: "model", parts: [{ text: "from two" }] });
    expect(modelsTried()).toEqual(["a/one:free", "b/two:free"]);
  });

  it("skips a model the privacy setting blocks, and one that errors", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(fail(404, "No endpoints found matching your data policy") as never)
      .mockResolvedValueOnce(fail(500) as never)
      .mockResolvedValueOnce(ok({ content: "from three" }) as never);
    expect(await callOpenRouter(opts())).toMatchObject({ parts: [{ text: "from three" }] });
    expect(modelsTried()).toEqual(["a/one:free", "b/two:free", "c/three:free"]);
  });

  it("stops at once for a problem with the account - another model would fail the same way", async () => {
    vi.mocked(fetch).mockResolvedValue(fail(401) as never);
    await expect(callOpenRouter(opts())).rejects.toMatchObject({ status: 401 });
    expect(modelsTried()).toEqual(["a/one:free"]);
  });

  it("when every model fails, reports the last failure", async () => {
    vi.mocked(fetch).mockResolvedValue(fail(429) as never);
    await expect(callOpenRouter(opts())).rejects.toMatchObject({ status: 429 });
    expect(modelsTried()).toHaveLength(3);
  });

  it("refuses the whole list if ANY model is not free, before sending anything", async () => {
    mocks.env.openrouterModels = ["a/one:free", "openai/gpt-oss-120b"];
    await expect(callOpenRouter(opts())).rejects.toMatchObject({ status: 503 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("logs the host's own reason for a refusal, not the key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({ error: { message: "Provider returned error", metadata: { raw: "model is temporarily rate-limited upstream" } } }) } as never).mockResolvedValueOnce(ok({ content: "x" }) as never);
    await callOpenRouter(opts());
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("temporarily rate-limited upstream");
    expect(logged).not.toContain("or-secret-key");
  });
});

describe("callOpenRouter - failures", () => {
  const run = (status: number, message?: string) => {
    vi.mocked(fetch).mockResolvedValue(fail(status, message) as never);
    return callOpenRouter(opts()).catch((e) => e as OpenRouterError);
  };

  it("names the setting to fix, and keeps the HTTP status for the caller", async () => {
    expect(await run(401)).toMatchObject({ status: 401, failure: { status: 502, message: expect.stringContaining("OPENROUTER_API_KEY") } });
    expect(await run(402)).toMatchObject({ failure: { message: expect.stringContaining(":free") } });
    expect(await run(404, "No endpoints found matching your data policy")).toMatchObject({ failure: { message: expect.stringContaining("OPENROUTER_DATA_COLLECTION") } });
    expect(await run(429)).toMatchObject({ status: 429, failure: { message: expect.stringContaining("usage limit") } });
    expect(await run(500)).toMatchObject({ failure: { message: "The AI service could not answer that." } });
  });

  it("logs OpenRouter's reason but never the key or the prompt", async () => {
    const log = vi.mocked(console.error);
    await run(404, "No endpoints found matching your data policy");
    const logged = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("data policy");
    expect(logged).not.toContain("or-secret-key");
    expect(logged).not.toContain("hello");
  });

  it("turns a network failure into a plain 502", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("down"));
    await expect(callOpenRouter(opts())).rejects.toMatchObject({ status: 502 });
  });
});
