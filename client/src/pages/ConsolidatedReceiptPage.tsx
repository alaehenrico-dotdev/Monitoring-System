import { useState } from "react";
import { listReceipts } from "../api/receipts";
import { listProducts } from "../api/products";
import type { Receipt } from "../types";
import { Button } from "../components/ui";
import { Dropdown } from "../components/Dropdown";
import { DatePicker } from "../components/DatePicker";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { ConsolidatedReceiptTable } from "../components/ConsolidatedReceiptTable";
import { TableSkeleton } from "../components/Skeleton";
import { formatDateDisplay } from "../utils/dateFormat";
import { downloadExcel } from "../utils/excel";
import { downloadTablePdf } from "../utils/tablePdf";
import { pdfFileName } from "../utils/pdfTables";
import {
  buildConsolidatedReceiptData,
  consolidatedLegendSection,
  consolidatedMatrixSection,
  filterReceiptsByPool,
  receiptPool,
  toConsolidatedExcelTable,
  toConsolidatedLegendExcelTable,
  type ReceiptPool,
} from "../utils/consolidatedReceipts";
import { colors } from "../theme";
import { PrinterIcon } from "../components/icons";
import { useTopProgress } from "../hooks/useTopProgress";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const POOL_LABELS: Record<ReceiptPool, string> = {
  ALL: "All Receipts",
  FULFILLMENT: "Posted to Online Fulfillment",
  OFFLINE_DELIVERY: "Posted to Offline Delivery",
  NOT_POSTED: "Not Posted",
};

/**
 * Section 4.7 - Consolidated Receipt: every Receipt logged for a date,
 * combined into one matrix (customers as columns, products as rows) instead
 * of reviewing them one at a time - what the business currently builds by
 * hand into the "CONSOLIDATED RECEIPTS MONITORING" sheet of its monthly
 * Offline Receipts Audit workbook.
 *
 * The Pool filter narrows this to exactly the receipts behind a given day's
 * Fulfillment (Out) or Delivery (Out) figure (see Receipt.postedPool,
 * Section 4.7), so the grand total at the bottom of the matrix can be
 * checked against that entry on the Online/Offline grid.
 */
export function ConsolidatedReceiptPage() {
  const progress = useTopProgress();
  const [date, setDate] = useState(today());
  const [pool, setPool] = useState<ReceiptPool>("ALL");
  const [allReceipts, setAllReceipts] = useState<Receipt[] | null>(null);
  // Re-fetched on every Generate (not just once) - a SKU added/renamed after
  // the page first loaded should still show up without a full page reload.
  const [products, setProducts] = useState<Awaited<ReturnType<typeof listProducts>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const receipts = allReceipts ? filterReceiptsByPool(allReceipts, pool) : null;
  const data = receipts ? buildConsolidatedReceiptData(receipts, products) : null;

  async function generate() {
    setError(null);
    setLoading(true);
    try {
      const [receiptsForDate, productList] = await Promise.all([listReceipts({ date }), listProducts()]);
      setAllReceipts(receiptsForDate);
      setProducts(productList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load receipts");
    } finally {
      setLoading(false);
    }
  }

  // Every receipt for the date, broken down by pool - shown regardless of
  // the current filter, so switching the filter never loses sight of how
  // the day's total splits across Fulfillment / Offline Delivery / Not
  // Posted.
  const poolCounts = allReceipts
    ? (["FULFILLMENT", "OFFLINE_DELIVERY", "NOT_POSTED"] as const).map((p) => ({
        pool: p,
        count: allReceipts.filter((r) => receiptPool(r) === p).length,
        qty: allReceipts.filter((r) => receiptPool(r) === p).reduce((sum, r) => sum + r.items.reduce((s, it) => s + Number(it.quantity), 0), 0),
      }))
    : [];

  function handleExport() {
    if (!data) return;
    const title = `CONSOLIDATED RECEIPTS - ${formatDateDisplay(date)} (${POOL_LABELS[pool]})`;
    const legend = toConsolidatedLegendExcelTable(data, title);
    const matrix = toConsolidatedExcelTable(data, title);
    downloadExcel(`consolidated-receipts-${date}.xls`, legend + matrix);
  }

  async function handlePdf() {
    if (!data) return;
    try {
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfFileName("consolidated-receipts", date, pool !== "ALL" ? pool : undefined),
          title: "Consolidated Receipt",
          subtitle: formatDateDisplay(date),
          notes: [POOL_LABELS[pool]],
          orientation: "landscape",
          sections: [consolidatedLegendSection(data, { title: "RECEIPTS" }), consolidatedMatrixSection(data, { title: "CONSOLIDATED QUANTITIES" })],
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? `PDF failed: ${e.message}` : "PDF failed");
    }
  }

  return (
    <div>
      <PageHeader
        title={`Consolidated Receipt - ${formatDateDisplay(date)}`}
        subtitle="Combine every receipt logged for a date into one matrix - products by category down the side, customers across the top."
      >
        <Toolbar className="no-print">
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
            <DatePicker aria-label="Delivery date" value={date} onChange={setDate} />
            <Dropdown
              aria-label="Pool"
              value={pool}
              onChange={(v) => setPool(v as ReceiptPool)}
              title="Narrow to receipts posted to a given stock pool"
              options={(Object.keys(POOL_LABELS) as ReceiptPool[]).map((p) => ({ value: p, label: POOL_LABELS[p] }))}
            />
            <Button onClick={generate} disabled={loading}>
              {loading ? "Loading…" : "Generate"}
            </Button>
          </div>
          {data && (
            <ToolbarControls>
              <Button variant="secondary" onClick={handleExport} title="Download as Excel">
                Export Excel
              </Button>
              <Button variant="secondary" onClick={handlePdf} title="Download as PDF">
                <PrinterIcon /> PDF
              </Button>
            </ToolbarControls>
          )}
        </Toolbar>
      </PageHeader>

      {error && <p style={{ color: colors.danger }}>{error}</p>}

      {loading && <TableSkeleton headers={["Product", "…", "…", "…"]} minWidth={720} rows={8} label="Building consolidated receipt…" />}

      {!loading && allReceipts && (
        <>
          {allReceipts.length > 0 && (
            <p style={{ fontSize: 12, color: colors.subtleInk, margin: "0 0 12px" }}>
              {allReceipts.length} receipt{allReceipts.length === 1 ? "" : "s"} for {formatDateDisplay(date)} -{" "}
              {poolCounts.map((p, i) => (
                <span key={p.pool}>
                  {i > 0 && " · "}
                  {POOL_LABELS[p.pool]}: {p.count} ({p.qty.toLocaleString()} qty)
                </span>
              ))}
            </p>
          )}
          {data && <ConsolidatedReceiptTable data={data} />}
        </>
      )}

      {!loading && !allReceipts && <p style={{ fontSize: 13, color: colors.subtleInk }}>Pick a date and click Generate to build the consolidated receipt.</p>}
    </div>
  );
}