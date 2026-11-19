import { prisma } from "../lib/prisma";
import { toDateOnlyString } from "../utils/date";
import {
  calculateOfflineRemaining,
  calculateOfflineStock,
  calculateOnlineRemaining,
  calculateOnlineStock,
  toNum,
} from "../utils/stockMath";

export interface StockDrift {
  location: "ONLINE" | "OFFLINE" | "TRANSFER";
  productId: number;
  name: string;
  date: string;
  shift: string;
  /// What is wrong, in one line.
  problem: string;
}

const TOLERANCE = 0.01;
const differs = (a: number, b: number) => Math.abs(a - b) > TOLERANCE;
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/// Recomputes every stored, derived figure of the last `days` days from its own inputs and
/// reports the rows that disagree: Online/Offline stock and Remaining Stock, the Offline
/// delivery total, and the Online <-> Offline transfer pair (one side's Out must equal the
/// other's In). A clean system returns an empty list; anything else is a calculation or
/// partial-save bug worth knowing about before anyone relies on the number.
export async function findStockDrift(today: Date, days = 7, limit = 200): Promise<StockDrift[]> {
  const from = addDays(today, -days);
  const [online, offline] = await Promise.all([
    prisma.dailyOnlineStock.findMany({ where: { entryDate: { gte: from, lte: today } }, include: { product: { select: { name: true } } } }),
    prisma.dailyOfflineStock.findMany({ where: { entryDate: { gte: from, lte: today } }, include: { product: { select: { name: true } } } }),
  ]);

  const out: StockDrift[] = [];
  const push = (location: StockDrift["location"], r: { productId: number; entryDate: Date; shift: string; product: { name: string } }, problem: string) =>
    out.push({ location, productId: r.productId, name: r.product.name, date: toDateOnlyString(r.entryDate), shift: r.shift, problem });

  for (const r of online) {
    const sub = calculateOnlineStock(toNum(r.openingStock), toNum(r.stockInOffToOl), toNum(r.stockOutOlToOff));
    const rem = calculateOnlineRemaining(sub, toNum(r.productionIn), toNum(r.fulfillmentOut), toNum(r.rts));
    if (differs(sub, toNum(r.onlineStock))) push("ONLINE", r, `Online stock is ${toNum(r.onlineStock)}, inputs add up to ${sub}`);
    if (differs(rem, toNum(r.remainingStock))) push("ONLINE", r, `Remaining is ${toNum(r.remainingStock)}, inputs add up to ${rem}`);
  }

  for (const r of offline) {
    const deliveries = toNum(r.delivery1) + toNum(r.delivery2) + toNum(r.delivery3) + toNum(r.delivery4) + toNum(r.delivery5);
    // deliveryOut is the sum of the five slots only while the slots are in use (older rows may
    // hold a lone total), so a total at or above the slot sum is fine; below it is not.
    if (deliveries > 0 && differs(deliveries, toNum(r.deliveryOut)) && toNum(r.deliveryOut) < deliveries) {
      push("OFFLINE", r, `Delivery total is ${toNum(r.deliveryOut)}, the slots add up to ${deliveries}`);
    }
    const sub = calculateOfflineStock(toNum(r.openingStock), toNum(r.stockInOlToOff), toNum(r.stockOutOffToOl));
    const rem = calculateOfflineRemaining(sub, toNum(r.productionIn), toNum(r.deliveryOut), toNum(r.backloads), toNum(r.upsellOut));
    if (differs(sub, toNum(r.offlineStock))) push("OFFLINE", r, `Offline stock is ${toNum(r.offlineStock)}, inputs add up to ${sub}`);
    if (differs(rem, toNum(r.remainingStock))) push("OFFLINE", r, `Remaining is ${toNum(r.remainingStock)}, inputs add up to ${rem}`);
  }

  // The transfer pair: Online's "Out to Offline" is Offline's "In from Online", and the reverse.
  const offlineByKey = new Map(offline.map((r) => [`${r.productId}|${toDateOnlyString(r.entryDate)}|${r.shift}`, r]));
  for (const r of online) {
    const mate = offlineByKey.get(`${r.productId}|${toDateOnlyString(r.entryDate)}|${r.shift}`);
    if (!mate) continue;
    if (differs(toNum(r.stockOutOlToOff), toNum(mate.stockInOlToOff))) {
      push("TRANSFER", r, `Online sent ${toNum(r.stockOutOlToOff)} to Offline, Offline received ${toNum(mate.stockInOlToOff)}`);
    }
    if (differs(toNum(r.stockInOffToOl), toNum(mate.stockOutOffToOl))) {
      push("TRANSFER", r, `Offline sent ${toNum(mate.stockOutOffToOl)} to Online, Online received ${toNum(r.stockInOffToOl)}`);
    }
  }

  return out.slice(0, limit);
}
