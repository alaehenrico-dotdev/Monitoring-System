import { useState, type CSSProperties } from "react";
import { getDailyReport, type DailyReport } from "../api/reports";
import { Button, TextInput } from "../components/ui";
import { colors } from "../theme";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/// Section 4.8 - a printable/exportable view of a given date's Online,
/// Offline, and Total grids, laid out the same way as the current Excel
/// printout (Section 8.1: generated from the database instead of by hand).
export function DailyReportPage() {
  const [date, setDate] = useState(today());
  const [report, setReport] = useState<DailyReport | null>(null);

  function load() {
    getDailyReport(date).then(setReport);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }} className="no-print">
        <h2 style={{ marginTop: 0 }}>Daily Report</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Button onClick={load}>Generate</Button>
          {report && (
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
          )}
        </div>
      </div>

      {report && (
        <div>
          <h3>Online — {report.date}</h3>
          <SimpleTable rows={report.online.map((r) => ({ name: r.product.name, ...r.entry }))} />

          <h3>Offline — {report.date}</h3>
          <SimpleTable rows={report.offline.map((r) => ({ name: r.product.name, ...r.entry }))} />

          <h3>Total Stocks — {report.date}</h3>
          <SimpleTable
            rows={report.total.map((r) => ({
              name: r.product.name,
              onlineRemainingStock: r.onlineRemainingStock,
              offlineRemainingStock: r.offlineRemainingStock,
              totalRemainingStock: r.totalRemainingStock,
            }))}
          />
        </div>
      )}
    </div>
  );
}

function SimpleTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: colors.subtleInk }}>No data.</p>;
  const columns = Object.keys(rows[0]);
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 12, marginBottom: 24, minWidth: 560 }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c} style={thStyle}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {columns.map((c) => (
              <td key={c} style={c === "name" ? { ...tdStyle, textAlign: "left", whiteSpace: "nowrap" } : tdStyle}>
                {String(row[c])}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const thStyle: CSSProperties = { textAlign: "right", padding: "4px 6px", borderBottom: `2px solid ${colors.black}`, background: colors.border, whiteSpace: "nowrap" };
const tdStyle: CSSProperties = { textAlign: "right", padding: "3px 6px", borderBottom: `1px solid ${colors.border}` };
