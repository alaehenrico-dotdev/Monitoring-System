import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

// pushChanges composes saveOnlineEntry/saveOfflineEntry/saveManualCount into
// its own per-item transaction (passing `tx` through) rather than letting
// each open its own - mocked out entirely here, same as the existing
// dailyOnlineStock/dailyOfflineStock/manualCounts service tests mock their
// own repository layer.
vi.mock("./dailyOnlineStock.service", () => ({ saveOnlineEntry: vi.fn() }));
vi.mock("./dailyOfflineStock.service", () => ({ saveOfflineEntry: vi.fn() }));
vi.mock("./manualCounts.service", () => ({ saveManualCount: vi.fn() }));
vi.mock("../repositories/dailyOnlineStockRepository", () => ({
  dailyOnlineStockRepository: { findByProductAndDate: vi.fn() },
}));
vi.mock("../repositories/dailyOfflineStockRepository", () => ({
  dailyOfflineStockRepository: { findByProductAndDate: vi.fn() },
}));
vi.mock("../repositories/manualCountRepository", () => ({
  manualCountRepository: { findOne: vi.fn() },
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: { findActiveById: vi.fn() },
}));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));

// In-memory stand-ins for the two tables pushChanges reads/writes directly
// (not through a repository): the new idempotency table, and the daily
// tables it re-reads from on a replay (fetchAppliedRow). Keyed exactly like
// the real tables - `syncPushApplication` by localId, `dailyOnlineStock`/
// `dailyOfflineStock`/`manualCount` by id - so a row saveOnlineEntry's mock
// "creates" can be read back the same way a real retry would re-read it.
const pushApplications = vi.hoisted(() => new Map<string, { tableName: string; serverId: number }>());
const onlineRowsById = vi.hoisted(() => new Map<number, Record<string, unknown>>());
const offlineRowsById = vi.hoisted(() => new Map<number, Record<string, unknown>>());
const manualCountRowsById = vi.hoisted(() => new Map<number, Record<string, unknown>>());

vi.mock("../lib/prisma", () => {
  const runWithFakeTx = (cb: (tx: unknown) => unknown) =>
    cb({
      syncPushApplication: {
        findUnique: ({ where: { localId } }: { where: { localId: string } }) => {
          const row = pushApplications.get(localId);
          return Promise.resolve(row ? { localId, ...row } : null);
        },
        create: ({ data }: { data: { localId: string; tableName: string; serverId: number } }) => {
          pushApplications.set(data.localId, { tableName: data.tableName, serverId: data.serverId });
          return Promise.resolve(data);
        },
      },
      dailyOnlineStock: {
        findUniqueOrThrow: ({ where: { id } }: { where: { id: number } }) => Promise.resolve(onlineRowsById.get(id)),
      },
      dailyOfflineStock: {
        findUniqueOrThrow: ({ where: { id } }: { where: { id: number } }) => Promise.resolve(offlineRowsById.get(id)),
      },
      manualCount: {
        findUniqueOrThrow: ({ where: { id } }: { where: { id: number } }) => Promise.resolve(manualCountRowsById.get(id)),
      },
    });
  // pushChanges calls serializableTransaction, not prisma.$transaction
  // directly (see lib/prisma.ts) - both run the same fake tx here since the
  // retry-on-conflict behavior that distinguishes them needs a real DB to
  // exercise, not something this unit test's mocked repositories simulate.
  return { prisma: { $transaction: runWithFakeTx }, serializableTransaction: runWithFakeTx };
});

import { dailyOnlineStockRepository } from "../repositories/dailyOnlineStockRepository";
import { manualCountRepository } from "../repositories/manualCountRepository";
import { productRepository } from "../repositories/productRepository";
import { saveOnlineEntry } from "./dailyOnlineStock.service";
import { saveManualCount } from "./manualCounts.service";
import { pushChanges, type PushItem } from "./sync.service";

const PRODUCT_ID = 1;

const ENTRY_DATE = new Date("2026-06-15T00:00:00.000Z");
const UPDATED_AT = new Date("2026-06-15T12:00:00.000Z");

