import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

// Side-effect-only import in env.ts; mocked so tests don't depend on
// whatever the real .env file on disk happens to contain.
vi.mock("dotenv/config", () => ({}));

const REQUIRED_VARS = {
  DATABASE_URL: "mysql://root:pw@localhost:3306/test",
  JWT_SECRET: "a-real-random-secret-value",
  DATA_RESET_PASSCODE: "a-real-passcode-someone-chose",
  RECEIPT_QR_SECRET: "another-real-random-secret-value",
};

// The exact placeholder each variable ships with in .env.example - the
// scenario this guard exists for (copying the example file verbatim).
const EXAMPLE_PLACEHOLDERS: Record<string, string> = {
  JWT_SECRET: "change-this-to-a-long-random-string",
  DATA_RESET_PASSCODE: "000000",
  RECEIPT_QR_SECRET: "change-this-to-a-long-random-string",
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
    expect(env.receiptQrSecret).toBe(REQUIRED_VARS.RECEIPT_QR_SECRET);
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
