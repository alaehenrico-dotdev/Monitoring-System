import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { getVarianceReport } from "../api/manualCounts";
import { Button, TextInput } from "../components/ui";
import { DatePicker } from "../components/DatePicker";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";
import { Toast } from "../components/Toast";
import { colors } from "../theme";
import { Link, useSearchParams } from "react-router-dom";
import { recordReportHistory } from "../api/reportHistory";
import { HistoryIcon, PlayIcon, PrinterIcon } from "../components/icons";
import { AlertDialog, UnsavedWorkDialog } from "../components/AlertDialog";
import { findUnsavedWork, type UnsavedWorkItem } from "../utils/unsavedWork";
import { RowGlowScroll } from "../components/RowGlowScroll";
import { downloadTablePdf } from "../utils/tablePdf";
import { useTopProgress } from "../hooks/useTopProgress";
import { useRealtimeVersion } from "../context/RealtimeContext";
import {
  filterNotes,
  flatSection,
  pdfFileName,
  type PdfCell,
  type PdfColumn,
} from "../utils/pdfTables";

interface VarianceRow {
  id: number;
  entryDate: string;
  location: string;
  systemRemainingStock: string;
  manualCount: string;
  variance: string;
  product: { id: number; sku: string | null; name: string; category: string };
  countedBy: { name: string } | null;
}

// Same columns, in the same order, as the on-screen table below.
const VARIANCE_PDF_COLUMNS: PdfColumn[] = [
  { header: "Date" },
  { header: "Location" },
  { header: "Category" },
  { header: "SKU" },
  { header: "Product" },
  { header: "System", align: "right" },
  { header: "Manual Count", align: "right" },
  { header: "Variance", align: "right" },
  { header: "Counted By" },
];

