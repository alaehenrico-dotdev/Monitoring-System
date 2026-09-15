import { ReportHistoryTable } from "../components/ReportHistoryTable";
import { colors } from "../theme";

export function VarianceReportHistoryPage() {
  return (
    <div>
      <h2 style={{ margin: "-8px 0 0px" }}>Variance Report History</h2>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Previously generated Variance Reports.
      </p>
      <ReportHistoryTable type="Variance Report" />
    </div>
  );
}
