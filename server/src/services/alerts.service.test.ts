import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    pushSubscription: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), count: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
    alertSeen: { findMany: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  },
  send: vi.fn(),
  getActionQueue: vi.fn(),
}));

vi.mock("../lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("../config/env", () => ({ env: { vapidPublicKey: "pub", vapidPrivateKey: "priv", vapidSubject: "mailto:a@b.c", pushExtraHosts: [] } }));
vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: mocks.send } }));
vi.mock("./actionQueue.service", () => ({ getActionQueue: mocks.getActionQueue, localToday: () => new Date("2026-11-19T00:00:00Z") }));
vi.mock("./reconcile.service", () => ({ findStockDrift: vi.fn().mockResolvedValue([]) }));

import { buildPushMessage, MAX_SUBSCRIPTIONS_PER_USER, newUrgent, removePushSubscription, runAlertCheck, savePushSubscription, startAlerts, type AlertItem } from "./alerts.service";
import { invalidate } from "../lib/cache";

const item = (id: string, severity: AlertItem["severity"], title = id, link = "/x"): AlertItem => ({ id, kind: "low-stock", severity, title, detail: "", link });
const sub = (id: number, endpoint = `https://fcm.googleapis.com/fcm/send/${id}`) => ({ id, userId: 1, endpoint, p256dh: "k", auth: "a" });
const queueWith = (...items: AlertItem[]) => mocks.getActionQueue.mockResolvedValue({ items });

beforeEach(() => {
  vi.clearAllMocks();
  invalidate("alerts:all");
  invalidate("alerts:drift:2026-11-19");
  mocks.prisma.alertSeen.findMany.mockResolvedValue([]);
  mocks.prisma.alertSeen.deleteMany.mockResolvedValue({ count: 0 });
  mocks.prisma.alertSeen.createMany.mockResolvedValue({ count: 0 });
  mocks.prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 0 });
  mocks.send.mockResolvedValue({});
});

describe("newUrgent", () => {
  it("returns only high-severity problems not announced before", () => {
    const items = [item("a", "high"), item("b", "high"), item("c", "medium")];
    expect(newUrgent(items, new Set(["a"])).map((i) => i.id)).toEqual(["b"]);
  });

  it("is empty when everything urgent was already announced", () => {
    expect(newUrgent([item("a", "high")], new Set(["a"]))).toEqual([]);
  });
});

describe("buildPushMessage", () => {
  it("links straight to the record when there is one problem", () => {
    const m = buildPushMessage([item("a", "high", "Sauce - negative (-2)", "/total-stocks")]);
    expect(m).toEqual({ title: "Needs attention", body: "Sauce - negative (-2)", url: "/total-stocks" });
  });

  it("summarises several and opens the Admin Queue", () => {
    const m = buildPushMessage(["a", "b", "c", "d", "e"].map((id) => item(id, "high")));
    expect(m.title).toBe("5 things need attention");
    expect(m.body).toBe("a; b; c +2 more");
    expect(m.url).toBe("/admin-queue");
  });
});

describe("savePushSubscription", () => {
  const device = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "key1", auth: "auth1" } };

  it("registers a new device", async () => {
    mocks.prisma.pushSubscription.findUnique.mockResolvedValue(null);
    mocks.prisma.pushSubscription.count.mockResolvedValue(0);
    await savePushSubscription(7, device);
    expect(mocks.prisma.pushSubscription.create).toHaveBeenCalledWith({ data: { userId: 7, endpoint: device.endpoint, p256dh: "key1", auth: "auth1" } });
  });

  it("refuses an eleventh device for one person", async () => {
    mocks.prisma.pushSubscription.findUnique.mockResolvedValue(null);
    mocks.prisma.pushSubscription.count.mockResolvedValue(MAX_SUBSCRIPTIONS_PER_USER);
    await expect(savePushSubscription(7, device)).rejects.toThrow(/up to 10 devices/);
    expect(mocks.prisma.pushSubscription.create).not.toHaveBeenCalled();
  });

  it("refreshes the keys of a device the same person registers again, even at the cap", async () => {
    mocks.prisma.pushSubscription.findUnique.mockResolvedValue({ id: 3, userId: 7, endpoint: device.endpoint, p256dh: "old", auth: "old" });
    await savePushSubscription(7, device);
    expect(mocks.prisma.pushSubscription.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { userId: 7, p256dh: "key1", auth: "auth1" } });
    expect(mocks.prisma.pushSubscription.count).not.toHaveBeenCalled();
  });

  it("will not hand another person's device over to someone who only knows its address", async () => {
    mocks.prisma.pushSubscription.findUnique.mockResolvedValue({ id: 3, userId: 5, endpoint: device.endpoint, p256dh: "secret-key", auth: "secret-auth" });
    await expect(savePushSubscription(7, device)).rejects.toThrow(/already registered to another account/);
    expect(mocks.prisma.pushSubscription.update).not.toHaveBeenCalled();
  });

  it("lets the same browser move to the person now signed in, because it holds the registered keys", async () => {
    mocks.prisma.pushSubscription.findUnique.mockResolvedValue({ id: 3, userId: 5, endpoint: device.endpoint, p256dh: "key1", auth: "auth1" });
    await savePushSubscription(7, device);
    expect(mocks.prisma.pushSubscription.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { userId: 7, p256dh: "key1", auth: "auth1" } });
  });

  it("treats a duplicate created at the same moment as done", async () => {
    mocks.prisma.pushSubscription.findUnique.mockResolvedValue(null);
    mocks.prisma.pushSubscription.count.mockResolvedValue(0);
    mocks.prisma.pushSubscription.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(savePushSubscription(7, device)).resolves.toBeUndefined();
  });

  it("removes only the caller's own row", async () => {
    await removePushSubscription(7, device.endpoint);
    expect(mocks.prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { endpoint: device.endpoint, userId: 7 } });
  });
});