// Built from local date parts (never `.toISOString()`, which reads the UTC
// calendar date - a different, earlier day than the local one for roughly
// the first 8 hours of every local day in this app's own Asia/Manila
// timezone) - same reasoning as utils/dateFormat.ts and utils/shift.ts's
// getCurrentShiftAndDate.
export function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/// Section 4.8 - all flagged variances across a date range, filterable by
/// product/category/location, to spot recurring problem SKUs (Section 4.4
/// calls out Toyo Mansi and Oyster Sauce A as historically the largest).
export function VarianceReportPage() {
  const progress = useTopProgress();
  const [searchParams] = useSearchParams();
  const [startDate, setStartDate] = useState(
    searchParams.get("startDate") ?? daysAgo(30),
  );
  const [endDate, setEndDate] = useState(
    searchParams.get("endDate") ?? daysAgo(0),
  );
  const [category, setCategory] = useState(searchParams.get("category") ?? "");
  const [rows, setRows] = useState<VarianceRow[] | null>(null);
  const requestId = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const printAfterLoad = useRef(searchParams.get("history") === "1");
  // Alert dialogs shown instead of generating: unsaved entry/count edits
  // inside the date range, or a range with nothing to report on.
  const [unsavedWork, setUnsavedWork] = useState<UnsavedWorkItem[] | null>(
    null,
  );
  const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
  const realtimeVersion = useRealtimeVersion();

  function changeDateRange(nextStart: string, nextEnd: string) {
    if (nextStart === startDate && nextEnd === endDate) return;
    requestId.current++;
    setRows(null);
    setError(null);
    setEmptyMessage(null);
    setStartDate(nextStart);
    setEndDate(nextEnd);
  }

  function changeCategory(nextCategory: string) {
    if (nextCategory === category) return;
    requestId.current++;
    setRows(null);
    setError(null);
    setEmptyMessage(null);
    setCategory(nextCategory);
  }

  useEffect(() => {
    if (searchParams.get("history") === "1") void runReport();
    // History links intentionally generate the selected report once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep an already-generated report live - same guarded re-run as
  // DailyReportPage, only while a report is already on screen.
  useEffect(() => {
    if (rows) void runReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtimeVersion]);

  // Opened from the report history: build the PDF as soon as the report has
  // loaded (there's no DOM to wait for - the PDF is built from the data).
  useEffect(() => {
    if (!rows || !printAfterLoad.current) return;
    printAfterLoad.current = false;
    void handlePdf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  async function runReport(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const id = ++requestId.current;
    const requestedStartDate = startDate;
    const requestedEndDate = endDate;

    // Variance is System - Manual Count, and both sides come from saved data -
    // staged edits inside this range would be silently left out of it.
    const unsaved = findUnsavedWork({
      from: requestedStartDate,
      to: requestedEndDate,
    });
    if (unsaved.length > 0) {
      setUnsavedWork(unsaved);
      return;
    }

    setRows(null);
    try {
      const data = (await getVarianceReport({
        startDate: requestedStartDate,
        endDate: requestedEndDate,
        category: category || undefined,
      })) as VarianceRow[];
      if (id !== requestId.current) return;
      const outOfRange = data.some((row) => {
        const rowDate = row.entryDate.slice(0, 10);
        return rowDate < requestedStartDate || rowDate > requestedEndDate;
      });
      if (outOfRange) {
        throw new Error(
          "The server returned a variance outside the selected date range.",
        );
      }
      if (data.length === 0) {
        setEmptyMessage("No variances found for this date range.");
        return;
      }
      setRows(data);
      const params = new URLSearchParams({
        history: "1",
        startDate: requestedStartDate,
        endDate: requestedEndDate,
      });
      if (category) params.set("category", category);
      if (searchParams.get("history") !== "1") {
        // Best effort - see api/reportHistory.ts.
        recordReportHistory({
          type: "Variance Report",
          scope: `${requestedStartDate} to ${requestedEndDate}`,
          route: `/variance-report?${params}`,
        }).catch(() => {});
      }
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load report");
    }
  }

  // Built from the rows by utils/tablePdf.ts (fixed page format, columns
  // fitted to the page) instead of window.print().
  async function handlePdf() {
    if (!rows) return;
    try {
      await progress.track(() =>
        downloadTablePdf({
          filename: pdfFileName(
            "variance-report",
            startDate,
            endDate,
            category,
          ),
          title: "Variance Report",
          subtitle: `${startDate} to ${endDate}`,
          notes: [
            ...filterNotes({ category }),
            `${rows.length} flagged variance(s) found.`,
          ],
          sections: [
            flatSection(
              VARIANCE_PDF_COLUMNS,
              rows.map((r): PdfCell[] => [
                r.entryDate.slice(0, 10),
                r.location,
                r.product.category,
                r.product.sku ?? "\u2014",
                r.product.name,
                r.systemRemainingStock,
                r.manualCount,
                {
                  text: r.variance,
                  bold: true,
                  tone: Number(r.variance) < 0 ? "danger" : "warning",
                },
                r.countedBy?.name ?? "\u2014",
              ]),
              { emptyMessage: "No flagged variances in this date range." },
            ),
          ],
        }),
      );
    } catch (err) {
      setError(
        err instanceof Error ? `PDF failed: ${err.message}` : "PDF failed",
      );
    }
  }

  return (
    <div>
      <PageHeader
        title="Variance Report"
        subtitle="Review differences between recorded stock and manual counts."
      >
        <Toolbar className="no-print">
          <form
            onSubmit={runReport}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "nowrap",
              minWidth: 0,
            }}
          >
            <DatePicker
              aria-label="From"
              value={startDate}
              onChange={(value) => changeDateRange(value, endDate)}
              style={{ maxWidth: 160 }}
            />
            <DatePicker
              aria-label="To"
              value={endDate}
              onChange={(value) => changeDateRange(startDate, value)}
              style={{ maxWidth: 160 }}
            />
            <TextInput
              aria-label="Category (optional)"
              value={category}
              onChange={(e) => changeCategory(e.target.value)}
              placeholder="e.g. Premium (Liter)"
              style={{ maxWidth: 200 }}
            />
            <Button type="submit">
              <PlayIcon /> Run report
            </Button>
          </form>
          <ToolbarControls>
            {rows && (
              <Button
                variant="secondary"
                onClick={handlePdf}
                title="Download as PDF"
              >
                <PrinterIcon /> PDF
              </Button>
            )}
            <Link
              to="/variance-report-history"
              className="ae-btn ae-btn-secondary"
              style={{ textDecoration: "none" }}
            >
              <HistoryIcon /> Variance History
            </Link>
          </ToolbarControls>
        </Toolbar>
      </PageHeader>

      <Toast message={error} onDismiss={() => setError(null)} variant="error" duration={null} />

      {rows && (
        <>
          <p style={{ fontSize: 13, color: colors.subtleInk }}>
            {rows.length} flagged variance(s) found.
          </p>
          <RowGlowScroll>
            <table className="ae-table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  {[
                    "Date",
                    "Location",
                    "Category",
                    "SKU",
                    "Product",
                    "System",
                    "Manual Count",
                    "Variance",
                    "Counted By",
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {r.entryDate.slice(0, 10)}
                    </td>
                    <td>{r.location}</td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        color: colors.ink,
                      }}
                    >
                      {r.product.category}
                    </td>
                    <td
                      style={{
                        textAlign: "left",
                        whiteSpace: "nowrap",
                        color: colors.yellow,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {r.product.sku ?? "—"}
                    </td>
                    <td style={nameCellStyle}>{r.product.name}</td>
                    <td>{r.systemRemainingStock}</td>
                    <td>{r.manualCount}</td>
                    <td
                      style={{
                        fontWeight: 700,
                        color:
                          Number(r.variance) < 0
                            ? colors.danger
                            : colors.warningText,
                      }}
                    >
                      {r.variance}
                    </td>
                    <td>{r.countedBy?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </RowGlowScroll>
        </>
      )}

      {!rows && !error && (
        <p style={{ fontSize: 13, color: colors.subtleInk }}>
          Pick a date range and click Run report to build the report.
        </p>
      )}

      {unsavedWork && (
        <UnsavedWorkDialog
          items={unsavedWork}
          onClose={() => setUnsavedWork(null)}
        />
      )}
      {emptyMessage && (
        <AlertDialog
          title="No report to generate"
          onClose={() => setEmptyMessage(null)}
        >
          {emptyMessage}
        </AlertDialog>
      )}
    </div>
  );
}

const nameCellStyle: CSSProperties = {
  textAlign: "left",
  whiteSpace: "nowrap",
  color: colors.ink,
};