// serializeOnline/serializeManualCount (sync.service.ts) read every one of
// these fields - a fake row missing any of them throws inside the
// serializer itself (toNum/toISOString on undefined), not a useful
// assertion failure, so each test builds on top of a complete base row
// rather than a bare `{ id, ...}` partial.
function makeOnlineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    productId: PRODUCT_ID,
    entryDate: ENTRY_DATE,
    shift: "NIGHT",
    openingStock: 0,
    stockInOffToOl: 0,
    stockOutOlToOff: 0,
    onlineStock: 0,
    productionIn: 0,
    fulfillmentOut: 0,
    rts: 0,
    remainingStock: 0,
    encodedById: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function makeManualCountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    productId: PRODUCT_ID,
    entryDate: ENTRY_DATE,
    shift: "NIGHT",
    location: "ONLINE",
    systemRemainingStock: 0,
    manualCount: 0,
    variance: 0,
    countedById: null,
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function onlineItem(overrides: Partial<PushItem> = {}): PushItem {
  return {
    tableName: "daily_online_stock",
    localId: "local-1",
    productId: PRODUCT_ID,
    entryDate: "2026-06-15",
    shift: "NIGHT",
    baselineUpdatedAt: null,
    delta: { fulfillmentOut: 5 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pushApplications.clear();
  onlineRowsById.clear();
  offlineRowsById.clear();
  manualCountRowsById.clear();
  vi.mocked(dailyOnlineStockRepository.findByProductAndDate).mockResolvedValue({ fulfillmentOut: 0 } as never);
  vi.mocked(productRepository.findActiveById).mockResolvedValue({ id: PRODUCT_ID, name: "Sweet A" } as never);
});

describe("pushChanges - applying a delta", () => {
  it("sums the delta onto the server's current value and reports it applied", async () => {
    vi.mocked(saveOnlineEntry).mockImplementation((async (_p: number, _d: Date, _s: string, input: Record<string, number>) => {
      const row = makeOnlineRow({ fulfillmentOut: input.fulfillmentOut });
      onlineRowsById.set(7, row);
      return row;
    }) as never);

    const result = await pushChanges([onlineItem()]);

    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toEqual([
      { localId: "local-1", serverId: 7, row: expect.objectContaining({ serverId: 7, fulfillmentOut: 5 }) },
    ]);
    expect(saveOnlineEntry).toHaveBeenCalledTimes(1);
  });
});

describe("pushChanges - idempotent retry (the double-apply bug this guards against)", () => {
  it("does NOT re-apply the delta when the same localId is pushed again", async () => {
    vi.mocked(saveOnlineEntry).mockImplementation((async (_p: number, _d: Date, _s: string, input: Record<string, number>) => {
      const row = makeOnlineRow({ fulfillmentOut: input.fulfillmentOut });
      onlineRowsById.set(7, row);
      return row;
    }) as never);

    // First attempt: the server applies it, but (in the real bug) the
    // client never sees this response - a timeout or dropped connection -
    // and retries with the SAME localId.
    const first = await pushChanges([onlineItem()]);
    expect(first.applied[0].row).toEqual(expect.objectContaining({ serverId: 7, fulfillmentOut: 5 }));

    const second = await pushChanges([onlineItem()]);

    // saveOnlineEntry (and therefore the +5 delta) must only have run once -
    // a second call here is exactly the silent stock inflation this fix
    // closes.
    expect(saveOnlineEntry).toHaveBeenCalledTimes(1);
    expect(second.conflicts).toHaveLength(0);
    expect(second.applied).toEqual([
      { localId: "local-1", serverId: 7, row: expect.objectContaining({ serverId: 7, fulfillmentOut: 5 }) },
    ]);
  });

  it("two different localIds for the same row both apply (not a false-positive dedup)", async () => {
    vi.mocked(saveOnlineEntry).mockImplementation((async (_p: number, _d: Date, _s: string, input: Record<string, number>) => {
      const row = makeOnlineRow({ fulfillmentOut: input.fulfillmentOut });
      onlineRowsById.set(7, row);
      return row;
    }) as never);

    await pushChanges([onlineItem({ localId: "local-1" })]);
    await pushChanges([onlineItem({ localId: "local-2" })]);

    expect(saveOnlineEntry).toHaveBeenCalledTimes(2);
  });
});

describe("pushChanges - manual count conflict detection still works", () => {
  it("reports a conflict instead of overwriting when the server changed since the client's baseline", async () => {
    vi.mocked(manualCountRepository.findOne).mockResolvedValue(makeManualCountRow({ manualCount: 50 }) as never);

    const item: PushItem = {
      tableName: "manual_counts",
      localId: "local-mc",
      productId: PRODUCT_ID,
      entryDate: "2026-06-15",
      shift: "NIGHT",
      location: "ONLINE",
      baselineUpdatedAt: "2026-06-15T10:00:00.000Z", // stale - server moved since
      manualCount: 40,
    };

    const result = await pushChanges([item]);

    expect(result.applied).toHaveLength(0);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ localId: "local-mc", reason: expect.stringContaining("changed on the server") }),
    ]);
    expect(saveManualCount).not.toHaveBeenCalled();
  });
});

describe("pushChanges - a rejected save becomes a conflict, not a thrown error", () => {
  it("converts the negative-stock guard's HttpError into a conflict entry", async () => {
    vi.mocked(saveOnlineEntry).mockRejectedValue(HttpError.badRequest("would end at -5"));

    const result = await pushChanges([onlineItem()]);

    expect(result.applied).toHaveLength(0);
    expect(result.conflicts).toEqual([expect.objectContaining({ localId: "local-1", reason: "would end at -5" })]);
  });
});
