import type { Request, Response } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { HttpError } from "../utils/HttpError";
import {
  listReportHistory,
  recordReportHistory,
} from "../services/reportHistory.service";

const createSchema = z.object({
  // The three reports the app generates - also what the Change Log filters on.
  type: z.enum(["Daily Report", "Variance Report", "Audit Report", "Daily Out"]),
  scope: z.string().min(1).max(100),
  route: z.string().min(1).max(500),
  section: z.enum(["online", "offline", "all"]).optional(),
});

export async function postReportHistory(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success)
    throw HttpError.badRequest(
      "Invalid report history entry",
      parsed.error.flatten(),
    );

  const entry = await recordReportHistory(parsed.data, req.user?.id);
  res.status(201).json(entry);
}

/// The one history list every role may read: the Audit page (Manual Counting
/// & Variance) is open to encoders, so its download history is too. Daily and
/// Variance Report history stay Supervisor/Admin only.
const ALL_ROLES_HISTORY_TYPE = "Audit Report";

export async function getReportHistory(req: Request, res: Response) {
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  if (
    req.user?.role !== Role.SUPERVISOR_ADMIN &&
    type !== ALL_ROLES_HISTORY_TYPE
  ) {
    throw HttpError.forbidden(`Requires role: ${Role.SUPERVISOR_ADMIN}`);
  }
  const cursor = Number(req.query.cursor) || undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  res.json(await listReportHistory(type, cursor, limit));
}
