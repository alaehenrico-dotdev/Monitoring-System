import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The point of the shared poller: useOnlineStatus is mounted several times
 * on a typical page (Layout, the server-settings link, the offline badge,
 * the entry page) and tauri/sync/connectivity.ts used to add a second
 * poller of its own. Each instance ran its own 5s /health interval, and
 * every /health runs a `SELECT 1` - so the cost scaled with how many
 * components happened to be on screen.
 *
 * These drive subscribe/getSnapshot directly rather than mounting React:
 * useSyncExternalStore is a thin pass-through to exactly these, and the
 * module-level interval is the thing under test.
 */

vi.mock("./http", () => ({ API_URL: "http://localhost:4000" }));
vi.mock("./reachability", () => ({ setKnownReachable: vi.fn() }));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("navigator", { onLine: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function loadModule() {
  return await import("./serverHealth");
}

/// Lets the probe's own promise chain settle without advancing the clock.
async function flush() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("the shared health poller", () => {
  it("makes one request per interval no matter how many consumers are mounted", async () => {
    const { subscribeServerHealth, HEALTH_CHECK_INTERVAL_MS } = await loadModule();

    // Five consumers, the way a single page really does mount them.
    const unsubscribes = Array.from({ length: 5 }, () => subscribeServerHealth(() => {}));
    await flush();

    // One immediate check on the first subscribe - not five.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    for (const unsubscribe of unsubscribes) unsubscribe();
  });

  it("starts polling on the first subscriber and stops on the last", async () => {
    const { subscribeServerHealth, HEALTH_CHECK_INTERVAL_MS } = await loadModule();

    const first = subscribeServerHealth(() => {});
    const second = subscribeServerHealth(() => {});
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first();
    // Still one subscriber, so the interval keeps running.
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    second();
    // Last one gone - nothing should poll any more.
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-checks immediately when the browser reports going online", async () => {
    const { subscribeServerHealth } = await loadModule();
    const unsubscribe = subscribeServerHealth(() => {});
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("online"));
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    unsubscribe();
  });

  it("publishes a snapshot consumers can read, and counts reconnects", async () => {
    const { subscribeServerHealth, getServerHealthSnapshot, HEALTH_CHECK_INTERVAL_MS } = await loadModule();

    // Not known either way before anything has asked.
    expect(getServerHealthSnapshot().reachable).toBeNull();

    const unsubscribe = subscribeServerHealth(() => {});
    await flush();
    expect(getServerHealthSnapshot()).toEqual({ reachable: true, reconnects: 1 });

    // Server goes away...
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS);
    expect(getServerHealthSnapshot()).toEqual({ reachable: false, reconnects: 1 });

    // ...and comes back: one more reconnect, not one per successful poll.
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS);
    expect(getServerHealthSnapshot()).toEqual({ reachable: true, reconnects: 2 });

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS);
    expect(getServerHealthSnapshot()).toEqual({ reachable: true, reconnects: 2 });

    unsubscribe();
  });

  it("notifies subscribers only when the value actually changes", async () => {
    const { subscribeServerHealth, HEALTH_CHECK_INTERVAL_MS } = await loadModule();
    const listener = vi.fn();
    const unsubscribe = subscribeServerHealth(listener);

    await flush();
    expect(listener).toHaveBeenCalledTimes(1); // null -> reachable

    // Three more successful polls: same value, so no re-render churn.
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_INTERVAL_MS * 3);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
