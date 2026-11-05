import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeNotices, type AppNotice } from "./utils/notify";
import { watchForNewVersion } from "./pwa";

function fakeContainer(controller: object | null) {
  const target = new EventTarget();
  return Object.assign(target, { controller }) as unknown as ServiceWorkerContainer & EventTarget;
}

describe("watchForNewVersion", () => {
  let notices: AppNotice[] = [];
  let stop = () => {};
  beforeEach(() => {
    vi.useFakeTimers();
    notices = [];
    stop = subscribeNotices((n) => notices.push(n));
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("announces a new version once, with a Refresh button that stays until closed", () => {
    const c = fakeContainer({});
    const off = watchForNewVersion(c, { update: () => Promise.resolve() as never });
    c.dispatchEvent(new Event("controllerchange"));
    c.dispatchEvent(new Event("controllerchange"));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ level: "info", persistent: true, action: { label: "Refresh" } });
    off();
  });

  it("stays quiet on a first visit, when the worker merely takes control of a page that had none", () => {
    const c = fakeContainer(null);
    const off = watchForNewVersion(c, { update: () => Promise.resolve() as never });
    c.dispatchEvent(new Event("controllerchange"));
    expect(notices).toEqual([]);
    off();
  });

  it("asks for an update on a timer, and survives that failing", async () => {
    const update = vi.fn().mockRejectedValue(new Error("offline"));
    const off = watchForNewVersion(fakeContainer({}), { update });
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 10);
    expect(update).toHaveBeenCalledTimes(1);
    off();
  });

  it("stops everything when torn down", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const off = watchForNewVersion(fakeContainer({}), { update });
    off();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(update).not.toHaveBeenCalled();
  });
});
