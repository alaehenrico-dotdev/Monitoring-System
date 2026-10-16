import { prisma } from "../lib/prisma";
import { HttpError } from "../utils/HttpError";
import { logSystemEvent } from "./changeLog.service";

export interface TemplateRowInput {
  category: string;
  name: string;
}

export const MAX_TEMPLATE_NAME = 100;

/// Saved product-order templates, newest first. `rows` is returned as stored.
export async function listOrderTemplates() {
  const templates = await prisma.orderTemplate.findMany({ orderBy: [{ name: "asc" }] });
  return templates.map((t) => ({ id: t.id, name: t.name, rows: t.rows as unknown as TemplateRowInput[], updatedAt: t.updatedAt }));
}

/// Saves a template under a name; saving under a name that exists replaces its
/// rows (the same file read again, or a corrected one), so there is one template
/// per name rather than a growing pile of near-copies.
export async function saveOrderTemplate(name: string, rows: TemplateRowInput[], userId?: number) {
  const tidy = name.trim().replace(/\s+/g, " ");
  if (!tidy) throw HttpError.badRequest("Give the template a name");
  const clean = rows.map((r) => ({ category: r.category.trim().replace(/\s+/g, " "), name: r.name.trim().replace(/\s+/g, " ") })).filter((r) => r.name);
  if (clean.length === 0) throw HttpError.badRequest("The template has no products");

  const saved = await prisma.orderTemplate.upsert({
    where: { name: tidy },
    create: { name: tidy, rows: clean, createdById: userId ?? null },
    update: { rows: clean },
  });
  await logSystemEvent("order_template_save", { name: tidy, products: clean.length }, userId ?? null, "UPDATE");
  return { id: saved.id, name: saved.name, rows: clean, updatedAt: saved.updatedAt };
}

export async function deleteOrderTemplate(id: number, userId?: number) {
  const existing = await prisma.orderTemplate.findUnique({ where: { id } });
  if (!existing) throw HttpError.notFound("Template not found");
  await prisma.orderTemplate.delete({ where: { id } });
  await logSystemEvent("order_template_delete", { name: existing.name }, userId ?? null, "DELETE");
  return { deleted: true };
}
