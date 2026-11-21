import { Prisma, Shift, SubmissionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { broadcastRealtimeEvent } from "../lib/realtime";
import { HttpError } from "../utils/HttpError";
import { toDateOnlyString } from "../utils/date";
import { toNum } from "../utils/stockMath";
import { assertPeriodOpen } from "./dayLock.service";
import { logSystemEvent } from "./changeLog.service";

/// An auditor's blind count of one sheet is staged here (manual_count_submissions) and never touches
/// manual_counts. The admin looks at it on the Audit page, stages the figures they accept into the
/// real count - which saves through saveManualCount like any typed count - and publishes as usual.
///
/// The auditor's endpoints return only that auditor's own lines: no system figure, no variance, and
/// nothing another auditor counted, so the count stays blind and independent.

/// Only Online and Offline are counted; TOTAL is a combined view, never counted on its own.
export const COUNT_LOCATIONS = ["ONLINE", "OFFLINE"] as const;
export type CountLocation = (typeof COUNT_LOCATIONS)[number];

export const MAX_NOTE_LENGTH = 500;

/// The shop's wall clock is UTC+8 (the same offset the Admin Queue uses for "today").
const LOCAL_UTC_OFFSET_HOURS = 8;
/// An auditor counts the current sheet; a day either side covers a night shift that runs past midnight
/// and a phone with the wrong date, a few days back covers a count finished late. Anything else is a
/// mistake (or someone writing into a sheet they have no business in) and is refused.
const SHEET_DAYS_BACK = 3;
const SHEET_DAYS_AHEAD = 1;

export function assertSheetInRange(entryDate: Date, now = new Date()): void {
  const local = new Date(now.getTime() + LOCAL_UTC_OFFSET_HOURS * 3_600_000);
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const days = Math.round((entryDate.getTime() - today) / 86_400_000);
  if (days < -SHEET_DAYS_BACK || days > SHEET_DAYS_AHEAD) {
    throw HttpError.badRequest("That sheet is not open for counting. Counts can only be sent for the last few days.");
  }
}

export interface DraftLineInput {
  productId: number;
  location: CountLocation;
  /// null = take the count back (a line with neither a count nor a note is deleted).
  qty: number | null;
  note: string | null;
}

export interface SubmissionLineView {
  productId: number;
  location: CountLocation;
  qty: number | null;
  note: string | null;
}

export interface MySubmission {
  status: SubmissionStatus;
  submittedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  lines: SubmissionLineView[];
}

const toLineView = (l: { productId: number; location: string; qty: Prisma.Decimal | null; note: string | null }): SubmissionLineView => ({
  productId: l.productId,
  location: l.location as CountLocation,
  qty: l.qty === null ? null : toNum(l.qty),
  note: l.note,
});

/// What the auditor has so far on this sheet (an empty draft when they have not started).
export async function getMySubmission(auditorId: number, entryDate: Date, shift: Shift): Promise<MySubmission> {
  const row = await prisma.manualCountSubmission.findUnique({
    where: { auditorId_entryDate_shift: { auditorId, entryDate, shift } },
    include: { lines: true },
  });
  if (!row) return { status: "DRAFT", submittedAt: null, reopenedAt: null, reopenReason: null, lines: [] };
  return {
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    reopenReason: row.reopenReason,
    lines: row.lines.map(toLineView),
  };
}

/// Saves changed lines of the auditor's draft (the page sends only what changed, a moment after the
/// last keystroke). Refused once the sheet is submitted - an admin has to reopen it first.
export async function saveDraftLines(auditorId: number, entryDate: Date, shift: Shift, lines: DraftLineInput[]): Promise<{ saved: number; savedAt: string }> {
  assertSheetInRange(entryDate);
  await assertPeriodOpen(entryDate, shift, prisma, "count");

  const productIds = [...new Set(lines.map((l) => l.productId))];
  const known = await prisma.product.findMany({ where: { id: { in: productIds }, isActive: true }, select: { id: true } });
  if (known.length !== productIds.length) throw HttpError.badRequest("One of those products is not an active product");

  // Last write wins within one request: the same product and location twice keeps the later line.
  const byKey = new Map<string, DraftLineInput>();
  for (const l of lines) byKey.set(`${l.location}:${l.productId}`, l);

  await prisma.$transaction(async (tx) => {
    const submission = await tx.manualCountSubmission.upsert({
      where: { auditorId_entryDate_shift: { auditorId, entryDate, shift } },
      create: { auditorId, entryDate, shift },
      update: {},
    });
    if (submission.status === "SUBMITTED") {
      throw HttpError.conflict("This count was already submitted. Ask an admin to reopen it if you need to change it.");
    }
    for (const l of byKey.values()) {
      const note = l.note?.trim() ? l.note.trim() : null;
      const key = { submissionId_productId_location: { submissionId: submission.id, productId: l.productId, location: l.location } };
      if (l.qty === null && note === null) {
        await tx.manualCountSubmissionLine.deleteMany({ where: { submissionId: submission.id, productId: l.productId, location: l.location } });
        continue;
      }
      const qty = l.qty === null ? null : Math.round(l.qty * 100) / 100;
      await tx.manualCountSubmissionLine.upsert({
        where: key,
        create: { submissionId: submission.id, productId: l.productId, location: l.location, qty, note },
        update: { qty, note },
      });
    }
    // Touch the submission so "last saved" moves even when only a line changed.
    await tx.manualCountSubmission.update({ where: { id: submission.id }, data: { updatedAt: new Date() } });
  });

  // No realtime tick here: a draft changes every second or two while someone counts, and each tick
  // makes every connected screen reload its data. The admin is told when it is submitted or reopened.
  return { saved: byKey.size, savedAt: new Date().toISOString() };
}

export interface SubmitResult {
  status: SubmissionStatus;
  submittedAt: string;
}

/// Sends the count: both locations at once. At least one product must be counted; if a whole location
/// has nothing counted the auditor has to say that is on purpose (`allowEmptyLocation`) - the page
/// asks them and sends it. Submitting twice (a retried request) just returns the first result.
export async function submitMySubmission(auditorId: number, entryDate: Date, shift: Shift, allowEmptyLocation: boolean): Promise<SubmitResult> {
  assertSheetInRange(entryDate);
  await assertPeriodOpen(entryDate, shift, prisma, "count");

  const result = await prisma.$transaction(async (tx) => {
    const submission = await tx.manualCountSubmission.findUnique({
      where: { auditorId_entryDate_shift: { auditorId, entryDate, shift } },
      include: { lines: { select: { location: true, qty: true } }, auditor: { select: { name: true } } },
    });
    if (!submission) throw HttpError.badRequest("Nothing counted yet - count at least one product before submitting.");
    if (submission.status === "SUBMITTED" && submission.submittedAt) {
      return { done: false as const, status: submission.status, submittedAt: submission.submittedAt, name: submission.auditor.name, counted: { ONLINE: 0, OFFLINE: 0 } };
    }

    const counted = { ONLINE: 0, OFFLINE: 0 };
    for (const l of submission.lines) {
      if (l.qty !== null && (l.location === "ONLINE" || l.location === "OFFLINE")) counted[l.location]++;
    }
    if (counted.ONLINE + counted.OFFLINE === 0) {
      throw HttpError.badRequest("Nothing counted yet - count at least one product before submitting.");
    }
    const emptyLocations = COUNT_LOCATIONS.filter((loc) => counted[loc] === 0);
    if (emptyLocations.length > 0 && !allowEmptyLocation) {
      throw HttpError.conflict(
        `${emptyLocations.map((l) => (l === "ONLINE" ? "Online" : "Offline")).join(" and ")} has nothing counted.`,
        { emptyLocations },
      );
    }

    const submittedAt = new Date();
    await tx.manualCountSubmission.update({
      where: { id: submission.id },
      // A resubmission after a reopen starts clean: the "reopened" marker has done its job.
      data: { status: "SUBMITTED", submittedAt, reopenedAt: null, reopenedById: null, reopenReason: null },
    });
    return { done: true as const, status: "SUBMITTED" as const, submittedAt, name: submission.auditor.name, counted };
  });

  if (result.done) {
    await logSystemEvent(
      "count_submitted",
      { auditor: result.name, date: toDateOnlyString(entryDate), shift, online: result.counted.ONLINE, offline: result.counted.OFFLINE },
      auditorId,
      "UPDATE",
    );
    broadcastRealtimeEvent();
  }
  return { status: result.status, submittedAt: result.submittedAt.toISOString() };
}

export interface AdminSubmissionView {
  id: number;
  auditor: { id: number; name: string };
  status: SubmissionStatus;
  submittedAt: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  updatedAt: string;
  counted: { ONLINE: number; OFFLINE: number };
  lines: SubmissionLineView[];
}

/// Every auditor's submission (draft or sent) for one sheet, for the admin's Audit page. A draft with
/// nothing in it is left out.
export async function listSubmissionsForSheet(entryDate: Date, shift: Shift): Promise<AdminSubmissionView[]> {
  const rows = await prisma.manualCountSubmission.findMany({
    where: { entryDate, shift },
    include: { auditor: { select: { id: true, name: true } }, lines: true },
    orderBy: { id: "asc" },
  });
  return rows
    .filter((r) => r.lines.length > 0)
    .map((r) => {
      const lines = r.lines.map(toLineView);
      const counted = { ONLINE: 0, OFFLINE: 0 };
      for (const l of lines) if (l.qty !== null) counted[l.location]++;
      return {
        id: r.id,
        auditor: r.auditor,
        status: r.status,
        submittedAt: r.submittedAt?.toISOString() ?? null,
        reopenedAt: r.reopenedAt?.toISOString() ?? null,
        reopenReason: r.reopenReason,
        updatedAt: r.updatedAt.toISOString(),
        counted,
        lines,
      };
    });
}

/// Sends the chosen auditors' submitted counts back to them as drafts (their numbers are kept, they
/// can change them and submit again). The admin picks which auditors - one, or both.
export async function reopenSubmissions(entryDate: Date, shift: Shift, auditorIds: number[], reason: string | null, actorId: number | undefined): Promise<{ reopened: number }> {
  await assertPeriodOpen(entryDate, shift, prisma, "count");
  const now = new Date();
  const targets = await prisma.manualCountSubmission.findMany({
    where: { entryDate, shift, auditorId: { in: auditorIds }, status: "SUBMITTED" },
    select: { id: true, auditor: { select: { name: true } } },
  });
  if (targets.length === 0) throw HttpError.conflict("None of the chosen counts are submitted, so there is nothing to reopen.");
  await prisma.manualCountSubmission.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { status: "DRAFT", reopenedAt: now, reopenedById: actorId ?? null, reopenReason: reason?.trim() ? reason.trim() : null },
  });
  await logSystemEvent(
    "count_reopened",
    { auditors: targets.map((t) => t.auditor.name), date: toDateOnlyString(entryDate), shift, reason: reason?.trim() || null },
    actorId,
    "UPDATE",
  );
  broadcastRealtimeEvent();
  return { reopened: targets.length };
}

