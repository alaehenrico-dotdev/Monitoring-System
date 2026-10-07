import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnlineStockCache, OnlineStockPending } from "./types";

/**
 * runPush drains the pending queue in batches, because sync.controller.ts
 * rejects a push body of more than 500 items outright - a device that had
 * built up more than that could previously never sync at all.
 *
 * What these pin down is the part that risks data: a batch is only cleared
 * locally once the server has confirmed it, so a failure part way through
 * leaves everything not yet confirmed still pending, and nothing is pushed
 * twice or dropped.
 */

vi.mock("../../api/http", () => ({ coreRequest: vi.fn() }));

/// In-memory stand-in for the pending/cache tables runPush reads and clears.
const pendingOnline = new Map<string, OnlineStockPending>();
const cacheOnline = new Map<string, OnlineStockCache>();
const conflictsRecorded: { localId?: string; reason: string }[] = [];

vi.mock("./localDb", () => ({
  listPendingOnline: vi.fn(async () => [...pendingOnline.values()]),
  listPendingOffline: vi.fn(async () => []),
  listPendingManualCounts: vi.fn(async () => []),
  getOnlineStockCacheByLocalId: vi.fn(async (localId: string) => cacheOnline.get(localId) ?? null),
  getOfflineStockCacheByLocalId: vi.fn(async () => null),
  getManualCountCacheByLocalId: vi.fn(async () => null),
  clearPendingOnline: vi.fn(async (localId: string) => {
    pendingOnline.delete(localId);
  }),
  clearPendingOffline: vi.fn(async () => {}),
  clearPendingManualCount: vi.fn(async () => {}),
  upsertOnlineStockFromServer: vi.fn(async () => {}),
  upsertOfflineStockFromServer: vi.fn(async () => {}),
  upsertManualCountFromServer: vi.fn(async () => {}),
  upsertProductsFromPull: vi.fn(async () => {}),
  recordConflict: vi.fn(async (c: { reason: string }) => {
    conflictsRecorded.push(c);
  }),
  getLastSyncedAt: vi.fn(async () => null),
  setLastSyncedAt: vi.fn(async () => {}),
}));

import { coreRequest } from "../../api/http";
import { runPush, SYNC_PUSH_BATCH_SIZE } from "./engine";

