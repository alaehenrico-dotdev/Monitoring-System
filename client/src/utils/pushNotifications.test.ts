import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ savePushSubscription: vi.fn(), removePushSubscription: vi.fn(), getPushKey: vi.fn() }));
vi.mock("../api/alerts", () => api);

import { clearNotificationsOnSignOut, resyncNotifications } from "./pushNotifications";

const unsubscribe = vi.fn();
const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "k", auth: "a" } }), unsubscribe };

function installPush(sub: typeof subscription | null) {
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(sub) } }) },
  });
  Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });
  Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted" } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  unsubscribe.mockResolvedValue(true);
  api.savePushSubscription.mockResolvedValue({ success: true });
});
afterEach(() => localStorage.clear());

describe("clearNotificationsOnSignOut", () => {
  it("cancels this browser's push subscription and forgets the choice, so the next person starts off", async () => {
    installPush(subscription);
    localStorage.setItem("ae:notify-mode", "push");
    await clearNotificationsOnSignOut();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("ae:notify-mode")).toBeNull();
  });

  it("still forgets the choice when there is no subscription or the browser cannot push", async () => {
    installPush(null);
    localStorage.setItem("ae:notify-mode", "local");
    await expect(clearNotificationsOnSignOut()).resolves.toBeUndefined();
    expect(localStorage.getItem("ae:notify-mode")).toBeNull();
  });
});

describe("resyncNotifications", () => {
  it("re-registers a device that has notifications on, so one the server dropped comes back", async () => {
    installPush(subscription);
    localStorage.setItem("ae:notify-mode", "push");
    await resyncNotifications();
    expect(api.savePushSubscription).toHaveBeenCalledWith(subscription.toJSON());
  });

  it("does nothing for a device that never turned notifications on, or only uses them while open", async () => {
    installPush(subscription);
    await resyncNotifications();
    localStorage.setItem("ae:notify-mode", "local");
    await resyncNotifications();
    expect(api.savePushSubscription).not.toHaveBeenCalled();
  });

  it("stays quiet when the server refuses", async () => {
    installPush(subscription);
    localStorage.setItem("ae:notify-mode", "push");
    api.savePushSubscription.mockRejectedValue(new Error("409"));
    await expect(resyncNotifications()).resolves.toBeUndefined();
  });
});
