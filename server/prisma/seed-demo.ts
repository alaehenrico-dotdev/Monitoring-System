/**
 * Demo / staging data: two weeks of believable Online and Offline entries for the first products
 * of the master list, so risky things (month close, finish day, reports, the alert bell) can be
 * tried on a copy without touching real stock.
 *
 *   ALLOW_DEMO_SEED=I_HAVE_A_DISPOSABLE_DATABASE npm run seed:demo --workspace server
 *   (a database on another machine also needs ALLOW_DEMO_SEED_REMOTE=I_AM_SURE)
 *
 * It refuses to run in production, and refuses a database that already has daily entries, so it
 * can never mix invented numbers into real ones. Run `npm run seed` first (products and accounts).
 * The figures are deterministic: the same run gives the same data every time.
 *
 * Every row is chained the way the app does it (a shift's opening is the previous shift's
 * remaining, transfers mirror between Online and Offline, the stored totals come from the same
 * formulas in utils/stockMath.ts), so the reconciliation check reports nothing on a fresh demo.
 * One product is left below zero on the newest sheet, so the bell and Admin Queue have something to show.
 */
import { PrismaClient, type Prisma, type Shift } from "@prisma/client";
import { calculateOfflineRemaining, calculateOfflineStock, calculateOnlineRemaining, calculateOnlineStock } from "../src/utils/stockMath";

const prisma = new PrismaClient();

const DAYS = 14;
const PRODUCT_COUNT = 20;
const SHIFTS: Shift[] = ["MORNING", "NIGHT"];
const LOCAL_UTC_OFFSET_HOURS = 8;

/// A small deterministic random generator (mulberry32), so the demo is the same on every run.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  if ((process.env.NODE_ENV ?? "") === "production") throw new Error("seed:demo never runs in production.");
  if (process.env.ALLOW_DEMO_SEED !== "I_HAVE_A_DISPOSABLE_DATABASE") {
    throw new Error("Set ALLOW_DEMO_SEED=I_HAVE_A_DISPOSABLE_DATABASE to confirm this database can be filled with invented stock.");
  }
  // The database must be one on this machine (or the compose "db"), unless the operator says otherwise: a production
  // database that happens to hold no daily entries yet must not be filled with invented stock by accident.
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname.replace(/^[|]$/g, "");
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "db"].includes(host) && process.env.ALLOW_DEMO_SEED_REMOTE !== "I_AM_SURE") {
    throw new Error(`DATABASE_URL points at "${host || "an unreadable host"}", not this machine. If that really is a disposable staging database, also set ALLOW_DEMO_SEED_REMOTE=I_AM_SURE.`);
  }
  const [online, offline] = await Promise.all([prisma.dailyOnlineStock.count(), prisma.dailyOfflineStock.count()]);
  if (online + offline > 0) throw new Error("This database already has daily entries; the demo data is only added to an empty one.");

  const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: PRODUCT_COUNT });
  if (!products.length) throw new Error("No products found. Run `npm run seed --workspace server` first.");

  const local = new Date(Date.now() + LOCAL_UTC_OFFSET_HOURS * 3_600_000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const slots: { date: Date; shift: Shift }[] = [];
  for (let d = DAYS; d >= 1; d--) for (const shift of SHIFTS) slots.push({ date: new Date(today - d * 86_400_000), shift });

  const onlineRows: Prisma.DailyOnlineStockCreateManyInput[] = [];
  const offlineRows: Prisma.DailyOfflineStockCreateManyInput[] = [];

  products.forEach((product, index) => {
    const rand = rng(1000 + product.id);
    const whole = (max: number) => Math.floor(rand() * (max + 1));
    let onOpen = 20 + whole(60);
    let offOpen = 80 + whole(220);

    slots.forEach((slot, s) => {
      const last = s === slots.length - 1;
      const productionIn = whole(3) === 0 ? 0 : 40 + whole(120);
      const offPool = offOpen + productionIn;
      const toOnline = Math.min(whole(25), Math.floor(offPool * 0.3)); // Offline -> Online
      const toOffline = Math.min(whole(15), Math.floor(onOpen * 0.3)); // Online -> Offline

      const onlineStock = calculateOnlineStock(onOpen, toOnline, toOffline);
      let fulfillmentOut = Math.min(whole(35), onlineStock);
      // The newest sheet of the first product is left below zero on purpose.
      if (last && index === 0) fulfillmentOut = onlineStock + 5;
      const rts = whole(2);
      const onRemaining = calculateOnlineRemaining(onlineStock, 0, fulfillmentOut, rts);

      const offlineStock = calculateOfflineStock(offOpen, toOffline, toOnline);
      const available = offlineStock + productionIn;
      const delivery1 = Math.min(whole(60), Math.floor(available * 0.5));
      const delivery2 = Math.min(whole(30), Math.floor((available - delivery1) * 0.4));
      const deliveryOut = delivery1 + delivery2;
      const backloads = whole(3);
      const upsellOut = Math.min(whole(4), Math.max(0, Math.floor(available - deliveryOut)));
      const offRemaining = calculateOfflineRemaining(offlineStock, productionIn, deliveryOut, backloads, upsellOut);

      const key = { productId: product.id, entryDate: slot.date, shift: slot.shift };
      onlineRows.push({
        ...key,
        openingStock: onOpen,
        stockInOffToOl: toOnline,
        stockOutOlToOff: toOffline,
        onlineStock,
        productionIn: 0,
        fulfillmentOut,
        rts,
        remainingStock: onRemaining,
      });
      offlineRows.push({
        ...key,
        openingStock: offOpen,
        stockInOlToOff: toOffline,
        stockOutOffToOl: toOnline,
        offlineStock,
        productionIn,
        deliveryOut,
        delivery1,
        delivery2,
        backloads,
        upsellOut,
        remainingStock: offRemaining,
      });
      onOpen = onRemaining;
      offOpen = offRemaining;
    });
  });

  await prisma.$transaction([prisma.dailyOnlineStock.createMany({ data: onlineRows }), prisma.dailyOfflineStock.createMany({ data: offlineRows })]);
  // eslint-disable-next-line no-console
  console.log(`Demo data added: ${products.length} products x ${slots.length} sheets (${DAYS} days, both shifts), Online and Offline. Today is left empty.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
