import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  manualCountSubmission: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  manualCountSubmissionLine: { upsert: vi.fn(), deleteMany: vi.fn() },
  product: { findMany: vi.fn() },
  manualCount: { groupBy: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(),
}));
db.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(db));
vi.mock("../lib/prisma", () => ({ prisma: db }));
const assertPeriodOpen = vi.hoisted(() => vi.fn());
vi.mock("./dayLock.service", () => ({ assertPeriodOpen }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ logSystemEvent }));
const broadcast = vi.hoisted(() => vi.fn());
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: broadcast }));

import {
  draftsBlockingPublish,
  editMySubmission,
  listMyHistory,
  getMySubmission,
  listSubmissionsForSheet,
  pendingSubmissionSheets,
  reopenSubmissions,
  saveDraftLines,
  submitMySubmission,
} from "./countSubmission.service";

const DATE = new Date("2026-11-21T00:00:00.000Z");
const SHIFT = "NIGHT" as const;

beforeEach(() => {
  // Fixed clock: which sheets can be counted depends on today.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-21T06:00:00Z"));
  vi.clearAllMocks();
  db.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(db));
  db.product.findMany.mockImplementation(({ where }: { where: { id: { in: number[] } } }) => Promise.resolve(where.id.in.map((id) => ({ id }))));
  db.manualCountSubmission.upsert.mockResolvedValue({ id: 5, status: "DRAFT" });
});

describe("which sheets can be counted", () => {
  const lines = [{ productId: 1, location: "ONLINE" as const, qty: 1, note: null }];

  it("accepts today, yesterday (a night shift past midnight), tomorrow and a few days back", async () => {
    for (const d of ["2026-11-21", "2026-11-20", "2026-11-22", "2026-11-18"]) {
      await expect(saveDraftLines(9, new Date(`${d}T00:00:00.000Z`), SHIFT, lines)).resolves.toMatchObject({ saved: 1 });
    }
  });

  it("refuses an old or far-future sheet, for saving and for submitting, before touching anything", async () => {
    for (const d of ["2026-11-17", "2026-11-23", "2025-01-01"]) {
      await expect(saveDraftLines(9, new Date(`${d}T00:00:00.000Z`), SHIFT, lines)).rejects.toMatchObject({ status: 400 });
      await expect(submitMySubmission(9, new Date(`${d}T00:00:00.000Z`), SHIFT, true)).rejects.toMatchObject({ status: 400 });
    }
    expect(db.manualCountSubmission.upsert).not.toHaveBeenCalled();
    expect(db.manualCountSubmission.findUnique).not.toHaveBeenCalled();
  });
});

describe("getMySubmission", () => {
  it("is an empty draft before the auditor has started", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(null);
    expect(await getMySubmission(9, DATE, SHIFT)).toEqual({ status: "DRAFT", submittedAt: null, reopenedAt: null, reopenReason: null, lines: [] });
  });

  it("returns only that auditor's own lines (found by auditor, date and shift)", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue({
      status: "SUBMITTED",
      submittedAt: new Date("2026-11-21T14:00:00Z"),
      reopenedAt: null,
      reopenReason: null,
      lines: [{ productId: 1, location: "ONLINE", qty: "12.50", note: "two crushed" }],
    });
    const mine = await getMySubmission(9, DATE, SHIFT);
    expect(db.manualCountSubmission.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { auditorId_entryDate_shift: { auditorId: 9, entryDate: DATE, shift: SHIFT } } }));
    expect(mine.lines).toEqual([{ productId: 1, location: "ONLINE", qty: 12.5, note: "two crushed" }]);
    expect(JSON.stringify(mine)).not.toMatch(/variance|system|opening/i);
  });
});