export interface BlockingDraft {
  auditor: string;
  counted: number;
}

/// Auditors who have typed counts on this sheet but not submitted them. Publishing now would leave
/// their work out - and with "use as next day's opening" it would set what they hold to 0 - so the
/// publish asks the admin to acknowledge it.
export async function draftsBlockingPublish(entryDate: Date, shift: Shift): Promise<BlockingDraft[]> {
  const rows = await prisma.manualCountSubmission.findMany({
    where: { entryDate, shift, status: "DRAFT", lines: { some: { qty: { not: null } } } },
    select: { auditor: { select: { name: true } }, lines: { where: { qty: { not: null } }, select: { id: true } } },
  });
  return rows.map((r) => ({ auditor: r.auditor.name, counted: r.lines.length }));
}

/// Submissions sent and not yet answered by a publish of the same sheet - what the Admin Queue lists.
export async function pendingSubmissionSheets(from: Date): Promise<{ id: number; auditor: string; entryDate: Date; shift: Shift; submittedAt: Date }[]> {
  const submitted = await prisma.manualCountSubmission.findMany({
    where: { status: "SUBMITTED", entryDate: { gte: from }, submittedAt: { not: null } },
    select: { id: true, entryDate: true, shift: true, submittedAt: true, auditor: { select: { name: true } } },
    orderBy: { submittedAt: "desc" },
  });
  if (submitted.length === 0) return [];
  const published = await prisma.manualCount.groupBy({
    by: ["entryDate", "shift"],
    where: { entryDate: { gte: from }, publishedAt: { not: null } },
    _max: { publishedAt: true },
  });
  const lastPublish = new Map(published.map((p) => [`${toDateOnlyString(p.entryDate)}|${p.shift}`, p._max.publishedAt]));
  return submitted
    .filter((s) => {
      const at = lastPublish.get(`${toDateOnlyString(s.entryDate)}|${s.shift}`);
      return !at || at < (s.submittedAt as Date);
    })
    .map((s) => ({ id: s.id, auditor: s.auditor.name, entryDate: s.entryDate, shift: s.shift, submittedAt: s.submittedAt as Date }));
}