/// Stages `count` pending online edits, each with a non-zero delta so none
/// is discarded as a net-zero no-op.
function stagePending(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const localId = `local-${i}`;
    ids.push(localId);
    pendingOnline.set(localId, {
      localId,
      productionIn: i + 1,
      fulfillmentOut: 0,
      rts: 0,
      baselineUpdatedAt: null,
      stagedAt: "2026-01-01T00:00:00.000Z",
    });
    cacheOnline.set(localId, {
      localId,
      serverId: null,
      productId: i + 1,
      entryDate: "2026-01-01",
      shift: "MORNING",
      openingStock: 0,
      stockInOffToOl: 0,
      stockOutOlToOff: 0,
      onlineStock: 0,
      productionIn: 0,
      fulfillmentOut: 0,
      rts: 0,
      remainingStock: 0,
      encodedById: null,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  return ids;
}

interface PushBody {
  items: { localId: string }[];
}

function sentItems(call: unknown[]): { localId: string }[] {
  const init = call[1] as { body: string };
  return (JSON.parse(init.body) as PushBody).items;
}

/// Server double: accepts everything it is sent.
function acceptAll() {
  return vi.mocked(coreRequest).mockImplementation((async (_path: string, init: { body: string }) => ({
    applied: (JSON.parse(init.body) as PushBody).items.map((i) => ({ localId: i.localId, serverId: 1, row: {} })),
    conflicts: [],
  })) as never);
}

beforeEach(() => {
  pendingOnline.clear();
  cacheOnline.clear();
  conflictsRecorded.length = 0;
  vi.mocked(coreRequest).mockReset();
});

describe("runPush - batching a large backlog", () => {
  it("pushes 1,200 pending edits as several batches and clears all of them", async () => {
    stagePending(1200);
    acceptAll();

    const result = await runPush();

    const calls = vi.mocked(coreRequest).mock.calls;
    expect(calls).toHaveLength(Math.ceil(1200 / SYNC_PUSH_BATCH_SIZE));
    // Every batch stays under the server's 500-item cap.
    for (const call of calls) expect(sentItems(call).length).toBeLessThanOrEqual(500);
    // Each edit is sent exactly once, and the whole queue drains.
    const allSent = calls.flatMap((c) => sentItems(c).map((i) => i.localId));
    expect(new Set(allSent).size).toBe(1200);
    expect(result).toEqual({ applied: 1200, conflicts: 0 });
    expect(pendingOnline.size).toBe(0);
  });

  it("never exceeds the server cap even though the queue does", async () => {
    stagePending(501);
    acceptAll();

    await runPush();

    for (const call of vi.mocked(coreRequest).mock.calls) {
      expect(sentItems(call).length).toBeLessThanOrEqual(SYNC_PUSH_BATCH_SIZE);
    }
  });
});

describe("runPush - a failure part way through", () => {
  it("leaves the failed batch and everything after it pending, then recovers next sync", async () => {
    stagePending(1200);

    // First two batches land; the third drops the connection.
    let call = 0;
    vi.mocked(coreRequest).mockImplementation((async (_path: string, init: { body: string }) => {
      call += 1;
      if (call === 3) throw new TypeError("Failed to fetch");
      return {
        applied: (JSON.parse(init.body) as PushBody).items.map((i) => ({ localId: i.localId, serverId: 1, row: {} })),
        conflicts: [],
      };
    }) as never);

    await expect(runPush()).rejects.toThrow("Failed to fetch");

    // The two confirmed batches are gone; nothing else was cleared.
    const confirmed = 2 * SYNC_PUSH_BATCH_SIZE;
    expect(pendingOnline.size).toBe(1200 - confirmed);

    // Next sync: the rest goes, and nothing is pushed twice.
    const firstRunSent = vi.mocked(coreRequest).mock.calls.flatMap((c) => sentItems(c).map((i) => i.localId));
    vi.mocked(coreRequest).mockReset();
    acceptAll();

    const result = await runPush();

    expect(result.applied).toBe(1200 - confirmed);
    expect(pendingOnline.size).toBe(0);
    const secondRunSent = vi.mocked(coreRequest).mock.calls.flatMap((c) => sentItems(c).map((i) => i.localId));
    // The batch that failed is retried; the ones already confirmed are not.
    const confirmedIds = firstRunSent.slice(0, confirmed);
    expect(secondRunSent.filter((id) => confirmedIds.includes(id))).toEqual([]);
    // Across both runs every edit was applied exactly once.
    expect(new Set([...confirmedIds, ...secondRunSent]).size).toBe(1200);
  });
});

describe("runPush - conflicts across batches", () => {
  it("records a conflict in one batch without holding up the others", async () => {
    stagePending(1200);

    // One item in the second batch comes back as a conflict.
    const conflicted = `local-${SYNC_PUSH_BATCH_SIZE + 5}`;
    vi.mocked(coreRequest).mockImplementation((async (_path: string, init: { body: string }) => {
      const items = (JSON.parse(init.body) as PushBody).items;
      return {
        applied: items.filter((i) => i.localId !== conflicted).map((i) => ({ localId: i.localId, serverId: 1, row: {} })),
        conflicts: items
          .filter((i) => i.localId === conflicted)
          .map((i) => ({ localId: i.localId, reason: "Manual count changed on the server", mine: 1, server: 2 })),
      };
    }) as never);

    const result = await runPush();

    expect(vi.mocked(coreRequest).mock.calls).toHaveLength(Math.ceil(1200 / SYNC_PUSH_BATCH_SIZE));
    expect(result).toEqual({ applied: 1199, conflicts: 1 });
    expect(conflictsRecorded).toHaveLength(1);
    expect(conflictsRecorded[0].reason).toBe("Manual count changed on the server");
    // A conflict is a final answer, so its pending row clears too - the whole
    // queue drains rather than the conflicted item blocking later batches.
    expect(pendingOnline.size).toBe(0);
  });
});
