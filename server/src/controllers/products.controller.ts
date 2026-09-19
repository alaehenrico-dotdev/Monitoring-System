import type { Request, Response } from "express";
import { z } from "zod";
import { createProduct, deactivateProduct, listProducts, updateProduct } from "../services/products.service";
import { HttpError } from "../utils/HttpError";

const createSchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  sortOrder: z.number().optional(),
});

const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional(), sku: z.string().min(1).nullable().optional() });

export async function getProducts(req: Request, res: Response) {
  const includeInactive = req.query.includeInactive === "true";
  res.json(await listProducts(includeInactive));
}

export async function postProduct(req: Request, res: Response) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid product payload", parsed.error.flatten());
  res.status(201).json(await createProduct(parsed.data, req.user?.id));
}

export async function patchProduct(req: Request, res: Response) {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid product payload", parsed.error.flatten());
  res.json(await updateProduct(Number(req.params.id), parsed.data, req.user?.id));
}

export async function deleteProduct(req: Request, res: Response) {
  res.json(await deactivateProduct(Number(req.params.id), req.user?.id));
}
