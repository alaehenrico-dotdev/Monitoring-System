import { formatDateDisplay } from "./dateFormat";
import { pdfFileName, stockGridSection, type PdfSection } from "./pdfTables";
import { shiftWithWord } from "./shift";
import type { Shift } from "../types";

/// A published audit as the server stored it (GET /manual-counts/snapshots/:id).
export interface AuditSnapshot {
  id: number;
  entryDate: string;
  shift: Shift;
  publishedAt: string;
  appliedToOpening: boolean;
  rows: {
    location: "ONLINE" | "OFFLINE" | "TOTAL";
    productId: number;
    sku: string | null;
    name: string;
    category: string;
    systemRemainingStock: number;
    manualCount: number;
    variance: number;
    isOpeningBalance: boolean;
    remarks: string | null;
  }[];
}

/**
 * The PDF of a published audit: one line per counted product with its Online and
 * Offline counts side by side (the same columns the Audit page exports), built
 * only from what was stored at publish time - so it reads the same however the
 * sheet, or the days around it, change afterwards. Both locations are shown
 * whether or not the counts were applied to the next day's opening stock.
 */
export function auditSnapshotPdf(snapshot: AuditSnapshot): { filename: string; title: string; subtitle: string; sections: PdfSection[] } {
  const counted = snapshot.rows.filter((r) => r.location !== "TOTAL");
  const hasOnline = counted.some((r) => r.location === "ONLINE");
  const hasOffline = counted.some((r) => r.location === "OFFLINE");

  const byProduct = new Map<number, AuditSnapshot["rows"]>();
  for (const r of counted) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);

  const rows = [...byProduct.values()].map((group) => {
    const online = group.find((g) => g.location === "ONLINE");
    const offline = group.find((g) => g.location === "OFFLINE");
    // An opening balance seeds the system rather than auditing it: no variance.
    const variance = group.reduce((sum, g) => sum + (g.isOpeningBalance ? 0 : g.variance), 0);
    return {
      product: { category: group[0].category, sku: group[0].sku, name: group[0].name },
      isFlagged: variance !== 0,
      entry: {
        system: group.reduce((sum, g) => sum + g.systemRemainingStock, 0),
        offline: offline ? offline.manualCount : "",
        online: online ? online.manualCount : "",
        total: group.reduce((sum, g) => sum + g.manualCount, 0),
        variance,
      },
    };
  });
  rows.sort((a, b) => a.product.category.localeCompare(b.product.category) || a.product.name.localeCompare(b.product.name));

  const columns = [
    { key: "system", label: "System Remaining" },
    ...(hasOffline ? [{ key: "offline", label: "Offline Count" }] : []),
    ...(hasOnline ? [{ key: "online", label: "Online Count" }] : []),
    { key: "total", label: "Total Count" },
    { key: "variance", label: "Variance" },
  ];

  const published = new Date(snapshot.publishedAt).toLocaleString();
  return {
    filename: pdfFileName("audit-published", snapshot.entryDate, snapshot.shift),
    title: "Manual Counting & Variance",
    subtitle: `${formatDateDisplay(snapshot.entryDate)} - ${shiftWithWord(snapshot.shift)} - Published ${published} - ${
      snapshot.appliedToOpening ? "applied to the next day's opening stock" : "audit only"
    }`,
    sections: [stockGridSection(rows, columns, { flagKey: "variance" })],
  };
}
