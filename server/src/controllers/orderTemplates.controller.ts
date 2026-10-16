import type { Request, Response } from "express";
import { z } from "zod";
import { HttpError } from "../utils/HttpError";
import { deleteOrderTemplate, listOrderTemplates, MAX_TEMPLATE_NAME, saveOrderTemplate } from "../services/orderTemplates.service";

const saveSchema = z.object({
  name: z.string().trim().min(1).max(MAX_TEMPLATE_NAME),
  rows: z
    .array(z.object({ category: z.string().max(100), name: z.string().trim().min(1).max(200) }))
    .min(1)
    .max(1000),
});

export async function getOrderTemplates(_req: Request, res: Response) {
  res.json(await listOrderTemplates());
}

export async function postOrderTemplate(req: Request, res: Response) {
  const parsed = saveSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid template", parsed.error.flatten());
  res.status(201).json(await saveOrderTemplate(parsed.data.name, parsed.data.rows, req.user?.id));
}

export async function removeOrderTemplate(req: Request, res: Response) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw HttpError.badRequest("Invalid template id");
  res.json(await deleteOrderTemplate(id, req.user?.id));
}
