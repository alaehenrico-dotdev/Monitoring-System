import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ orderTemplate: { findMany: vi.fn(), upsert: vi.fn(), findUnique: vi.fn(), delete: vi.fn() } }));
vi.mock("../lib/prisma", () => ({ prisma: prismaMock }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ logSystemEvent }));

import { deleteOrderTemplate, listOrderTemplates, saveOrderTemplate } from "./orderTemplates.service";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.orderTemplate.upsert.mockImplementation(async ({ create }: { create: { name: string } }) => ({ id: 3, name: create.name, updatedAt: new Date("2026-10-16") }));
});

describe("order templates", () => {
  it("lists them by name with their rows", async () => {
    prismaMock.orderTemplate.findMany.mockResolvedValue([{ id: 1, name: "Encoder default order", rows: [{ category: "A", name: "X" }], updatedAt: new Date(), createdById: null }]);
    expect(await listOrderTemplates()).toEqual([expect.objectContaining({ id: 1, name: "Encoder default order", rows: [{ category: "A", name: "X" }] })]);
    expect(prismaMock.orderTemplate.findMany).toHaveBeenCalledWith({ orderBy: [{ name: "asc" }] });
  });

  it("saves under one name - an existing name is replaced, not duplicated - with tidied text", async () => {
    const out = await saveOrderTemplate("  My   order ", [{ category: " CLASS  A ", name: " SWEET  A " }, { category: "X", name: "  " }], 7);

    expect(prismaMock.orderTemplate.upsert).toHaveBeenCalledWith({
      where: { name: "My order" },
      create: { name: "My order", rows: [{ category: "CLASS A", name: "SWEET A" }], createdById: 7 },
      update: { rows: [{ category: "CLASS A", name: "SWEET A" }] },
    });
    expect(out.rows).toEqual([{ category: "CLASS A", name: "SWEET A" }]);
    expect(logSystemEvent).toHaveBeenCalledWith("order_template_save", { name: "My order", products: 1 }, 7, "UPDATE");
  });

  it("refuses a nameless template or one with no products", async () => {
    await expect(saveOrderTemplate("  ", [{ category: "A", name: "X" }])).rejects.toMatchObject({ status: 400 });
    await expect(saveOrderTemplate("T", [{ category: "A", name: " " }])).rejects.toMatchObject({ status: 400 });
    expect(prismaMock.orderTemplate.upsert).not.toHaveBeenCalled();
  });

  it("deletes one, and says so when it does not exist", async () => {
    prismaMock.orderTemplate.findUnique.mockResolvedValueOnce({ id: 3, name: "Old" }).mockResolvedValueOnce(null);
    expect(await deleteOrderTemplate(3, 7)).toEqual({ deleted: true });
    expect(prismaMock.orderTemplate.delete).toHaveBeenCalledWith({ where: { id: 3 } });
    await expect(deleteOrderTemplate(4)).rejects.toMatchObject({ status: 404 });
  });
});