describe("saveDraftLines", () => {
  it("checks the sheet is open, then saves counts (rounded to 2 decimals) and notes", async () => {
    await saveDraftLines(9, DATE, SHIFT, [
      { productId: 1, location: "ONLINE", qty: 12.345, note: null },
      { productId: 2, location: "OFFLINE", qty: null, note: "  found elsewhere " },
    ]);
    expect(assertPeriodOpen).toHaveBeenCalledWith(DATE, SHIFT, db, "count");
    const calls = db.manualCountSubmissionLine.upsert.mock.calls.map((c) => c[0]);
    expect(calls[0].update).toEqual({ qty: 12.35, note: null });
    expect(calls[1].create).toMatchObject({ productId: 2, location: "OFFLINE", qty: null, note: "found elsewhere" });
    // Autosaves are frequent; they must not make every screen reload (only submit and reopen broadcast).
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("deletes a line that has neither a count nor a note", async () => {
    await saveDraftLines(9, DATE, SHIFT, [{ productId: 1, location: "ONLINE", qty: null, note: " " }]);
    expect(db.manualCountSubmissionLine.deleteMany).toHaveBeenCalledWith({ where: { submissionId: 5, productId: 1, location: "ONLINE" } });
    expect(db.manualCountSubmissionLine.upsert).not.toHaveBeenCalled();
  });

  it("keeps the later of two lines for the same product and location", async () => {
    await saveDraftLines(9, DATE, SHIFT, [
      { productId: 1, location: "ONLINE", qty: 3, note: null },
      { productId: 1, location: "ONLINE", qty: 4, note: null },
    ]);
    expect(db.manualCountSubmissionLine.upsert).toHaveBeenCalledTimes(1);
    expect(db.manualCountSubmissionLine.upsert.mock.calls[0][0].update.qty).toBe(4);
  });

  it("refuses a product that is not active", async () => {
    db.product.findMany.mockResolvedValue([]);
    await expect(saveDraftLines(9, DATE, SHIFT, [{ productId: 99, location: "ONLINE", qty: 1, note: null }])).rejects.toMatchObject({ status: 400 });
    expect(db.manualCountSubmissionLine.upsert).not.toHaveBeenCalled();
  });

  it("refuses to change a count that was already submitted, and writes nothing", async () => {
    db.manualCountSubmission.upsert.mockResolvedValue({ id: 5, status: "SUBMITTED" });
    await expect(saveDraftLines(9, DATE, SHIFT, [{ productId: 1, location: "ONLINE", qty: 1, note: null }])).rejects.toMatchObject({ status: 409 });
    expect(db.manualCountSubmissionLine.upsert).not.toHaveBeenCalled();
    expect(db.manualCountSubmissionLine.deleteMany).not.toHaveBeenCalled();
  });

  it("does not save into a finished sheet", async () => {
    assertPeriodOpen.mockRejectedValueOnce(Object.assign(new Error("locked"), { status: 409 }));
    await expect(saveDraftLines(9, DATE, SHIFT, [{ productId: 1, location: "ONLINE", qty: 1, note: null }])).rejects.toThrow("locked");
    expect(db.manualCountSubmission.upsert).not.toHaveBeenCalled();
  });
});

describe("submitMySubmission", () => {
  const sub = (lines: { location: string; qty: number | null }[], over: Record<string, unknown> = {}) => ({
    id: 5,
    status: "DRAFT",
    submittedAt: null,
    auditor: { name: "Ana" },
    lines,
    ...over,
  });

  it("refuses when nothing is counted at all", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(null);
    await expect(submitMySubmission(9, DATE, SHIFT, true)).rejects.toMatchObject({ status: 400 });
    db.manualCountSubmission.findUnique.mockResolvedValue(sub([{ location: "ONLINE", qty: null }]));
    await expect(submitMySubmission(9, DATE, SHIFT, true)).rejects.toMatchObject({ status: 400 });
    expect(db.manualCountSubmission.update).not.toHaveBeenCalled();
  });

  it("warns (409 with the empty location) when one location has nothing counted", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(sub([{ location: "ONLINE", qty: 4 }]));
    const err = await submitMySubmission(9, DATE, SHIFT, false).catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.message).toBe("Offline has nothing counted.");
    expect(err.details).toEqual({ emptyLocations: ["OFFLINE"] });
    expect(db.manualCountSubmission.update).not.toHaveBeenCalled();
  });

  it("submits both locations once the empty one is acknowledged, and records it", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(sub([{ location: "ONLINE", qty: 4 }, { location: "ONLINE", qty: 0 }]));
    const result = await submitMySubmission(9, DATE, SHIFT, true);
    expect(result.status).toBe("SUBMITTED");
    expect(db.manualCountSubmission.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: "SUBMITTED", reopenedAt: null, reopenReason: null }),
    });
    expect(logSystemEvent).toHaveBeenCalledWith("count_submitted", expect.objectContaining({ auditor: "Ana", online: 2, offline: 0 }), 9, "UPDATE");
    expect(broadcast).toHaveBeenCalled();
  });

  it("needs no acknowledgement when both locations have counts (a counted 0 is a count)", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(sub([{ location: "ONLINE", qty: 0 }, { location: "OFFLINE", qty: 7 }]));
    await expect(submitMySubmission(9, DATE, SHIFT, false)).resolves.toMatchObject({ status: "SUBMITTED" });
  });

  it("is idempotent: a retry of an already submitted count changes and announces nothing", async () => {
    const at = new Date("2026-11-21T14:00:00Z");
    db.manualCountSubmission.findUnique.mockResolvedValue(sub([], { status: "SUBMITTED", submittedAt: at }));
    await expect(submitMySubmission(9, DATE, SHIFT, false)).resolves.toEqual({ status: "SUBMITTED", submittedAt: at.toISOString() });
    expect(db.manualCountSubmission.update).not.toHaveBeenCalled();
    expect(logSystemEvent).not.toHaveBeenCalled();
  });
});

