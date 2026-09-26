import { describe, expect, it } from "vitest";
import type { Product, Receipt } from "../types";
import { buildConsolidatedReceiptData } from "./consolidatedReceipts";

function product(id: number, overrides: Partial<Product> = {}): Product {
  return { id, sku: `SKU${id}`, name: `Product ${id}`, category: "Category A", unit: "Liter", isActive: true, sortOrder: id, ...overrides };
}

function receipt(id: number, items: Receipt["items"], overrides: Partial<Receipt> = {}): Receipt {
  return {
    id,
    orderDate: "2026-09-19",
    customer: `Customer ${id}`,
    location: "Bats New",
    salesRepName: null,
    salesRepId: null,
    salesRep: null,
    postedPool: "NONE",
    createdBy: null,
    createdAt: "2026-09-19T00:00:00.000Z",
    qrToken: `qr-${id}`,
    items,
    ...overrides,
  };
}

/**
 * Regression for the consolidated receipt's Subtotal/Grand Total rows
 * showing a long garbled digit string instead of a real number: quantity is
 * a Prisma Decimal, which arrives over JSON as a string, not a number - the
 * type declares `quantity: number` but that's only a compile-time promise.
 * Summing it with a bare `+` (rather than `Number(item.quantity)`, the
 * convention every other consumer of item.quantity already follows - see
 * ReceiptCard.tsx, receiptPdf.ts, ReceiptsPage.tsx) silently does string
 * concatenation ("0" + "4" -> "04") instead of arithmetic.
 */
describe("buildConsolidatedReceiptData - quantity arrives as a Decimal string over JSON", () => {
  const products = [product(1)];

  it("sums per-receipt, subtotal, and grand-total quantities as numbers, not concatenated strings", () => {
    const receipts: Receipt[] = [
      receipt(101, [{ id: 1, productId: 1, product: products[0], quantity: "4" as unknown as number, unitPrice: null }]),
      receipt(102, [{ id: 2, productId: 1, product: products[0], quantity: "40" as unknown as number, unitPrice: null }]),
    ];

    const data = buildConsolidatedReceiptData(receipts, products);
    const row = data.categoryGroups[0].rows[0];

    // A string-concatenation bug would leave these as "4" and "40" (still
    // individually correct) but break down once the SAME receipt/product
    // pair accumulates twice, or once totals are summed across columns.
    expect(row.valuesByReceiptId[101]).toBe(4);
    expect(row.valuesByReceiptId[102]).toBe(40);
    expect(row.total).toBe(44); // string concat would give "0" + "4" + "40" = "0440"
    expect(typeof row.total).toBe("number");

    expect(data.categoryGroups[0].subtotalTotal).toBe(44);
    expect(data.grandTotal).toBe(44);
    expect(typeof data.grandTotal).toBe("number");
  });

  it("sums multiple line items for the same product on the same receipt as numbers", () => {
    const receipts: Receipt[] = [
      receipt(201, [
        { id: 1, productId: 1, product: products[0], quantity: "4" as unknown as number, unitPrice: null },
        { id: 2, productId: 1, product: products[0], quantity: "6" as unknown as number, unitPrice: null },
      ]),
    ];

    const data = buildConsolidatedReceiptData(receipts, products);
    const row = data.categoryGroups[0].rows[0];

    // String concatenation would give "04" + "6" = "046" rather than 10.
    expect(row.valuesByReceiptId[201]).toBe(10);
    expect(data.grandTotal).toBe(10);
  });
});
