import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// The service worker is a plain script, so it is run here against a fake `self` to check which page a tapped
// notification opens.
const source = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");

function load() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const openWindow = vi.fn().mockResolvedValue(undefined);
  const fake = {
    addEventListener: (type: string, fn: (e: unknown) => void) => void (listeners[type] = fn),
    location: { origin: "https://stocks.example.com" },
    clients: { matchAll: vi.fn().mockResolvedValue([]), openWindow, claim: vi.fn() },
    registration: { showNotification: vi.fn() },
    skipWaiting: vi.fn(),
    __PRECACHE__: [],
  };
  new Function("self", "caches", "URL", "Response", "fetch", source)(fake, { open: vi.fn(), keys: vi.fn(), match: vi.fn() }, URL, Response, vi.fn());
  const tap = async (url: unknown) => {
    let pending: unknown;
    listeners.notificationclick({ notification: { close: vi.fn(), data: url === undefined ? undefined : { url } }, waitUntil: (p: unknown) => void (pending = p) });
    await pending;
    return openWindow.mock.calls.at(-1)?.[0];
  };
  return { tap };
}

describe("service worker notificationclick", () => {
  it("opens a page of this app as given", async () => {
    const { tap } = load();
    expect(await tap("/online?date=2026-11-19&shift=NIGHT")).toBe("/online?date=2026-11-19&shift=NIGHT");
    expect(await tap("https://stocks.example.com/admin-queue#top")).toBe("/admin-queue#top");
  });

  it("never opens another site or a non-web address: it falls back to the Admin Queue", async () => {
    const { tap } = load();
    for (const bad of ["https://evil.example/phish", "//evil.example/phish", "javascript:alert(1)", "data:text/html,<script>1</script>", "http://stocks.example.com.evil.test/x"]) {
      expect(await tap(bad), bad).toBe("/admin-queue");
    }
  });

  it("opens the Admin Queue when the notification carries no link", async () => {
    const { tap } = load();
    expect(await tap(undefined)).toBe("/admin-queue");
  });
});
