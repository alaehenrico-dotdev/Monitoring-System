import type { Request, Response } from "express";
import { z } from "zod";
import {
  createDeliveryDestination,
  deactivateDeliveryDestination,
  listDeliveryDestinations,
  updateDeliveryDestination,
} from "../services/deliveryDestinations.service";
import { HttpError } from "../utils/HttpError";

const createSchema = z.object({
  name: z.string().min(1),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().optional(),
});

export async function getDeliveryDestinations(req: Request, res: Response) {
  const includeInactive = req.query.includeInactive === "true";
  res.json(await listDeliveryDestinations(includeInactive));
}

export async function postDeliveryDestination(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid delivery destination payload", parsed.error.flatten());
  res.status(201).json(await createDeliveryDestination(parsed.data, req.user?.id));
}

export async function patchDeliveryDestination(req: Request, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid delivery destination payload", parsed.error.flatten());
  res.json(await updateDeliveryDestination(Number(req.params.id), parsed.data, req.user?.id));
}

export async function deleteDeliveryDestination(req: Request, res: Response) {
  res.json(await deactivateDeliveryDestination(Number(req.params.id), req.user?.id));
}
