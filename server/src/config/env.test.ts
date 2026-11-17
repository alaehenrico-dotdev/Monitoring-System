import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

// Side-effect-only import in env.ts; mocked so tests don't depend on
// whatever the real .env file on disk happens to contain.
vi.mock("dotenv/config", () => ({}));

const REQUIRED_VARS = {
  DATABASE_URL: "mysql://root:pw@localhost:3306/test",
  // At least 32 characters, matching the floor env.ts now enforces.
  JWT_SECRET: "a-real-random-secret-value-long-enough-to-pass",
  DATA_RESET_PASSCODE: "a-real-passcode-someone-chose",
};

// The exact placeholder each variable ships with in .env.example - the
// scenario this guard exists for (copying the example file verbatim).
const EXAMPLE_PLACEHOLDERS: Record<string, string> = {
  JWT_SECRET: "change-this-to-a-long-random-string",
  DATA_RESET_PASSCODE: "000000",
};

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...REQUIRED_VARS };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe("env", () => {
  it("boots when every secret is a real, non-placeholder value", async () => {
    const { env } = await import("./env.js");
    expect(env.jwtSecret).toBe(REQUIRED_VARS.JWT_SECRET);
    expect(env.dataResetPasscode).toBe(REQUIRED_VARS.DATA_RESET_PASSCODE);
  });

  it.each(Object.keys(EXAMPLE_PLACEHOLDERS))("rejects %s left at its .env.example placeholder", async (name) => {
    process.env[name] = EXAMPLE_PLACEHOLDERS[name];
    await expect(import("./env.js")).rejects.toThrow(/placeholder/i);
  });

  it("rejects a placeholder regardless of case or surrounding whitespace", async () => {
    process.env.JWT_SECRET = "  CHANGE-THIS-TO-A-LONG-RANDOM-STRING  ";
    await expect(import("./env.js")).rejects.toThrow(/placeholder/i);
  });

  it("still rejects a missing required secret (existing behavior)", async () => {
    delete process.env.JWT_SECRET;
    await expect(import("./env.js")).rejects.toThrow(/Missing required environment variable: JWT_SECRET/);
  });
});

describe("env - secret strength", () => {
  it("rejects a JWT_SECRET shorter than 32 characters", async () => {
    // Every token this signs is handed to a client, so a short secret is
    // open to unlimited offline guessing.
    process.env.JWT_SECRET = "a".repeat(31);
    await expect(import("./env.js")).rejects.toThrow(/at least 32 characters/);
  });

  it("accepts a JWT_SECRET of exactly 32 characters", async () => {
    process.env.JWT_SECRET = "b".repeat(32);
    const { env } = await import("./env.js");
    expect(env.jwtSecret).toHaveLength(32);
  });

  it("still allows a short human-typed DATA_RESET_PASSCODE", async () => {
    // Deliberately NOT held to the JWT secret's length: this is a code an
    // admin types into the Data Reset screen, defended by the passcode rate
    // limiter and a single-use token, not by entropy. Holding it to 32
    // characters would have broken every existing deployment.
    process.env.DATA_RESET_PASSCODE = "913透";
    const { env } = await import("./env.js");
    expect(env.dataResetPasscode).toBe("913透");
  });

  it("still rejects a 1-2 character passcode", async () => {
    process.env.DATA_RESET_PASSCODE = "12";
    await expect(import("./env.js")).rejects.toThrow(/at least 4 characters/);
  });
});

describe("env - CLIENT_ORIGIN", () => {
  it("falls back to the Vite dev server outside production", async () => {
    delete process.env.CLIENT_ORIGIN;
    process.env.NODE_ENV = "development";
    const { env } = await import("./env.js");
    expect(env.clientOrigin).toBe("http://localhost:5173");
  });

  it("refuses to boot in production without one", async () => {
    // The old localhost fallback booted fine and then rejected every request
    // from the real frontend at the browser's CORS check - a failure that
    // surfaces as an opaque network error, nowhere near its cause.
    delete process.env.CLIENT_ORIGIN;
    process.env.NODE_ENV = "production";
    await expect(import("./env.js")).rejects.toThrow(/CLIENT_ORIGIN must be set in production/);
  });

  it("accepts an explicit origin in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.CLIENT_ORIGIN = "https://stocks.example.com";
    const { env } = await import("./env.js");
    expect(env.clientOrigin).toBe("https://stocks.example.com");
  });

  it("rejects a trailing slash, which can never match a browser Origin header", async () => {
    process.env.CLIENT_ORIGIN = "https://stocks.example.com/";
    await expect(import("./env.js")).rejects.toThrow(/must not end with a slash/);
  });
});

