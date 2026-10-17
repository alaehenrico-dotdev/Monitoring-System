import type { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { HttpError } from "../utils/HttpError";
import {
  approveCorrection,
  listCorrections,
  rejectCorrection,
  requestCorrection,
} from "../services/correction.service";

const createSchema = z.object({
  tableName: z.enum(["daily_online_stock", "daily_offline_stock", "manual_counts"]),
  recordId: z.number().int().positive(),
  field: z.string().min(1).max(64),
  proposedValue: z.number().finite().min(0).max(99_999_999),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(500),
});

const reviewSchema = z.object({
  note: z.string().trim().max(500).optional(),
  // Also apply the change to the finished days after it (their opening stock
  // moves). Off by default: each such day is then held for its own approval.
  cascade: z.boolean().optional(),
});
const rejectSchema = z.object({ note: z.string().trim().min(3, "Say why it was rejected").max(500) });

function id(req: Request): number {
  const n = Number(req.params.id);
  if (!Number.isSafeInteger(n) || n <= 0) throw HttpError.badRequest("Invalid id");
  return n;
}

export async function postCorrection(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid correction request", parsed.error.flatten());
  res.status(201).json(await requestCorrection(parsed.data, req.user?.id));
}

/// Admins see every request; anyone else sees their own.
export async function getCorrections(req: Request, res: Response) {
  const status = ["PENDING", "APPROVED", "REJECTED"].includes(String(req.query.status))
    ? (req.query.status as "PENDING" | "APPROVED" | "REJECTED")
    : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.min(Math.max(Number(req.query.offset) || 0, 0), 1_000_000);
  const requestedById = req.user?.role === Role.SUPERVISOR_ADMIN ? undefined : req.user?.id;
  res.json(await listCorrections({ status, limit, offset, requestedById }));
}

export async function postApprove(req: Request, res: Response) {
  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw HttpError.badRequest("Invalid review", parsed.error.flatten());
  res.json(await approveCorrection(id(req), parsed.data.note, req.user?.id, { cascade: parsed.data.cascade }));
}

export async function postReject(req: Request, res: Response) {
  const parsed = rejectSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw HttpError.badRequest(parsed.error.issues[0]?.message ?? "Invalid review", parsed.error.flatten());
  res.json(await rejectCorrection(id(req), parsed.data.note, req.user?.id));
}
