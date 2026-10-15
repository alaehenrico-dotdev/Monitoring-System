import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

const prismaMock = vi.hoisted(() => ({ product: { findMany: vi.fn(), update: vi.fn() } }));
vi.mock("../lib/prisma", () => ({
  prisma: prismaMock,
  serializableTransaction: (fn: (tx: unknown) => unknown) => fn(prismaMock),
}));
const broadcastRealtimeEvent = vi.hoisted(() => vi.fn());
vi.mock("../lib/realtime", () => ({ broadcastRealtimeEvent }));
const invalidateCache = vi.hoisted(() => vi.fn());
vi.mock("../repositories/productRepository", () => ({ productRepository: { invalidateCache } }));
const logSystemEvent = vi.hoisted(() => vi.fn());
vi.mock("./changeLog.service", () => ({ recordChange: vi.fn(), logSystemEvent }));

import { reorderProducts } from "./products.service";

const p = (id: number, sortOrder: number) => ({ id, sortOrder, name: `P${id}`, category: "C" });

describe("reorderProducts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renumbers products into the given sequence, writing only the rows that moved", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, 1), p(2, 2), p(3, 3)]);
    const out = await reorderProducts([3, 1, 2], 9);
    expect(out).toEqual({ moved: 3, total: 3 });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { sortOrder: 1 } });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { sortOrder: 2 } });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { sortOrder: 3 } });
    expect(invalidateCache).toHaveBeenCalled();
    expect(broadcastRealtimeEvent).toHaveBeenCalled();
    expect(logSystemEvent).toHaveBeenCalledWith("product_reorder", { moved: 3 }, 9, "UPDATE");
  });

  it("keeps unlisted products after the listed ones, in their old order", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, 1), p(2, 2), p(3, 3), p(4, 4)]);
    await reorderProducts([3]);
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { sortOrder: 1 } });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { sortOrder: 2 } });
    expect(prismaMock.product.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { sortOrder: 3 } });
    expect(prismaMock.product.update).not.toHaveBeenCalledWith({ where: { id: 4 }, data: expect.anything() });
  });

  it("does nothing, and tells nobody, when the order is unchanged", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, 1), p(2, 2)]);
    expect(await reorderProducts([1, 2])).toEqual({ moved: 0, total: 2 });
    expect(prismaMock.product.update).not.toHaveBeenCalled();
    expect(broadcastRealtimeEvent).not.toHaveBeenCalled();
  });

  it("rejects an unknown or duplicated id", async () => {
    prismaMock.product.findMany.mockResolvedValue([p(1, 1)]);
    await expect(reorderProducts([1, 99])).rejects.toBeInstanceOf(HttpError);
    await expect(reorderProducts([1, 1])).rejects.toBeInstanceOf(HttpError);
    expect(prismaMock.product.update).not.toHaveBeenCalled();
  });
});