describe("listSubmissionsForSheet", () => {
  it("shows each auditor's lines and per-location counts, and leaves out an empty draft", async () => {
    db.manualCountSubmission.findMany.mockResolvedValue([
      {
        id: 1,
        auditor: { id: 9, name: "Ana" },
        status: "SUBMITTED",
        submittedAt: new Date("2026-11-21T14:00:00Z"),
        reopenedAt: null,
        reopenReason: null,
        updatedAt: new Date("2026-11-21T14:00:00Z"),
        lines: [
          { productId: 1, location: "ONLINE", qty: "3", note: null },
          { productId: 1, location: "OFFLINE", qty: null, note: "n" },
        ],
      },
      { id: 2, auditor: { id: 10, name: "Ben" }, status: "DRAFT", submittedAt: null, reopenedAt: null, reopenReason: null, updatedAt: new Date(), lines: [] },
    ]);
    const list = await listSubmissionsForSheet(DATE, SHIFT);
    expect(list).toHaveLength(1);
    expect(list[0].counted).toEqual({ ONLINE: 1, OFFLINE: 0 });
    expect(list[0].lines[0]).toEqual({ productId: 1, location: "ONLINE", qty: 3, note: null });
  });
});

describe("reopenSubmissions", () => {
  it("reopens only the chosen auditors' SUBMITTED counts, keeping their numbers, and says who did it", async () => {
    db.manualCountSubmission.findMany.mockResolvedValue([{ id: 1, auditor: { name: "Ana" } }]);
    const r = await reopenSubmissions(DATE, SHIFT, [9], " recount aisle 3 ", 1);
    expect(r).toEqual({ reopened: 1 });
    expect(db.manualCountSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { entryDate: DATE, shift: SHIFT, auditorId: { in: [9] }, status: "SUBMITTED" } }));
    expect(db.manualCountSubmission.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [1] } },
      data: expect.objectContaining({ status: "DRAFT", reopenedById: 1, reopenReason: "recount aisle 3" }),
    });
    expect(db.manualCountSubmissionLine.deleteMany).not.toHaveBeenCalled();
    expect(logSystemEvent).toHaveBeenCalledWith("count_reopened", expect.objectContaining({ auditors: ["Ana"] }), 1, "UPDATE");
  });

  it("refuses when none of the chosen counts is submitted", async () => {
    db.manualCountSubmission.findMany.mockResolvedValue([]);
    await expect(reopenSubmissions(DATE, SHIFT, [9, 10], null, 1)).rejects.toMatchObject({ status: 409 });
    expect(db.manualCountSubmission.updateMany).not.toHaveBeenCalled();
  });
});

describe("draftsBlockingPublish", () => {
  it("names auditors with counts typed but not submitted", async () => {
    db.manualCountSubmission.findMany.mockResolvedValue([{ auditor: { name: "Ben" }, lines: [{ id: 1 }, { id: 2 }, { id: 3 }] }]);
    expect(await draftsBlockingPublish(DATE, SHIFT)).toEqual([{ auditor: "Ben", counted: 3 }]);
    expect(db.manualCountSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: "DRAFT" }) }));
  });
});

describe("pendingSubmissionSheets", () => {
  const submitted = (id: number, at: string) => ({ id, entryDate: DATE, shift: SHIFT, submittedAt: new Date(at), auditor: { name: "Ana" } });

  it("lists a submission nobody has published since, and not one a later publish answered", async () => {
    db.manualCountSubmission.findMany.mockResolvedValue([submitted(1, "2026-11-21T14:00:00Z")]);
    db.manualCount.groupBy.mockResolvedValue([]);
    expect(await pendingSubmissionSheets(DATE)).toHaveLength(1);

    db.manualCount.groupBy.mockResolvedValue([{ entryDate: DATE, shift: SHIFT, _max: { publishedAt: new Date("2026-11-21T15:00:00Z") } }]);
    expect(await pendingSubmissionSheets(DATE)).toHaveLength(0);

    // A publish from BEFORE the submission does not count: the new count is still unreviewed.
    db.manualCount.groupBy.mockResolvedValue([{ entryDate: DATE, shift: SHIFT, _max: { publishedAt: new Date("2026-11-21T13:00:00Z") } }]);
    expect(await pendingSubmissionSheets(DATE)).toHaveLength(1);
  });
});