describe("runAlertCheck", () => {
  it("gives every send a deadline", async () => {
    queueWith(item("a", "high"));
    mocks.prisma.pushSubscription.findMany.mockResolvedValue([sub(1)]);
    await runAlertCheck();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][2]).toMatchObject({ timeout: 10_000 });
  });

  it("never sends to an address that is not a known push service, and drops that row", async () => {
    queueWith(item("a", "high"));
    mocks.prisma.pushSubscription.findMany.mockResolvedValue([sub(1), sub(2, "https://127.0.0.1:8443/x"), sub(3, "http://fcm.googleapis.com/x")]);
    await runAlertCheck();
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls[0][0].endpoint).toBe("https://fcm.googleapis.com/fcm/send/1");
    expect(mocks.prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [2, 3] } } });
  });

  it("records what it announced even when a send fails or times out, so the next pass does not repeat it", async () => {
    queueWith(item("a", "high"), item("b", "high"));
    mocks.prisma.pushSubscription.findMany.mockResolvedValue([sub(1), sub(2)]);
    mocks.send.mockRejectedValueOnce(new Error("Request timed out")).mockResolvedValueOnce({});
    await runAlertCheck();
    expect(mocks.prisma.alertSeen.createMany).toHaveBeenCalledWith({ data: [{ id: "a" }, { id: "b" }], skipDuplicates: true });
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });

  it("still records the alerts when listing the devices itself fails", async () => {
    queueWith(item("a", "high"));
    mocks.prisma.pushSubscription.findMany.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runAlertCheck();
    expect(mocks.prisma.alertSeen.createMany).toHaveBeenCalled();
  });

  it("drops a device the push service reports gone, and keeps one that merely failed", async () => {
    queueWith(item("a", "high"));
    mocks.prisma.pushSubscription.findMany.mockResolvedValue([sub(1), sub(2), sub(3)]);
    mocks.send
      .mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }))
      .mockRejectedValueOnce(Object.assign(new Error("server error"), { statusCode: 500 }))
      .mockResolvedValueOnce({});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await runAlertCheck();
    expect(mocks.prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [1] } } });
  });

  it("never has more than a handful of sends in flight at once", async () => {
    queueWith(item("a", "high"));
    mocks.prisma.pushSubscription.findMany.mockResolvedValue(Array.from({ length: 23 }, (_, i) => sub(i + 1)));
    let inFlight = 0;
    let peak = 0;
    mocks.send.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    await runAlertCheck();
    expect(mocks.send).toHaveBeenCalledTimes(23);
    expect(peak).toBeLessThanOrEqual(5);
  });
});

describe("startAlerts", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not start a pass while the previous one is still running", async () => {
    mocks.getActionQueue.mockReturnValue(new Promise(() => {})); // a pass that never finishes
    const stop = startAlerts();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 3 * 15 * 60 * 1000);
    expect(mocks.getActionQueue).toHaveBeenCalledTimes(1);
    stop();
  });

  it("starts the next pass once the previous one has finished", async () => {
    queueWith();
    const stop = startAlerts();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 15 * 60 * 1000 + 1000);
    expect(mocks.getActionQueue.mock.calls.length).toBeGreaterThanOrEqual(2);
    stop();
  });
});