describe("env - Gemini keys", () => {
  const GEMINI = ["GEMINI_API_KEY", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3"];
  beforeEach(() => {
    for (const n of GEMINI) delete process.env[n];
  });

  it("reads the main key and up to two backups, in order", async () => {
    Object.assign(process.env, { GEMINI_API_KEY: "  main  ", GEMINI_API_KEY_2: "second", GEMINI_API_KEY_3: "third" });
    const { env } = await import("./env.js");
    expect(env.geminiApiKeys).toEqual(["main", "second", "third"]);
    expect(env.geminiApiKey).toBe("main");
  });

  it("skips blank keys and counts a repeated key once", async () => {
    Object.assign(process.env, { GEMINI_API_KEY: "same", GEMINI_API_KEY_2: "   ", GEMINI_API_KEY_3: "same" });
    const { env } = await import("./env.js");
    expect(env.geminiApiKeys).toEqual(["same"]);
  });

  it("uses a backup as the first key if the main one is not set", async () => {
    Object.assign(process.env, { GEMINI_API_KEY_2: "backup-only" });
    const { env } = await import("./env.js");
    expect(env.geminiApiKeys).toEqual(["backup-only"]);
    expect(env.geminiApiKey).toBe("backup-only");
  });

  it("is simply off with no keys", async () => {
    const { env } = await import("./env.js");
    expect(env.geminiApiKeys).toEqual([]);
    expect(env.geminiApiKey).toBe("");
  });
});

describe("env - OpenRouter fallback (free only)", () => {
  const NAMES = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL", "OPENROUTER_DATA_COLLECTION"];
  beforeEach(() => {
    for (const n of NAMES) delete process.env[n];
  });

  it("is off with nothing set, and asks for no-training hosts by default", async () => {
    const { env } = await import("./env.js");
    expect(env.openrouterApiKey).toBe("");
    expect(env.openrouterModel).toBe("");
    expect(env.openrouterModels).toEqual([]);
    expect(env.openrouterDataCollection).toBe("deny");
  });

  it("accepts a free model and trims the key", async () => {
    Object.assign(process.env, { OPENROUTER_API_KEY: "  sk-or-abc  ", OPENROUTER_MODEL: " vendor/model:free " });
    const { env } = await import("./env.js");
    expect(env.openrouterApiKey).toBe("sk-or-abc");
    expect(env.openrouterModel).toBe("vendor/model:free");
    expect(env.openrouterModels).toEqual(["vendor/model:free"]);
  });

  it("reads several free models in order, ignoring blanks and repeats", async () => {
    Object.assign(process.env, { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: " a/one:free , b/two:free,, a/one:free " });
    const { env } = await import("./env.js");
    expect(env.openrouterModels).toEqual(["a/one:free", "b/two:free"]);
    expect(env.openrouterModel).toBe("a/one:free");
  });

  it("refuses to start if ANY listed model is not free, even when the first one is", async () => {
    Object.assign(process.env, { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "a/one:free,openai/gpt-oss-120b" });
    await expect(import("./env.js")).rejects.toThrow(/must be free models/);
  });

  it("refuses an over-long list", async () => {
    Object.assign(process.env, { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: ["a", "b", "c", "d", "e", "f"].map((n) => `v/${n}:free`).join(",") });
    await expect(import("./env.js")).rejects.toThrow(/too many models/);
  });

  it.each(["openai/gpt-oss-120b", "nvidia/nemotron-3-super-120b-a12b", "vendor/model:free-ish", "openrouter/auto"])(
    "refuses to start with a model that is not free: %s",
    async (model) => {
      Object.assign(process.env, { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: model });
      await expect(import("./env.js")).rejects.toThrow(/must be free models/);
    },
  );

  it("only lifts the no-training restriction on an explicit allow", async () => {
    Object.assign(process.env, { OPENROUTER_DATA_COLLECTION: "Allow" });
    expect((await import("./env.js")).env.openrouterDataCollection).toBe("allow");
    vi.resetModules();
    Object.assign(process.env, { OPENROUTER_DATA_COLLECTION: "yes please" });
    expect((await import("./env.js")).env.openrouterDataCollection).toBe("deny");
  });
});
