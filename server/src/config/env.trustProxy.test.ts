import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * TRUST_PROXY decides which peers may set X-Forwarded-For, and so decides
 * what `req.ip` is - which is what every limiter in middleware/rateLimit.ts
 * is keyed by. See middleware/rateLimit.test.ts for the matching end-to-end
 * check that a forged header from an untrusted peer really is ignored.
 */

/// The variables config/env.ts refuses to boot without, so these tests don't
/// depend on a developer's server/.env being present or on its values.
const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "mysql://user:pw@localhost:3306/test",
  JWT_SECRET: "test-only-jwt-secret-not-a-placeholder",
  DATA_RESET_PASSCODE: "test-only-passcode-not-a-placeholder",
};

async function loadEnv(trustProxy?: string) {
  vi.resetModules();
  for (const [key, value] of Object.entries(BASE_ENV)) vi.stubEnv(key, value);
  // `undefined` means "not set at all", which is the default path.
  vi.stubEnv("TRUST_PROXY", trustProxy as string);
  return (await import("./env.js")).env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("TRUST_PROXY", () => {
  it("defaults to loopback only - the local reverse proxy, not any hop", async () => {
    expect((await loadEnv(undefined)).trustProxy).toEqual(["loopback"]);
  });

  it("accepts a single address or CIDR", async () => {
    expect((await loadEnv("10.0.0.5")).trustProxy).toEqual(["10.0.0.5"]);
  });

  it("accepts a comma-separated list, trimming whitespace", async () => {
    expect((await loadEnv("loopback, 10.0.0.0/8 ,192.168.1.4")).trustProxy).toEqual([
      "loopback",
      "10.0.0.0/8",
      "192.168.1.4",
    ]);
  });

  it("supports turning the header off entirely", async () => {
    expect((await loadEnv("false")).trustProxy).toBe(false);
    expect((await loadEnv("none")).trustProxy).toBe(false);
    expect((await loadEnv("off")).trustProxy).toBe(false);
  });

  it("still allows an explicit opt-in to trusting every hop", async () => {
    expect((await loadEnv("true")).trustProxy).toBe(true);
  });

  it("rejects a bare hop count, which is the forgeable-header setting this replaced", async () => {
    // The old `app.set("trust proxy", 1)`: it trusts whoever connected, so a
    // direct client could forge X-Forwarded-For and pick a new req.ip per
    // request. Failing at boot is better than silently restoring that.
    await expect(loadEnv("1")).rejects.toThrow(/hop count/i);
  });
});
