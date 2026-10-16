import type { Request, Response } from "express";
import { z } from "zod";
import { createProduct, deactivateProduct, listProducts, reorderProducts, updateProduct } from "../services/products.service";
import { HttpError } from "../utils/HttpError";
import { syncProductsFromSheet } from "../services/productSync.service";

const createSchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1),
  category: z.string().min(1),
  unit: z.string().min(1),
  sortOrder: z.number().optional(),
  lowStockThreshold: z.number().nonnegative().nullable().optional(),
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

const syncSchema = z.object({
  items: z
    .array(
      z.object({
        category: z.string().trim().min(1).max(100),
        name: z.string().trim().min(1).max(200),
        productId: z.number().int().positive().optional(),
        rename: z.boolean().optional(),
        mergeFromId: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

/// Adds the sheet's missing products and applies the sheet's sequence.
export async function postProductSync(req: Request, res: Response) {
  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid product sync payload", parsed.error.flatten());
  res.json(await syncProductsFromSheet(parsed.data.items, req.user?.id));
}

const reorderSchema = z.object({ orderedIds: z.array(z.number().int().positive()).min(1).max(5000) });

/// Supervisor/Admin: set the product sequence used by every grid and report.
export async function putProductOrder(req: Request, res: Response) {
  const parsed = reorderSchema.safeParse(req.body);
  if (!parsed.success) throw HttpError.badRequest("Invalid product order payload", parsed.error.flatten());
  res.json(await reorderProducts(parsed.data.orderedIds, req.user?.id));
}
