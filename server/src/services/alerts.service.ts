import webpush from "web-push";
import { env } from "../config/env";
import { getOrSet } from "../lib/cache";
import { prisma } from "../lib/prisma";
import { toDateOnlyString } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { getActionQueue, localToday, type QueueItem } from "./actionQueue.service";
import { findStockDrift } from "./reconcile.service";

/// Everything an admin should look at: the Admin Queue plus stock figures that do not add up.
export interface AlertItem extends Omit<QueueItem, "kind"> {
  kind: QueueItem["kind"] | "drift";
}

const CHECK_EVERY_MS = 15 * 60 * 1000;
const DRIFT_TTL_MS = 60_000;
const TITLES_IN_PUSH = 3;

export const pushConfigured = () => Boolean(env.vapidPublicKey && env.vapidPrivateKey);

/// Drift is two table scans over a week of rows, so it is shared between the bell's pollers.
const recentDrift = (today: Date) => getOrSet(`alerts:drift:${toDateOnlyString(today)}`, DRIFT_TTL_MS, () => findStockDrift(today, 7));

export async function getAlerts(now = new Date()) {
  const today = localToday(now);
  const [queue, drift] = await Promise.all([getActionQueue(now), recentDrift(today)]);
  const driftItems: AlertItem[] = drift.map((d) => ({
    id: `drift:${d.location}:${d.productId}:${d.date}:${d.shift}`,
    kind: "drift",
    severity: "high",
    title: `${d.name} does not add up - ${d.date} ${d.shift.toLowerCase()}`,
    detail: d.problem,
    link: d.location === "OFFLINE" ? `/offline?date=${d.date}&shift=${d.shift}` : `/online?date=${d.date}&shift=${d.shift}`,
  }));
  const items: AlertItem[] = [...queue.items, ...driftItems];
  return { generatedAt: now.toISOString(), total: items.length, urgent: items.filter(isUrgent).length, items };
}

/// What interrupts someone (a notification), as opposed to what just waits in the list.
export const isUrgent = (i: AlertItem) => i.severity === "high";

/// The text of one notification for newly appeared urgent problems.
export function buildPushMessage(fresh: AlertItem[]): { title: string; body: string; url: string } {
  const shown = fresh.slice(0, TITLES_IN_PUSH).map((i) => i.title);
  const more = fresh.length > TITLES_IN_PUSH ? ` +${fresh.length - TITLES_IN_PUSH} more` : "";
  return {
    title: fresh.length === 1 ? "Needs attention" : `${fresh.length} things need attention`,
    body: shown.join("; ") + more,
    url: fresh.length === 1 ? fresh[0].link : "/admin-queue",
  };
}

/// Which urgent problems have not been announced yet.
export function newUrgent(items: AlertItem[], seen: Set<string>): AlertItem[] {
  return items.filter((i) => isUrgent(i) && !seen.has(i.id));
}

/* ----------------------------------------------------------------- subscriptions */

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function pushPublicKey(): string | null {
  return pushConfigured() ? env.vapidPublicKey : null;
}

export async function savePushSubscription(userId: number, sub: PushSub): Promise<void> {
  if (!pushConfigured()) throw HttpError.badRequest("Push notifications are not set up on this server.");
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    // The same device signing in as someone else becomes that person's device.
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
}

export async function removePushSubscription(userId: number, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}

/* ----------------------------------------------------------------- the check */

let vapidSet = false;
function ensureVapid() {
  if (vapidSet) return;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  vapidSet = true;
}

/// One pass: push the urgent problems that appeared since the last pass to every admin device that
/// turned notifications on. A problem is announced once; it can be announced again after it clears.
export async function runAlertCheck(now = new Date()): Promise<void> {
  if (!pushConfigured()) return;
  const { items } = await getAlerts(now);
  const currentIds = items.filter(isUrgent).map((i) => i.id);
  const seen = new Set((await prisma.alertSeen.findMany({ select: { id: true } })).map((r) => r.id));
  const fresh = newUrgent(items, seen);

  if (fresh.length) {
    const subs = await prisma.pushSubscription.findMany({ where: { user: { isActive: true, role: "SUPERVISOR_ADMIN" } } });
    if (subs.length) {
      ensureVapid();
      const payload = JSON.stringify(buildPushMessage(fresh));
      const gone: number[] = [];
      await Promise.all(
        subs.map(async (s) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600 });
          } catch (err) {
            const status = (err as { statusCode?: number }).statusCode;
            // 404/410: the device unsubscribed or the app was removed; it will never work again.
            if (status === 404 || status === 410) gone.push(s.id);
            else console.error(JSON.stringify({ level: "error", event: "push-failed", status: status ?? null }));
          }
        }),
      );
      if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
    }
  }

  // Remember what is open now; forget what cleared so a recurrence notifies again.
  await prisma.alertSeen.deleteMany({ where: { id: { notIn: currentIds.length ? currentIds : ["-"] } } });
  if (fresh.length) await prisma.alertSeen.createMany({ data: fresh.map((i) => ({ id: i.id.slice(0, 120) })), skipDuplicates: true });
}

export function startAlerts(): () => void {
  if (!pushConfigured()) return () => {};
  const tick = () =>
    void runAlertCheck().catch((err) =>
      console.error(JSON.stringify({ level: "error", event: "alerts-failed", message: err instanceof Error ? err.message : String(err) })),
    );
  const first = setTimeout(tick, 2 * 60 * 1000);
  const every = setInterval(tick, CHECK_EVERY_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
