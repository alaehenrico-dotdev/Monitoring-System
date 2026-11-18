import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { createServer } from "http";
import type { AddressInfo } from "net";

const mocks = vi.hoisted(() => ({ env: { aiRateLimitMax: 3, aiUserDailyLimit: 100 } }));
vi.mock("../config/env", () => ({ env: mocks.env }));

import { aiGuard, resetAiLimits, waitText } from "./aiLimits";

/// A route behind the guard for one feature. `X-User` says who is signed in. The handler answers at once
/// unless a gate is set, in which case it waits for it (to hold a request "in flight").
function appFor(feature: string, gate: { wait: Promise<void> | null } = { wait: null }): Express {
  const app = express();
  app.use((req, _res, next) => {
    const id = req.header("x-user");
    if (id) (req as unknown as { user: { id: number } }).user = { id: Number(id) };
    next();
  });
  app.post("/ask", aiGuard(feature), async (_req, res) => {
    if (gate.wait) await gate.wait;
    res.json({ ok: true });
  });
  return app;
}

async function withServer(app: Express, fn: (post: (user: number) => Promise<Response>) => Promise<void>) {
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn((user) => fetch(`http://127.0.0.1:${port}/ask`, { method: "POST", headers: { "x-user": String(user) } }));
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}

const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

beforeEach(() => {
  resetAiLimits();
  mocks.env.aiRateLimitMax = 3;
  mocks.env.aiUserDailyLimit = 100;
});
afterEach(() => vi.useRealTimers());

describe("the short window", () => {
  it("lets a person ask up to the limit, then says how long to wait", async () => {
    await withServer(appFor("ask"), async (post) => {
      for (let i = 0; i < 3; i++) expect((await post(1)).status).toBe(200);
      const refused = await post(1);
      expect(refused.status).toBe(429);
      expect(await errorOf(refused)).toMatch(/asked the AI a lot in a short time\. Try again in about (a minute|\d+ minutes)\./);
      // The standard header carries the wait in seconds too, for anything that reads it.
      const wait = Number(refused.headers.get("retry-after"));
      expect(wait).toBeGreaterThan(0);
      expect(wait).toBeLessThanOrEqual(600);
    });
  });

  it("counts each person separately", async () => {
    await withServer(appFor("ask"), async (post) => {
      for (let i = 0; i < 3; i++) await post(1);
      expect((await post(1)).status).toBe(429);
      expect((await post(2)).status).toBe(200);
    });
  });

  it("keeps each feature's allowance to itself", async () => {
    const ask = appFor("ask");
    const explain = appFor("explain");
    await withServer(ask, async (postAsk) => {
      await withServer(explain, async (postExplain) => {
        for (let i = 0; i < 3; i++) await postAsk(1);
        expect((await postAsk(1)).status).toBe(429);
        expect((await postExplain(1)).status).toBe(200);
      });
    });
  });
});

describe("one at a time", () => {
  it("refuses a second request while the first is still being answered, then accepts the next once it is done", async () => {
    let release!: () => void;
    const gate = { wait: new Promise<void>((r) => (release = r)) as Promise<void> | null };
    await withServer(appFor("ask", gate), async (post) => {
      const first = post(1);
      // Give the first request time to reach the handler before the second arrives.
      await new Promise((r) => setTimeout(r, 30));
      const second = await post(1);
      expect(second.status).toBe(429);
      expect(await errorOf(second)).toMatch(/still working on your last question/);

      release();
      expect((await first).status).toBe(200);
      gate.wait = null;
      expect((await post(1)).status).toBe(200);
    });
  });

  it("lets a different person ask at the same time", async () => {
    let release!: () => void;
    const gate = { wait: new Promise<void>((r) => (release = r)) as Promise<void> | null };
    await withServer(appFor("ask", gate), async (post) => {
      const first = post(1);
      await new Promise((r) => setTimeout(r, 30));
      gate.wait = null;
      expect((await post(2)).status).toBe(200);
      release();
      expect((await first).status).toBe(200);
    });
  });

  it("does not spend the person's window on the requests it refuses", async () => {
    mocks.env.aiRateLimitMax = 2;
    let release!: () => void;
    const gate = { wait: new Promise<void>((r) => (release = r)) as Promise<void> | null };
    await withServer(appFor("ask", gate), async (post) => {
      const first = post(1); // 1 of 2
      await new Promise((r) => setTimeout(r, 30));
      for (let i = 0; i < 4; i++) expect((await post(1)).status).toBe(429); // all "still working": none counted
      release();
      await first;
      gate.wait = null;
      expect((await post(1)).status).toBe(200); // 2 of 2: still has its second
      expect((await post(1)).status).toBe(429);
    });
  });

  it("frees the slot when a later guard refuses the request, so the person is told the real reason next time", async () => {
    mocks.env.aiRateLimitMax = 1;
    await withServer(appFor("ask"), async (post) => {
      expect((await post(1)).status).toBe(200);
      for (let i = 0; i < 3; i++) {
        const res = await post(1);
        expect(res.status).toBe(429);
        expect(await errorOf(res)).toMatch(/a lot in a short time/); // never "still working": the slot was freed
      }
    });
  });
});

describe("the daily allowance", () => {
  it("stops a person at their daily limit, whatever the window allows, and says it resets tomorrow", async () => {
    mocks.env.aiRateLimitMax = 50;
    mocks.env.aiUserDailyLimit = 3;
    await withServer(appFor("ask"), async (post) => {
      for (let i = 0; i < 3; i++) expect((await post(1)).status).toBe(200);
      const refused = await post(1);
      expect(refused.status).toBe(429);
      expect(await errorOf(refused)).toBe("You've used your 3 AI requests for today. The allowance resets tomorrow.");
    });
  });

  it("is one allowance across all the AI features, and one person's use never touches another's", async () => {
    mocks.env.aiRateLimitMax = 50;
    mocks.env.aiUserDailyLimit = 2;
    await withServer(appFor("ask"), async (postAsk) => {
      await withServer(appFor("explain"), async (postExplain) => {
        expect((await postAsk(1)).status).toBe(200);
        expect((await postExplain(1)).status).toBe(200);
        expect((await postAsk(1)).status).toBe(429); // used up across both
        expect((await postExplain(1)).status).toBe(429);
        expect((await postAsk(2)).status).toBe(200); // someone else is unaffected
      });
    });
  });

  it("starts again the next day", async () => {
    mocks.env.aiRateLimitMax = 50;
    mocks.env.aiUserDailyLimit = 1;
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-17T10:00:00Z") });
    await withServer(appFor("ask"), async (post) => {
      expect((await post(1)).status).toBe(200);
      expect((await post(1)).status).toBe(429);
      vi.setSystemTime(new Date("2026-11-18T00:00:05Z"));
      expect((await post(1)).status).toBe(200);
    });
  });

  it("can be turned off with 0", async () => {
    mocks.env.aiRateLimitMax = 50;
    mocks.env.aiUserDailyLimit = 0;
    await withServer(appFor("ask"), async (post) => {
      for (let i = 0; i < 6; i++) expect((await post(1)).status).toBe(200);
    });
  });
});

describe("waitText", () => {
  it("rounds up to whole minutes a person can plan around", () => {
    expect(waitText(1)).toBe("about a minute");
    expect(waitText(60)).toBe("about a minute");
    expect(waitText(61)).toBe("about 2 minutes");
    expect(waitText(600)).toBe("about 10 minutes");
  });
});
