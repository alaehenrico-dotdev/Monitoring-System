import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActivitySnapshot, resetActivity } from "../utils/activity";
import { http } from "./http";

// A fetch that stays pending until the test settles it, so "while it is in flight" can be observed.
let settle: Array<(r: Response | Error) => void> = [];
beforeEach(() => {
  resetActivity();
  settle = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise((resolve, reject) => settle.push((r) => (r instanceof Error ? reject(r) : resolve(r))))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetActivity();
});

const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

describe("every API call is counted as activity, for the header seal's loading beam", () => {
  it("counts a request while it is in flight and stops when it finishes", async () => {
    const p = http.get("/products");
    expect(getActivitySnapshot().count).toBe(1);
    settle[0](ok([]));
    await p;
    expect(getActivitySnapshot().count).toBe(0);
  });

  it("counts saves the same way as loads", async () => {
    const p = http.post("/online-stock", { a: 1 });
    expect(getActivitySnapshot().count).toBe(1);
    settle[0](ok());
    await p;
    expect(getActivitySnapshot().count).toBe(0);
  });

  it("counts overlapping requests, and only ends each one once", async () => {
    const a = http.get("/a");
    const b = http.get("/b");
    expect(getActivitySnapshot().count).toBe(2);
    settle[0](ok());
    await a;
    expect(getActivitySnapshot().count).toBe(1);
    settle[1](ok());
    await b;
    expect(getActivitySnapshot().count).toBe(0);
  });

  it("stops counting when the server answers with an error", async () => {
    const p = http.get("/products");
    settle[0](new Response(JSON.stringify({ error: "nope" }), { status: 500 }));
    await expect(p).rejects.toThrow();
    expect(getActivitySnapshot().count).toBe(0);
  });

  it("stops counting when the network fails", async () => {
    const p = http.get("/products");
    settle[0](new TypeError("Failed to fetch"));
    await expect(p).rejects.toThrow("Failed to fetch");
    expect(getActivitySnapshot().count).toBe(0);
  });

  it("stops counting when a request is refused as unauthorised", async () => {
    const p = http.get("/products");
    settle[0](new Response(JSON.stringify({ error: "expired" }), { status: 401 }));
    await expect(p).rejects.toThrow();
    expect(getActivitySnapshot().count).toBe(0);
  });
});
