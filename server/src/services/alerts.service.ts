import { timingSafeEqual } from "node:crypto";
import webpush from "web-push";
import { env } from "../config/env";
import { getOrSet } from "../lib/cache";
import { prisma } from "../lib/prisma";
import { toDateOnlyString } from "../utils/date";
import { HttpError } from "../utils/HttpError";
import { isAllowedPushEndpoint } from "../utils/pushEndpoint";
import { getActionQueue, localToday, type QueueItem } from "./actionQueue.service";
import { findStockDrift } from "./reconcile.service";

/// Everything an admin should look at: the Admin Queue plus stock figures that do not add up.
export interface AlertItem extends Omit<QueueItem, "kind"> {
  kind: QueueItem["kind"] | "drift";
}

const CHECK_EVERY_MS = 15 * 60 * 1000;
const DRIFT_TTL_MS = 60_000;
const TITLES_IN_PUSH = 3;
/// One push service that never answers must not hold a pass (and the bookkeeping after it) hostage.
const SEND_TIMEOUT_MS = 10_000;
/// How many sends are in flight at once, however many devices are registered.
const SEND_CONCURRENCY = 5;
/// Devices one person may register (a phone, a laptop, a desktop or two, a tablet).
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

const pushConfigured = () => Boolean(env.vapidPublicKey && env.vapidPrivateKey);

/// Drift is two table scans over a week of rows, so it is shared between the bell's pollers.
const recentDrift = (today: Date) => getOrSet(`alerts:drift:${toDateOnlyString(today)}`, DRIFT_TTL_MS, () => findStockDrift(today, 7));

/// Every admin's bell polls this, and the push check reads it too, so one answer is shared for a few seconds
/// instead of each caller rebuilding the whole queue.
const ALERTS_TTL_MS = 20_000;
export const getAlerts = (now = new Date()) => getOrSet("alerts:all", ALERTS_TTL_MS, () => computeAlerts(now));

async function computeAlerts(now: Date) {
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
const isUrgent = (i: AlertItem) => i.severity === "high";

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

const sameSecret = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function savePushSubscription(userId: number, sub: PushSub): Promise<void> {
  if (!pushConfigured()) throw HttpError.badRequest("Push notifications are not set up on this server.");
  const existing = await prisma.pushSubscription.findUnique({ where: { endpoint: sub.endpoint } });
  if (existing) {
    // The same browser signing in as someone else becomes that person's device, but only when it presents the
    // keys it registered with. Knowing an endpoint URL alone is not enough to take another person's device over.
    if (existing.userId !== userId && !(sameSecret(existing.p256dh, sub.keys.p256dh) && sameSecret(existing.auth, sub.keys.auth))) {
      throw HttpError.conflict("That device is already registered to another account.");
    }
    await prisma.pushSubscription.update({ where: { id: existing.id }, data: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return;
  }
  if ((await prisma.pushSubscription.count({ where: { userId } })) >= MAX_SUBSCRIPTIONS_PER_USER) {
    throw HttpError.badRequest(`You can register up to ${MAX_SUBSCRIPTIONS_PER_USER} devices. Turn notifications off on one you no longer use first.`);
  }
  try {
    await prisma.pushSubscription.create({ data: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
  } catch (err) {
    // The same device registered twice at once: the other request won, which is what was asked for.
    if ((err as { code?: string }).code !== "P2002") throw err;
  }
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

/// Runs `work` over `items` with at most `limit` in flight; every item runs even when others fail (work must not throw).
async function inPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

/// Sends one notification to every device of an active admin. A device whose address is not a known push service
/// (a row from before that check existed) is dropped unsent; one the push service says is gone (404/410) is
/// dropped after the pass; any other failure, including a send that takes longer than SEND_TIMEOUT_MS, is logged.
async function pushToAdmins(fresh: AlertItem[]): Promise<void> {
  const subs = await prisma.pushSubscription.findMany({ where: { user: { isActive: true, role: "SUPERVISOR_ADMIN" } } });
  if (!subs.length) return;
  const invalid = subs.filter((s) => !isAllowedPushEndpoint(s.endpoint));
  const targets = subs.filter((s) => !invalid.includes(s));
  const gone: number[] = invalid.map((s) => s.id);
  if (targets.length) {
    ensureVapid();
    const payload = JSON.stringify(buildPushMessage(fresh));
    await inPool(targets, SEND_CONCURRENCY, async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, timeout: SEND_TIMEOUT_MS });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // 404/410: the device unsubscribed or the app was removed; it will never work again.
        if (status === 404 || status === 410) gone.push(s.id);
        else console.error(JSON.stringify({ level: "error", event: "push-failed", status: status ?? null }));
      }
    });
  }
  if (gone.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: gone } } });
}

/// One pass: push the urgent problems that appeared since the last pass to every admin device that
/// turned notifications on. A problem is announced once; it can be announced again after it clears.
/// The "already announced" record is always written, whatever happened while sending, so a failing device can
/// never make the next pass announce the same problems again.
export async function runAlertCheck(now = new Date()): Promise<void> {
  if (!pushConfigured()) return;
  const { items } = await getAlerts(now);
  const currentIds = items.filter(isUrgent).map((i) => i.id);
  const seen = new Set((await prisma.alertSeen.findMany({ select: { id: true } })).map((r) => r.id));
  const fresh = newUrgent(items, seen);

  try {
    if (fresh.length) await pushToAdmins(fresh);
  } catch (err) {
    console.error(JSON.stringify({ level: "error", event: "push-pass-failed", message: err instanceof Error ? err.message : String(err) }));
  }

  // Remember what is open now; forget what cleared so a recurrence notifies again.
  await prisma.alertSeen.deleteMany({ where: { id: { notIn: currentIds.length ? currentIds : ["-"] } } });
  if (fresh.length) await prisma.alertSeen.createMany({ data: fresh.map((i) => ({ id: i.id.slice(0, 120) })), skipDuplicates: true });
}

export function startAlerts(): () => void {
  if (!pushConfigured()) return () => {};
  // A pass still running when the next one is due is left to finish; passes never overlap.
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runAlertCheck()
      .catch((err) =>
        console.error(JSON.stringify({ level: "error", event: "alerts-failed", message: err instanceof Error ? err.message : String(err) })),
      )
      .finally(() => {
        running = false;
      });
  };
  const first = setTimeout(tick, 2 * 60 * 1000);
  const every = setInterval(tick, CHECK_EVERY_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
