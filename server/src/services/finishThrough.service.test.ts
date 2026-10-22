import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => {
  const m = {
    dayClosure: { findFirst: vi.fn(), findMany: vi.fn() },
    dailyOnlineStock: { groupBy: vi.fn(), count: vi.fn() },
    dailyOfflineStock: { groupBy: vi.fn(), count: vi.fn() },
    manualCount: { groupBy: vi.fn() },
    pendingRelease: { count: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(m));
  return m;
});
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent: vi.fn() }));
const closePeriod = vi.hoisted(() => vi.fn());
vi.mock("./dayLock.service", () => ({ closePeriod }));
const buildDailyReport = vi.hoisted(() => vi.fn());
vi.mock("./reports.service", () => ({ buildDailyReport }));
const saveSnapshot = vi.hoisted(() => vi.fn());
vi.mock("./dailyReportSnapshot.service", () => ({ saveSnapshot }));
const recordReportHistoryIn = vi.hoisted(() => vi.fn());
vi.mock("./reportHistory.service", () => ({ recordReportHistoryIn }));
const notifyDailyReportSaved = vi.hoisted(() => vi.fn());
vi.mock("../lib/reportSaved", () => ({ notifyDailyReportSaved }));

import { finishThrough, MAX_FINISH_SPAN_DAYS, planFinishThrough } from "./finishThrough.service";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const row = (iso: string, shift: "MORNING" | "NIGHT", n = 55) => ({ entryDate: D(iso), shift, _count: { _all: n } });
const NOW = new Date("2026-10-17T03:00:00.000Z");

/// Online page has Oct 12-14 (Night) unfinished; Offline finished Oct 12 and 13 only.
function backlog() {
  prismaMock.dayClosure.findFirst.mockResolvedValue({ entryDate: D("2026-10-01") });
  prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([row("2026-10-12", "NIGHT"), row("2026-10-13", "NIGHT"), row("2026-10-14", "NIGHT")]);
  prismaMock.dailyOfflineStock.groupBy.mockResolvedValue([row("2026-10-12", "NIGHT"), row("2026-10-13", "NIGHT"), row("2026-10-14", "NIGHT")]);
  prismaMock.dayClosure.findMany.mockResolvedValue([
    { entryDate: D("2026-10-12"), shift: "NIGHT", onlineLocked: false, offlineLocked: true },
    { entryDate: D("2026-10-13"), shift: "NIGHT", onlineLocked: false, offlineLocked: true },
  ]);
  prismaMock.dailyOnlineStock.count.mockResolvedValue(0);
  prismaMock.pendingRelease.count.mockResolvedValue(0);
  prismaMock.manualCount.groupBy.mockResolvedValue([
    { entryDate: D("2026-10-12"), shift: "NIGHT" },
    { entryDate: D("2026-10-13"), shift: "NIGHT" },
    { entryDate: D("2026-10-14"), shift: "NIGHT" },
  ]);
  buildDailyReport.mockImplementation(async (d: Date) => ({ date: d.toISOString().slice(0, 10) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prismaMock));
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  backlog();
});

