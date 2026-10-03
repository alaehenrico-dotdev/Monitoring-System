import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/importBatchRepository", () => ({
  importBatchRepository: { findById: vi.fn(), delete: vi.fn() },
}));
vi.mock("../repositories/changeLogRepository", () => ({
  changeLogRepository: { findByImportBatch: vi.fn(), findLatestForRecord: vi.fn() },
}));
vi.mock("./manualCounts.service", () => ({ deleteManualCount: vi.fn(), saveManualCount: vi.fn() }));

// revertImportBatch wraps its whole loop (every row's revert, plus deleting
// the batch row itself) in one prisma.$transaction - a bare passthrough fake
// is enough since every repository/service call inside is already mocked
// out regardless of which `db`/`tx` it's given.
vi.mock("../lib/prisma", () => ({
  prisma: { $transaction: (cb: (tx: unknown) => unknown) => cb({}) },
}));

import { importBatchRepository } from "../repositories/importBatchRepository";
import { changeLogRepository } from "../repositories/changeLogRepository";
import { deleteManualCount, saveManualCount } from "./manualCounts.service";
import { revertImportBatch } from "./importBatch.service";

const BATCH_ID = 1;

function makeLog(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    tableName: "manual_counts",
    recordId: 1,
    action: "CREATE",
    newValue: { id: 1, productId: 1, entryDate: "2026-06-15T00:00:00.000Z", shift: "NIGHT", location: "ONLINE", manualCount: 40 },
    oldValue: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(importBatchRepository.findById).mockResolvedValue({ id: BATCH_ID } as never);
});

describe("revertImportBatch - normal revert", () => {
  it("reverts every row still safe to revert and deletes the batch", async () => {
    vi.mocked(changeLogRepository.findByImportBatch).mockResolvedValue([makeLog({ id: 1, recordId: 1 }), makeLog({ id: 2, recordId: 2 })] as never);
    vi.mocked(changeLogRepository.findLatestForRecord).mockImplementation((async (_t: string, recordId: number) => ({
      id: recordId, // each row's own change-log entry is still the latest for it
    })) as never);

    const result = await revertImportBatch(BATCH_ID);

    expect(result).toEqual({ reverted: 2, skipped: 0 });
    expect(deleteManualCount).toHaveBeenCalledTimes(2);
    expect(importBatchRepository.delete).toHaveBeenCalledWith(BATCH_ID, expect.anything());
  });

  it("skips a row that was touched again since the import, without reverting or failing it", async () => {
    vi.mocked(changeLogRepository.findByImportBatch).mockResolvedValue([makeLog({ id: 1, recordId: 1 })] as never);
    // A newer change-log row (id 99) exists for this record now - the
    // import's own row (id 1) is no longer the latest.
    vi.mocked(changeLogRepository.findLatestForRecord).mockResolvedValue({ id: 99 } as never);

    const result = await revertImportBatch(BATCH_ID);

    expect(result).toEqual({ reverted: 0, skipped: 1 });
    expect(deleteManualCount).not.toHaveBeenCalled();
    // Still deletes the batch row - a skipped cell doesn't block cleaning up
    // the now-irrelevant import-history entry itself.
    expect(importBatchRepository.delete).toHaveBeenCalled();
  });
});

describe("revertImportBatch - atomicity (the bug this fix closes)", () => {
  it("does not delete the batch row if a mid-loop revert throws", async () => {
    vi.mocked(changeLogRepository.findByImportBatch).mockResolvedValue([makeLog({ id: 1, recordId: 1 }), makeLog({ id: 2, recordId: 2 })] as never);
    vi.mocked(changeLogRepository.findLatestForRecord).mockImplementation((async (_t: string, recordId: number) => ({ id: recordId })) as never);
    // First row reverts fine, second hits an unexpected DB error.
    vi.mocked(deleteManualCount).mockResolvedValueOnce(true as never).mockRejectedValueOnce(new Error("connection lost"));

    await expect(revertImportBatch(BATCH_ID)).rejects.toThrow("connection lost");

    // The real guarantee here is transactional, not something this mock can
    // observe directly (the fake $transaction always "commits") - what IS
    // observable is that the function never reached the batch-row deletion
    // once a row's own revert threw, which is what the real transaction
    // wrapping now ensures rolls back together with it.
    expect(importBatchRepository.delete).not.toHaveBeenCalled();
  });
});

describe("revertImportBatch - not found", () => {
  it("throws if the batch doesn't exist", async () => {
    vi.mocked(importBatchRepository.findById).mockResolvedValue(null as never);

    await expect(revertImportBatch(999)).rejects.toThrow(HttpError);
  });
});
