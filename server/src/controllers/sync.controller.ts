import type { Request, Response } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { pullChanges, pushChanges, type PushItem } from "../services/sync.service";

// Same per-table write permissions as the live PUT routes (dailyOnlineStock/
// dailyOfflineStock/manualCounts.routes.ts) - a batch endpoint can't rely on
// a single router-level `authorize(...)` the way those do, since one batch
// can mix tableNames, so each item is checked against its own table here.
// Never trusts the client to only send what its own UI would have allowed.
const TABLE_ROLES: Record<PushItem["tableName"], Role[]> = {
  daily_online_stock: [Role.ONLINE_ENCODER, Role.SUPERVISOR_ADMIN],
  daily_offline_stock: [Role.OFFLINE_ENCODER, Role.SUPERVISOR_ADMIN],
  manual_counts: [Role.SUPERVISOR_ADMIN, Role.ONLINE_ENCODER, Role.OFFLINE_ENCODER],
};

export async function getSyncPull(req: Request, res: Response) {
  const since = req.query.since;
  let sinceDate: Date | null = null;
  if (since !== undefined) {
    if (typeof since !== "string") throw HttpError.badRequest("Invalid since parameter");
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) throw HttpError.badRequest("Invalid since timestamp");
  }
  res.json(await pullChanges(sinceDate));
}

const pushItemSchema = z
  .object({
    tableName: z.enum(["daily_online_stock", "daily_offline_stock", "manual_counts"]),
    localId: z.string().min(1),
    productId: z.number().int().positive(),
    entryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shift: z.enum(["MORNING", "NIGHT"]),
    location: z.enum(["ONLINE", "OFFLINE", "TOTAL"]).optional(),
    baselineUpdatedAt: z.string().nullable(),
    delta: z.record(z.string(), z.number()).optional(),
    manualCount: z.number().optional(),
  })
  .refine((item) => item.tableName !== "manual_counts" || (item.location !== undefined && item.manualCount !== undefined), {
    message: "manual_counts push item requires location and manualCount",
  });

const pushBodySchema = z.object({ items: z.array(pushItemSchema).max(500) });

export async function postSyncPush(req: Request, res: Response) {
  const parsed = pushBodySchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid push batch", parsed.error.flatten());

  const role = req.user?.role;
  for (const item of parsed.data.items) {
    if (!role || !TABLE_ROLES[item.tableName].includes(role)) {
      throw HttpError.forbidden(`Requires role: ${TABLE_ROLES[item.tableName].join(" or ")} for ${item.tableName}`);
    }
  }

  const result = await pushChanges(parsed.data.items as PushItem[], req.user?.id);
  res.json(result);
}
