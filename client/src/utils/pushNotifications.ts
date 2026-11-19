import { getPushKey, removePushSubscription, savePushSubscription } from "../api/alerts";

/// Notifications on this device come in two kinds:
///  - "push": the server sends them, so they arrive even when the app is closed (phone, installed
///    app). Needs the service worker, a push service and VAPID keys on the server.
///  - "local": the open app shows them itself when a new problem appears. Works anywhere the
///    browser allows notifications, but only while the app is open (a desktop left open).
export type NotifyMode = "unsupported" | "blocked" | "off" | "local" | "push";

const MODE_KEY = "ae:notify-mode";

const canNotify = () => typeof window !== "undefined" && "Notification" in window;
const canPush = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof window !== "undefined" && "PushManager" in window;

function remembered(): "local" | "push" | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === "local" || v === "push" ? v : null;
  } catch {
    return null;
  }
}
function remember(mode: "local" | "push" | null) {
  try {
    if (mode) localStorage.setItem(MODE_KEY, mode);
    else localStorage.removeItem(MODE_KEY);
  } catch {
    /* the choice just lasts until the page is reloaded */
  }
}

export function currentMode(): NotifyMode {
  if (!canNotify()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  return remembered() ?? "off";
}

const toKey = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/// Asks permission, then prefers real push; if the server has no keys or this browser cannot push,
/// falls back to notifications shown by the open app.
export async function enableNotifications(): Promise<NotifyMode> {
  if (!canNotify()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return currentMode();

  if (canPush()) {
    try {
      const { publicKey } = await getPushKey();
      if (publicKey) {
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(publicKey) }));
        await savePushSubscription(sub.toJSON());
        remember("push");
        return "push";
      }
    } catch {
      /* no service worker in dev, a blocked push service, ...: use the open-app kind */
    }
  }
  remember("local");
  return "local";
}

export async function disableNotifications(): Promise<NotifyMode> {
  try {
    if (canPush()) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
    }
  } catch {
    /* nothing to undo */
  }
  remember(null);
  return currentMode();
}

/// Shows one notification from the open app (the "local" kind).
export async function showLocalNotification(title: string, body: string, url: string): Promise<void> {
  if (!canNotify() || Notification.permission !== "granted") return;
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification(title, { body, data: { url }, icon: "/icon-512.png", tag: "ae-alert" });
      return;
    }
  } catch {
    /* fall through to the plain constructor */
  }
  try {
    new Notification(title, { body, icon: "/icon-512.png", tag: "ae-alert" });
  } catch {
    /* some mobile browsers only allow the service-worker form */
  }
}
