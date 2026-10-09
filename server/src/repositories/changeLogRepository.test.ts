import { describe, expect, it } from "vitest";
import { buildChangeLogWhere } from "./changeLogRepository";

describe("buildChangeLogWhere", () => {
  it("is unfiltered when nothing is set", () => {
    expect(buildChangeLogWhere({})).toEqual({});
  });

  it("combines simple filters with AND", () => {
    const from = new Date("2026-10-01T00:00:00Z");
    const to = new Date("2026-10-09T23:59:59Z");
    expect(buildChangeLogWhere({ tableName: "products", userId: 3, action: "UPDATE", dateFrom: from, dateTo: to, importOnly: true })).toEqual({
      AND: [
        { tableName: "products" },
        { changedAt: { gte: from, lte: to } },
        { changedById: 3 },
        { action: "UPDATE" },
        { importBatchId: { not: null } },
      ],
    });
  });

  it("matches a product on its own row or on stock snapshots, old or new", () => {
    expect(buildChangeLogWhere({ productId: 5 })).toEqual({
      AND: [
        {
          OR: [
            { tableName: "products", recordId: 5 },
            {
              AND: [
                { tableName: { in: ["daily_online_stock", "daily_offline_stock", "manual_counts"] } },
                { OR: [{ newValue: { path: "$.productId", equals: 5 } }, { oldValue: { path: "$.productId", equals: 5 } }] },
              ],
            },
          ],
        },
      ],
    });
  });

  it("narrows report rows by type and section", () => {
    expect(buildChangeLogWhere({ reportType: "Daily Report", reportSection: "offline" })).toEqual({
      AND: [
        { tableName: "reports" },
        { newValue: { path: "$.type", equals: "Daily Report" } },
        { newValue: { path: "$.section", equals: "offline" } },
      ],
    });
  });

  it("filters shift on the snapshot, so a DELETE (no newValue) still matches", () => {
    expect(buildChangeLogWhere({ shift: "NIGHT" })).toEqual({
      AND: [{ OR: [{ newValue: { path: "$.shift", equals: "NIGHT" } }, { oldValue: { path: "$.shift", equals: "NIGHT" } }] }],
    });
  });
});