describe("editMySubmission", () => {
  const row = (over = {}) => ({
    id: 5,
    status: "SUBMITTED",
    submittedAt: new Date("2026-11-21T03:00:00Z"),
    reopenedAt: null,
    reopenReason: null,
    auditor: { name: "Ana" },
    lines: [{ productId: 1, location: "ONLINE", qty: "4", note: null }],
    ...over,
  });

  it("takes the auditor's own submitted count back to a draft, keeping the numbers, when nothing was published since", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(row());
    db.manualCount.aggregate.mockResolvedValue({ _max: { publishedAt: null } });
    const r = await editMySubmission(9, DATE, SHIFT);
    expect(db.manualCountSubmission.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { auditorId_entryDate_shift: { auditorId: 9, entryDate: DATE, shift: SHIFT } } }));
    expect(db.manualCountSubmission.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ status: "DRAFT" }) }));
    expect(r.status).toBe("DRAFT");
    expect(r.lines).toEqual([{ productId: 1, location: "ONLINE", qty: 4, note: null }]);
    expect(broadcast).toHaveBeenCalled();
  });

  it("refuses once the sheet was published after the count was sent", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(row());
    db.manualCount.aggregate.mockResolvedValue({ _max: { publishedAt: new Date("2026-11-21T05:00:00Z") } });
    await expect(editMySubmission(9, DATE, SHIFT)).rejects.toMatchObject({ status: 409 });
    expect(db.manualCountSubmission.update).not.toHaveBeenCalled();
  });

  it("allows it again when the last publish was before this submission", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(row());
    db.manualCount.aggregate.mockResolvedValue({ _max: { publishedAt: new Date("2026-11-21T01:00:00Z") } });
    await expect(editMySubmission(9, DATE, SHIFT)).resolves.toMatchObject({ status: "DRAFT" });
  });

  it("changes nothing when it is already a draft, and 400s when there is no count", async () => {
    db.manualCountSubmission.findUnique.mockResolvedValue(row({ status: "DRAFT" }));
    await expect(editMySubmission(9, DATE, SHIFT)).resolves.toMatchObject({ status: "DRAFT" });
    expect(db.manualCountSubmission.update).not.toHaveBeenCalled();
    db.manualCountSubmission.findUnique.mockResolvedValue(null);
    await expect(editMySubmission(9, DATE, SHIFT)).rejects.toMatchObject({ status: 400 });
  });
});

describe("listMyHistory", () => {
  it("lists only the auditor's own sheets, with counts, and marks the published ones locked", async () => {
    db.manualCountSubmission.findMany.mockResolvedValue([
      { entryDate: new Date("2026-11-21T00:00:00Z"), shift: "NIGHT", status: "SUBMITTED", submittedAt: new Date("2026-11-21T03:00:00Z"), lines: [{ location: "ONLINE", qty: "1" }, { location: "OFFLINE", qty: null }] },
      { entryDate: new Date("2026-11-20T00:00:00Z"), shift: "NIGHT", status: "SUBMITTED", submittedAt: new Date("2026-11-20T03:00:00Z"), lines: [{ location: "OFFLINE", qty: "2" }] },
      { entryDate: new Date("2026-11-19T00:00:00Z"), shift: "NIGHT", status: "DRAFT", submittedAt: null, lines: [{ location: "ONLINE", qty: "3" }] },
    ]);
    db.manualCount.groupBy.mockResolvedValue([{ entryDate: new Date("2026-11-20T00:00:00Z"), shift: "NIGHT", _max: { publishedAt: new Date("2026-11-20T09:00:00Z") } }]);
    const h = await listMyHistory(9);
    expect(db.manualCountSubmission.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ auditorId: 9 }) }));
    expect(h.map((e) => [e.date, e.status, e.published, e.counted.ONLINE, e.counted.OFFLINE])).toEqual([
      ["2026-11-21", "SUBMITTED", false, 1, 0],
      ["2026-11-20", "SUBMITTED", true, 0, 1],
      ["2026-11-19", "DRAFT", false, 1, 0],
    ]);
  });
});
