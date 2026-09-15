import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { colors } from "../theme";
import { readReportHistory, type ReportHistoryEntry } from "../utils/reportHistory";

export function ReportHistoryTable({ type }: { type: ReportHistoryEntry["type"] }) {
  const [history, setHistory] = useState<ReportHistoryEntry[]>(() => readReportHistory().filter((entry) => entry.type === type));

  useEffect(() => {
    function refresh() {
      setHistory(readReportHistory().filter((entry) => entry.type === type));
    }
    window.addEventListener("report-history-changed", refresh);
    return () => window.removeEventListener("report-history-changed", refresh);
  }, [type]);

  return history.length === 0 ? (
    <p style={{ color: colors.subtleInk }}>No generated {type} entries yet.</p>
  ) : (
    <div className="ae-table-scroll table-scroll">
      <table className="ae-table ae-table--left">
        <thead>
          <tr>
            <th>Coverage</th>
            <th>Generated</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {history.map((entry) => (
            <tr key={entry.id}>
              <td>{entry.scope}</td>
              <td>{new Date(entry.generatedAt).toLocaleString()}</td>
              <td>
                <Link to={entry.route} className="ae-btn ae-btn-secondary ae-btn-sm" style={{ textDecoration: "none" }}>
                  Open &amp; Print
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
