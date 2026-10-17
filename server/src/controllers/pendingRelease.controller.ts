import type { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { HttpError } from "../utils/HttpError";
import { parseDateOnly } from "../utils/date";
import { parseShift } from "../utils/shift";
import {
  awaitingSummary,
  cancelPendingRelease,
  createPendingRelease,
  listPendingReleases,
  releasePendingRelease,
  updatePendingRelease,
  type EntryLoc,
} from "../services/pendingRelease.service";

const quantity = z.number().finite().positive().max(99_999_999);
const reason = z.string().trim().min(3, "Say why it is waiting (e.g. no label yet)").max(200);

const createSchema = z.object({
  location: z.enum(["ONLINE", "OFFLINE"]),
  productId: z.number().int().positive(),
  quantity,
  madeDate: z.string(),
  madeShift: z.enum(["MORNING", "NIGHT"]),
  reason,
});
const updateSchema = z.object({ quantity: quantity.optional(), reason: reason.optional() }).refine((v) => v.quantity !== undefined || v.reason !== undefined, {
  message: "Nothing to change",
});
const releaseSchema = z.object({ date: z.string(), shift: z.enum(["MORNING", "NIGHT"]), note: z.string().trim().max(500).optional() });
const cancelSchema = z.object({ note: z.string().trim().min(3, "Say why it is being written off").max(500) });

function id(req: Request): number {
  const n = Number(req.params.id);
  if (!Number.isSafeInteger(n) || n <= 0) throw HttpError.badRequest("Invalid id");
  return n;
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid request", parsed.error.flatten());
  return parsed.data;
}

/// An encoder works their own page only; an admin works either.
function assertOwnPage(req: Request, location: EntryLoc) {
  const role = req.user?.role;
  if ((role === Role.ONLINE_ENCODER && location !== "ONLINE") || (role === Role.OFFLINE_ENCODER && location !== "OFFLINE")) {
    throw HttpError.forbidden("You can only work with your own entry page.");
  }
}

export async function getPendingReleases(req: Request, res: Response) {
  const status = ["AWAITING", "RELEASED", "CANCELLED"].includes(String(req.query.status)) ? (req.query.status as "AWAITING" | "RELEASED" | "CANCELLED") : undefined;
  const location = req.query.location === "ONLINE" || req.query.location === "OFFLINE" ? req.query.location : undefined;
  const productId = Number(req.query.productId) > 0 ? Number(req.query.productId) : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 1_000_000);
  res.json(await listPendingReleases({ status, location, productId, limit, offset }));
}

export async function getPendingSummary(_req: Request, res: Response) {
  res.json(await awaitingSummary());
}

export async function postPendingRelease(req: Request, res: Response) {
  const body = parse(createSchema, req.body);
  assertOwnPage(req, body.location);
  res.status(201).json(
    await createPendingRelease({ ...body, madeDate: parseDateOnly(body.madeDate) }, req.user?.id),
  );
}

export async function patchPendingRelease(req: Request, res: Response) {
  res.json(await updatePendingRelease(id(req), parse(updateSchema, req.body), req.user?.id, (location) => assertOwnPage(req, location)));
}

export async function postRelease(req: Request, res: Response) {
  const body = parse(releaseSchema, req.body);
  const result = await releasePendingRelease(id(req), { entryDate: parseDateOnly(body.date), shift: parseShift(body.shift) }, body.note, req.user?.id, undefined, (location) =>
    assertOwnPage(req, location),
  );
  res.json(result);
}

export async function postCancel(req: Request, res: Response) {
  res.json(await cancelPendingRelease(id(req), parse(cancelSchema, req.body).note, req.user?.id));
}