/// Whether the sheet was published after this count was sent: then the admin has already used it (or
/// not), and it is closed to the auditor for good.
async function publishedSince(entryDate: Date, shift: Shift, since: Date | null) {
  const latest = await prisma.manualCount.aggregate({ where: { entryDate, shift, publishedAt: { not: null } }, _max: { publishedAt: true } });
  const at = latest._max.publishedAt;
  return !!at && (!since || at >= since);
}

/// The auditor takes their own submitted count back to edit it, as long as the sheet has not been
/// published since. Their numbers are kept; they change them and submit again. The admin sees it go
/// back to "Counting..." (and a publish warns until it is submitted again).
export async function editMySubmission(auditorId: number, entryDate: Date, shift: Shift): Promise<MySubmission> {
  assertSheetInRange(entryDate);
  await assertPeriodOpen(entryDate, shift, prisma, "count");
  const row = await prisma.manualCountSubmission.findUnique({
    where: { auditorId_entryDate_shift: { auditorId, entryDate, shift } },
    include: { lines: true, auditor: { select: { name: true } } },
  });
  if (!row) throw HttpError.badRequest("There is no count to edit for this sheet.");
  if (row.status === "SUBMITTED") {
    if (await publishedSince(entryDate, shift, row.submittedAt)) {
      throw HttpError.conflict("This count was already published, so it can no longer be edited.");
    }
    const now = new Date();
    await prisma.manualCountSubmission.update({
      where: { id: row.id },
      data: { status: "DRAFT", reopenedAt: now, reopenedById: auditorId, reopenReason: "The auditor is editing their submitted count." },
    });
    await logSystemEvent("count_reopened", { auditors: [row.auditor.name], date: toDateOnlyString(entryDate), shift, reason: "edited by the auditor" }, auditorId, "UPDATE");
    broadcastRealtimeEvent();
    return { status: "DRAFT", submittedAt: row.submittedAt?.toISOString() ?? null, reopenedAt: now.toISOString(), reopenReason: "The auditor is editing their submitted count.", lines: row.lines.map(toLineView) };
  }
  // Already a draft (a double tap, or an admin reopened it): nothing to change.
  return {
    status: row.status,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    reopenedAt: row.reopenedAt?.toISOString() ?? null,
    reopenReason: row.reopenReason,
    lines: row.lines.map(toLineView),
  };
}

