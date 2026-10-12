import { describe, expect, it, vi } from "vitest";
import { getOrSet, invalidate, invalidateAll, invalidatePrefix } from "./cache";

describe("cache invalidation", () => {
  it("serves a cached value until it is invalidated, then refetches", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("a").mockResolvedValueOnce("b");
    expect(await getOrSet("k1", 60_000, fetcher)).toBe("a");
    expect(await getOrSet("k1", 60_000, fetcher)).toBe("a");
    invalidate("k1");
    expect(await getOrSet("k1", 60_000, fetcher)).toBe("b");
  });

  it("invalidatePrefix drops only matching keys", async () => {
    await getOrSet("days-of-stock:2026-10-12", 60_000, async () => 1);
    await getOrSet("user-status:1", 60_000, async () => 2);
    invalidatePrefix("days-of-stock:");
    expect(await getOrSet("days-of-stock:2026-10-12", 60_000, async () => 10)).toBe(10);
    expect(await getOrSet("user-status:1", 60_000, async () => 20)).toBe(2);
  });

  it("invalidateAll drops everything", async () => {
    await getOrSet("x", 60_000, async () => 1);
    await getOrSet("y", 60_000, async () => 2);
    invalidateAll();
    expect(await getOrSet("x", 60_000, async () => 10)).toBe(10);
    expect(await getOrSet("y", 60_000, async () => 20)).toBe(20);
  });
});
