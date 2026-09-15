import { ReportHistoryTable } from "../components/ReportHistoryTable";
import { colors } from "../theme";

export function DailyReportHistoryPage() {
  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Daily Report History</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Previously generated Daily Reports.
      </p>
      <ReportHistoryTable type="Daily Report" />
    </div>
  );
}
