import { describe, expect, it } from "vitest";
import { auditSnapshotPdf, type AuditSnapshot } from "./auditSnapshot";

const row = (over: Partial<AuditSnapshot["rows"][number]>): AuditSnapshot["rows"][number] => ({
  location: "ONLINE",
  productId: 1,
  sku: "A1",
  name: "APPLE",
  category: "Fruit",
  systemRemainingStock: 10,
  manualCount: 8,
  variance: 2,
  isOpeningBalance: false,
  remarks: null,
  ...over,
});

const snapshot = (rows: AuditSnapshot["rows"], appliedToOpening = false): AuditSnapshot => ({
  id: 5,
  entryDate: "2026-10-17",
  shift: "NIGHT",
  publishedAt: "2026-10-18T01:00:00.000Z",
  appliedToOpening,
  rows,
});

describe("auditSnapshotPdf", () => {
  it("shows Online and Offline counts side by side for each counted product", () => {
    const pdf = auditSnapshotPdf(snapshot([row({ location: "ONLINE", manualCount: 8 }), row({ location: "OFFLINE", manualCount: 5, systemRemainingStock: 6, variance: 1 })]));
    const section = pdf.sections[0] as { columns: { header: string }[] };
    expect(section.columns.map((c) => c.header)).toEqual(["SKU", "Product", "System Remaining", "Offline Count", "Online Count", "Total Count", "Variance"]);
    expect(JSON.stringify(pdf.sections[0])).toContain("APPLE");
  });

  it("says whether it was applied to the next day's opening stock - both read the same otherwise", () => {
    expect(auditSnapshotPdf(snapshot([row({})], true)).subtitle).toContain("applied to the next day's opening stock");
    expect(auditSnapshotPdf(snapshot([row({})], false)).subtitle).toContain("audit only");
  });

  it("leaves out a location nothing was counted at, and ignores the combined TOTAL count", () => {
    const pdf = auditSnapshotPdf(snapshot([row({ location: "OFFLINE" }), row({ location: "TOTAL", productId: 2 })]));
    const headers = (pdf.sections[0] as { columns: { header: string }[] }).columns.map((c) => c.header);
    expect(headers).toContain("Offline Count");
    expect(headers).not.toContain("Online Count");
    expect(JSON.stringify(pdf.sections[0])).not.toContain('"#2"');
  });

  it("counts an opening balance as no variance", () => {
    const pdf = auditSnapshotPdf(snapshot([row({ isOpeningBalance: true, variance: 0 })]));
    expect(pdf.filename).toBe("audit-published-2026-10-17-night.pdf");
  });
});
