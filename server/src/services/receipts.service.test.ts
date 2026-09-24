import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../utils/HttpError";

vi.mock("../repositories/receiptRepository", () => ({
  receiptRepository: {
    create: vi.fn(),
    findMany: vi.fn(),
    findById: vi.fn(),
    findLastOrderDateForLocation: vi.fn(),
    findDistinctCustomers: vi.fn(),
  },
}));
vi.mock("../repositories/productRepository", () => ({
  productRepository: {
    findActiveById: vi.fn(),
  },
}));
vi.mock("./changeLog.service", () => ({
  recordChange: vi.fn(),
}));
vi.mock("./dailyOnlineStock.service", () => ({
  addFulfillmentFromReceipt: vi.fn(),
}));
vi.mock("./dailyOfflineStock.service", () => ({
  addDeliveryFromReceipt: vi.fn(),
}));
vi.mock("../utils/shift", () => ({
  getCurrentShiftAndDate: vi.fn(() => ({ shift: "NIGHT", date: new Date("2026-06-15") })),
}));

import { receiptRepository } from "../repositories/receiptRepository";
import { productRepository } from "../repositories/productRepository";
import { recordChange } from "./changeLog.service";
import { addFulfillmentFromReceipt } from "./dailyOnlineStock.service";
import { addDeliveryFromReceipt } from "./dailyOfflineStock.service";
import { createReceipt, getLastCustomersForLocation, getReceiptById } from "./receipts.service";

const product = { id: 1, isActive: true } as never;
const savedReceipt = {
  id: 10,
  orderDate: new Date("2026-06-15"),
  customer: "Acme",
  location: "Main St",
  postedPool: "NONE",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(productRepository.findActiveById).mockResolvedValue(product);
});

describe("createReceipt", () => {
  it("creates the receipt, records the change, and posts to Fulfillment when requested", async () => {
    vi.mocked(receiptRepository.create).mockResolvedValue({ ...savedReceipt, postedPool: "FULFILLMENT" } as never);

    const result = await createReceipt(
      {
        orderDate: new Date("2026-06-15"),
        customer: "Acme",
        location: "Main St",
        items: [{ productId: 1, quantity: 5, unitPrice: 10 }],
        postToFulfillment: true,
      },
      7,
      "SUPERVISOR_ADMIN" as never,
    );

    expect(receiptRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "Acme", postedPool: "FULFILLMENT" }),
      expect.anything(),
    );
    expect(recordChange).toHaveBeenCalledWith(
      expect.objectContaining({ tableName: "receipts", action: "CREATE", changedById: 7 }),
      expect.anything(),
    );
    expect(addFulfillmentFromReceipt).toHaveBeenCalledWith(1, expect.any(Date), "NIGHT", 5, 7);
    expect(addDeliveryFromReceipt).not.toHaveBeenCalled();
    expect(result.qrToken).toBeTruthy();
  });

  it("rejects a receipt containing an inactive or unknown product", async () => {
    vi.mocked(productRepository.findActiveById).mockResolvedValue(null);

    await expect(
      createReceipt(
        {
          orderDate: new Date("2026-06-15"),
          customer: "Acme",
          location: "Main St",
          items: [{ productId: 999, quantity: 1, unitPrice: 1 }],
        },
        7,
        "SUPERVISOR_ADMIN" as never,
      ),
    ).rejects.toThrow(HttpError);
    expect(receiptRepository.create).not.toHaveBeenCalled();
  });

  it("rejects an Online Encoder trying to post to Offline Delivery", async () => {
    await expect(
      createReceipt(
        {
          orderDate: new Date("2026-06-15"),
          customer: "Acme",
          location: "Main St",
          items: [{ productId: 1, quantity: 1, unitPrice: 1 }],
          postToOfflineDelivery: true,
        },
        7,
        "ONLINE_ENCODER" as never,
      ),
    ).rejects.toThrow(/Online Encoders may only post to Fulfillment/);
  });

  it("rejects an empty item list", async () => {
    await expect(
      createReceipt({ orderDate: new Date(), customer: "Acme", location: "Main St", items: [] }, 7, "SUPERVISOR_ADMIN" as never),
    ).rejects.toThrow(/at least one order item/);
  });
});

describe("getReceiptById", () => {
  it("returns the receipt with a qrToken when found", async () => {
    vi.mocked(receiptRepository.findById).mockResolvedValue(savedReceipt as never);
    const result = await getReceiptById(10);
    expect(result.qrToken).toBeTruthy();
  });

  it("throws HttpError.notFound when the receipt doesn't exist", async () => {
    vi.mocked(receiptRepository.findById).mockResolvedValue(null);
    await expect(getReceiptById(999)).rejects.toThrow(HttpError);
  });
});

describe("getLastCustomersForLocation", () => {
  it("returns [] when there's no prior receipt for that location", async () => {
    vi.mocked(receiptRepository.findLastOrderDateForLocation).mockResolvedValue(null);
    const result = await getLastCustomersForLocation("Main St", new Date("2026-06-15"));
    expect(result).toEqual([]);
    expect(receiptRepository.findDistinctCustomers).not.toHaveBeenCalled();
  });
});
