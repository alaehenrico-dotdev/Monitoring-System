import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/prisma", async () => (await import("./rateLimitStore.fake.js")).fakePrismaModule);

import { fakeRows as rows } from "./rateLimitStore.fake.js";
import { PrismaRateLimitStore, purgeExpiredRateLimitHits } from "./rateLimitStore";

describe("PrismaRateLimitStore", () => {
  beforeEach(() => {
    rows.clear();
  });

  it("counts hits for a key and keeps the window start", async () => {
    const store = new PrismaRateLimitStore("login");
    store.init({ windowMs: 60_000 } as never);
    const a = await store.increment("1.2.3.4:alice");
    const b = await store.increment("1.2.3.4:alice");
    expect(a.totalHits).toBe(1);
    expect(b.totalHits).toBe(2);
    expect(b.resetTime?.getTime()).toBe(a.resetTime?.getTime());
  });

  it("keeps different keys and different limiters apart", async () => {
    const login = new PrismaRateLimitStore("login");
    const mfa = new PrismaRateLimitStore("mfa");
    login.init({ windowMs: 60_000 } as never);
    mfa.init({ windowMs: 60_000 } as never);
    await login.increment("1.2.3.4");
    await login.increment("1.2.3.4");
    expect((await mfa.increment("1.2.3.4")).totalHits).toBe(1);
    expect((await login.increment("5.6.7.8")).totalHits).toBe(1);
  });

  it("never stores the plain key (a username) in the row key", async () => {
    const store = new PrismaRateLimitStore("login");
    store.init({ windowMs: 60_000 } as never);
    await store.increment("1.2.3.4:alice");
    const [k] = [...rows.keys()];
    expect(k).not.toContain("alice");
    expect(k.length).toBeLessThanOrEqual(80);
  });

  it("starts a fresh window once the old one has ended", async () => {
    const store = new PrismaRateLimitStore("login");
    store.init({ windowMs: 60_000 } as never);
    await store.increment("k");
    await store.increment("k");
    const [k] = [...rows.keys()];
    rows.get(k)!.resetAt = new Date(Date.now() - 1);
    expect((await store.increment("k")).totalHits).toBe(1);
  });

  it("decrement never goes below zero and resetKey clears the counter", async () => {
    const store = new PrismaRateLimitStore("login");
    store.init({ windowMs: 60_000 } as never);
    await store.increment("k");
    await store.decrement("k");
    await store.decrement("k");
    expect([...rows.values()][0].hits).toBe(0);
    await store.resetKey("k");
    expect(rows.size).toBe(0);
  });

  it("purges only windows that have ended", async () => {
    rows.set("old", { hits: 3, resetAt: new Date(Date.now() - 1000) });
    rows.set("live", { hits: 3, resetAt: new Date(Date.now() + 60_000) });
    expect(await purgeExpiredRateLimitHits()).toBe(1);
    expect([...rows.keys()]).toEqual(["live"]);
  });
});