describe("planFinishThrough", () => {
  it("lists the unfinished periods of the page up to the date, oldest first", async () => {
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    expect(plan.periods.map((p) => `${p.entryDate} ${p.shift}`)).toEqual(["2026-10-12 NIGHT", "2026-10-13 NIGHT", "2026-10-14 NIGHT"]);
    expect(plan).toMatchObject({ blockers: [], warnings: [], canFinish: true });
  });

  it("only takes the periods up to the chosen date", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([row("2026-10-12", "NIGHT"), row("2026-10-13", "NIGHT")]);
    const plan = await planFinishThrough(D("2026-10-13"), "ONLINE", NOW);
    expect(plan.periods).toHaveLength(2);
  });

  it("skips pages that are already finished", async () => {
    prismaMock.dayClosure.findMany.mockResolvedValue([{ entryDate: D("2026-10-12"), shift: "NIGHT", onlineLocked: true, offlineLocked: true }]);
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    expect(plan.periods.map((p) => p.entryDate)).toEqual(["2026-10-13", "2026-10-14"]);
  });

  it("marks a day settled only when the other page is finished or empty", async () => {
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    // Offline is finished on the 12th and 13th, but not the 14th.
    expect([...plan.settled].sort()).toEqual(["2026-10-12:NIGHT", "2026-10-13:NIGHT"]);
  });

  it("treats a day whose other page has nothing saved as settled", async () => {
    prismaMock.dailyOfflineStock.groupBy.mockResolvedValue([]);
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    expect(plan.settled.size).toBe(3);
  });

  it("blocks a date that has not happened", async () => {
    const plan = await planFinishThrough(D("2026-10-20"), "ONLINE", NOW);
    expect(plan.blockers.join(" ")).toContain("has not happened yet");
    expect(plan.canFinish).toBe(false);
  });

  it("blocks a backlog bigger than one confirmation can honestly cover", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([row("2026-07-01", "NIGHT"), row("2026-10-14", "NIGHT")]);
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    expect(plan.blockers.join(" ")).toContain(`limit is ${MAX_FINISH_SPAN_DAYS} days`);
  });

  it("blocks locking in negative stock", async () => {
    prismaMock.dailyOnlineStock.count.mockResolvedValue(2);
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    expect(plan.blockers).toContain("2 product row(s) end below zero stock in this range. Correct them before finishing.");
  });

  it("warns about empty days, awaiting items, missing counts and an in-progress day - none of them block", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([row("2026-10-12", "NIGHT"), row("2026-10-17", "NIGHT")]);
    prismaMock.dailyOfflineStock.groupBy.mockResolvedValue([]);
    prismaMock.pendingRelease.count.mockResolvedValue(4);
    prismaMock.manualCount.groupBy.mockResolvedValue([{ entryDate: D("2026-10-12"), shift: "NIGHT" }]);
    const plan = await planFinishThrough(D("2026-10-17"), "ONLINE", NOW);
    expect(plan.blockers).toEqual([]);
    expect(plan.canFinish).toBe(true);
    const text = plan.warnings.join("\n");
    expect(text).toContain("No entries at all on 4 day(s)");
    expect(text).toContain("4 item(s) are still awaiting release");
    expect(text).toContain("1 period(s) have no manual count");
    expect(text).toContain("includes today's shifts");
  });

  it("has nothing to do when everything is already finished", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([]);
    const plan = await planFinishThrough(D("2026-10-14"), "ONLINE", NOW);
    expect(plan).toMatchObject({ periods: [], canFinish: false });
  });
});

describe("finishThrough", () => {
  it("finishes every period in order inside one transaction and saves a snapshot for each settled day", async () => {
    const result = await finishThrough(D("2026-10-14"), "ONLINE", 9);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(closePeriod.mock.calls.map((c) => [c[0].toISOString().slice(0, 10), c[1]])).toEqual([
      ["2026-10-12", "NIGHT"],
      ["2026-10-13", "NIGHT"],
      ["2026-10-14", "NIGHT"],
    ]);
    expect(closePeriod.mock.calls[0][2]).toEqual({ entriesOnly: true, userId: 9, location: "ONLINE" });
    expect(saveSnapshot.mock.calls.map((c) => c[0].toISOString().slice(0, 10))).toEqual(["2026-10-12", "2026-10-13"]);
    expect(result).toMatchObject({ finished: 3, snapshots: ["2026-10-12", "2026-10-13"] });
  });

  it("tells Drive about each saved day's report after the transaction commits", async () => {
    await finishThrough(D("2026-10-14"), "ONLINE", 9);
    expect(notifyDailyReportSaved.mock.calls.map((c) => c[0].toISOString().slice(0, 10))).toEqual(["2026-10-12", "2026-10-13"]);
  });

  it("tells Drive nothing when the finish rolls back", async () => {
    closePeriod.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db hiccup"));
    await expect(finishThrough(D("2026-10-14"), "ONLINE", 9)).rejects.toThrow("db hiccup");
    expect(notifyDailyReportSaved).not.toHaveBeenCalled();
  });

  it("changes nothing when a blocker is present", async () => {
    prismaMock.dailyOnlineStock.count.mockResolvedValue(1);
    await expect(finishThrough(D("2026-10-14"), "ONLINE", 9)).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(closePeriod).not.toHaveBeenCalled();
  });

  it("needs the warnings acknowledged, and then goes ahead", async () => {
    prismaMock.pendingRelease.count.mockResolvedValue(1);
    await expect(finishThrough(D("2026-10-14"), "ONLINE", 9)).rejects.toMatchObject({ status: 409 });
    expect(closePeriod).not.toHaveBeenCalled();

    const result = await finishThrough(D("2026-10-14"), "ONLINE", 9, { acknowledgeWarnings: true });
    expect(result.finished).toBe(3);
  });

  it("is a no-op with nothing to finish", async () => {
    prismaMock.dailyOnlineStock.groupBy.mockResolvedValue([]);
    expect(await finishThrough(D("2026-10-14"), "ONLINE", 9)).toMatchObject({ finished: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("locks nothing if a period fails part way (the whole transaction rolls back)", async () => {
    closePeriod.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("db hiccup"));
    await expect(finishThrough(D("2026-10-14"), "ONLINE", 9)).rejects.toThrow("db hiccup");
    expect(saveSnapshot).not.toHaveBeenCalled();
  });
});