export interface HistoryEntry {
  date: string;
  shift: Shift;
  status: SubmissionStatus;
  submittedAt: string | null;
  counted: { ONLINE: number; OFFLINE: number };
  /// True once the sheet was published after this count: it can no longer be edited.
  published: boolean;
}

const HISTORY_DAYS = 30;
const HISTORY_MAX = 100;

/// The auditor's own recent counts, newest first: which sheet, whether it was sent, how much, and
/// whether it can still be edited. Only their own figures - nothing from the system or other auditors.
export async function listMyHistory(auditorId: number, now = new Date()): Promise<HistoryEntry[]> {
  const from = new Date(now.getTime() + LOCAL_UTC_OFFSET_HOURS * 3_600_000);
  const since = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - HISTORY_DAYS));
  const rows = await prisma.manualCountSubmission.findMany({
    where: { auditorId, entryDate: { gte: since }, lines: { some: {} } },
    include: { lines: { select: { location: true, qty: true } } },
    orderBy: [{ entryDate: "desc" }, { shift: "desc" }],
    take: HISTORY_MAX,
  });
  if (rows.length === 0) return [];
  const published = await prisma.manualCount.groupBy({
    by: ["entryDate", "shift"],
    where: { entryDate: { gte: since }, publishedAt: { not: null } },
    _max: { publishedAt: true },
  });
  const lastPublish = new Map(published.map((p) => [`${toDateOnlyString(p.entryDate)}|${p.shift}`, p._max.publishedAt]));
  return rows.map((r) => {
    const counted = { ONLINE: 0, OFFLINE: 0 };
    for (const l of r.lines) if (l.qty !== null && (l.location === "ONLINE" || l.location === "OFFLINE")) counted[l.location]++;
    const at = lastPublish.get(`${toDateOnlyString(r.entryDate)}|${r.shift}`);
    return {
      date: toDateOnlyString(r.entryDate),
      shift: r.shift,
      status: r.status,
      submittedAt: r.submittedAt?.toISOString() ?? null,
      counted,
      published: r.status === "SUBMITTED" && !!at && (!r.submittedAt || at >= r.submittedAt),
    };
  });
}
