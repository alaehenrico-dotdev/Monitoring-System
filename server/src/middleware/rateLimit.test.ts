import { afterEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import type { AddressInfo } from "net";

/**
 * Covers the two things that decide whether the limiters actually bind to a
 * real client:
 *
 *  1. `trust proxy` - which peers are allowed to tell us the client's IP.
 *     server.ts listens directly as well as behind Nginx, so a forged
 *     X-Forwarded-For from a direct connection must not be able to change
 *     `req.ip` (and so must not be able to hand its sender a fresh rate
 *     limit bucket per request).
 *  2. The limiters themselves - that each trips at its configured threshold
 *     and lets requests through again once the window has passed.
 *
 * Requests go over a real loopback socket rather than a faked `req`, because
 * `req.ip` is derived from the actual connection plus Express's trust-proxy
 * setting - which is the whole mechanism under test here.
 */

/// Runs `fn` against a live server on an ephemeral port, then closes it.
async function withServer(app: Express, fn: (baseUrl: string) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function ipEchoApp(trustProxy: boolean | string | string[]): Express {
  const app = express();
  app.set("trust proxy", trustProxy);
  app.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe("trust proxy - whose X-Forwarded-For is believed", () => {
  it("uses the forwarded client IP when the request really does come from a trusted proxy", async () => {
    // "loopback" is the shipped default: the reverse proxy runs on this same
    // machine, so it reaches the API over 127.0.0.1 and its X-Forwarded-For
    // carries the real visitor.
    await withServer(ipEchoApp("loopback"), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/ip`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
      expect(await res.json()).toEqual({ ip: "203.0.113.9" });
    });
  });

  it("ignores a forged X-Forwarded-For from an untrusted direct connection", async () => {
    // Proxy is declared to live at 10.0.0.5, so this loopback connection is
    // NOT a trusted peer - its header is noise and req.ip must stay the
    // address it actually connected from.
    await withServer(ipEchoApp(["10.0.0.5"]), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/ip`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
      const { ip } = (await res.json()) as { ip: string };
      expect(ip).not.toBe("203.0.113.9");
      expect(ip).toContain("127.0.0.1");
    });
  });

  it("ignores X-Forwarded-For entirely when no proxy is trusted", async () => {
    await withServer(ipEchoApp(false), async (baseUrl) => {
      const res = await fetch(`${baseUrl}/ip`, { headers: { "X-Forwarded-For": "203.0.113.9" } });
      const { ip } = (await res.json()) as { ip: string };
      expect(ip).not.toBe("203.0.113.9");
    });
  });
});

describe("a forged X-Forwarded-For cannot rotate around an IP-keyed limiter", () => {
  /// Three requests allowed, each sent with a *different* forged client IP.
  function limitedApp(trustProxy: boolean | string | string[]): Express {
    const app = express();
    app.set("trust proxy", trustProxy);
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: 3,
        standardHeaders: true,
        legacyHeaders: false,
        // The header is the thing under test; don't let the library's own
        // advisory checks about it fail the run.
        validate: { xForwardedForHeader: false, trustProxy: false },
      }),
    );
    app.get("/t", (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  const forged = ["203.0.113.1", "203.0.113.2", "203.0.113.3", "203.0.113.4"];

  it("spends one shared bucket when the sender is not a trusted proxy", async () => {
    await withServer(limitedApp(["10.0.0.5"]), async (baseUrl) => {
      const statuses: number[] = [];
      for (const ip of forged) {
        const res = await fetch(`${baseUrl}/t`, { headers: { "X-Forwarded-For": ip } });
        statuses.push(res.status);
      }
      // All four counted against the real socket address, so the 4th is over.
      expect(statuses).toEqual([200, 200, 200, 429]);
    });
  });

  it("does give a trusted proxy's distinct clients their own buckets", async () => {
    // The contrast that proves the case above is really about trust, not
    // about the header being ignored unconditionally.
    await withServer(limitedApp("loopback"), async (baseUrl) => {
      const statuses: number[] = [];
      for (const ip of forged) {
        const res = await fetch(`${baseUrl}/t`, { headers: { "X-Forwarded-For": ip } });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([200, 200, 200, 200]);
    });
  });
});

/// Env the real config/env.ts insists on, so these tests don't depend on a
/// developer's server/.env being present or on its values.
const BASE_ENV: Record<string, string> = {
  DATABASE_URL: "mysql://user:pw@localhost:3306/test",
  JWT_SECRET: "test-only-jwt-secret-not-a-placeholder",
  DATA_RESET_PASSCODE: "test-only-passcode-not-a-placeholder",
};

/// Re-imports middleware/rateLimit.ts with the given env, so the exported
/// limiters are rebuilt from it. Doubles as the check that the RATE_LIMIT_*
/// overrides are actually wired through config/env.ts.
async function loadLimiters(overrides: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...BASE_ENV, ...overrides })) vi.stubEnv(key, value);
  return await import("./rateLimit.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/// Sends `count` requests and returns their status codes.
async function hit(baseUrl: string, count: number, init?: RequestInit): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const res = await fetch(baseUrl, init);
    statuses.push(res.status);
  }
  return statuses;
}

describe("the shipped limiters trip at their configured threshold and reset after the window", () => {
  it("apiLimiter - global", async () => {
    const { apiLimiter } = await loadLimiters({ RATE_LIMIT_GLOBAL_MAX: "3", RATE_LIMIT_GLOBAL_WINDOW_MS: "1000" });
    const app = express();
    app.use("/api", apiLimiter);
    app.get("/api/x", (_req, res) => {
      res.json({ ok: true });
    });

    await withServer(app, async (baseUrl) => {
      expect(await hit(`${baseUrl}/api/x`, 4)).toEqual([200, 200, 200, 429]);
      await sleep(1100);
      expect(await hit(`${baseUrl}/api/x`, 1)).toEqual([200]);
    });
  });

  it("authLimiter - login", async () => {
    const { authLimiter } = await loadLimiters({ RATE_LIMIT_LOGIN_MAX: "2", RATE_LIMIT_LOGIN_WINDOW_MS: "1000" });
    const app = express();
    app.use(express.json());
    app.post("/login", authLimiter, (_req, res) => {
      res.json({ ok: true });
    });

    const asUser = (username: string): RequestInit => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password: "nope" }),
    });

    await withServer(app, async (baseUrl) => {
      expect(await hit(`${baseUrl}/login`, 3, asUser("encoder-a"))).toEqual([200, 200, 429]);
      // Keyed by IP *and* username, so one account being hammered does not
      // lock everyone else sharing this office's public IP out of logging in.
      expect(await hit(`${baseUrl}/login`, 1, asUser("encoder-b"))).toEqual([200]);
      await sleep(1100);
      expect(await hit(`${baseUrl}/login`, 1, asUser("encoder-a"))).toEqual([200]);
    });
  });

  it("passcodeLimiter - data reset passcode", async () => {
    const { passcodeLimiter } = await loadLimiters({ RATE_LIMIT_PASSCODE_MAX: "2", RATE_LIMIT_PASSCODE_WINDOW_MS: "1000" });
    const app = express();
    app.post("/verify-passcode", passcodeLimiter, (_req, res) => {
      res.json({ ok: true });
    });

    await withServer(app, async (baseUrl) => {
      expect(await hit(`${baseUrl}/verify-passcode`, 3, { method: "POST" })).toEqual([200, 200, 429]);
      await sleep(1100);
      expect(await hit(`${baseUrl}/verify-passcode`, 1, { method: "POST" })).toEqual([200]);
    });
  });
});
