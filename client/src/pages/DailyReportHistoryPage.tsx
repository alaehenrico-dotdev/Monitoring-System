import { Link } from "react-router-dom";
import { ReportHistoryTable } from "../components/ReportHistoryTable";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { colors } from "../theme";

export function DailyReportHistoryPage() {
  return (
    <div>
      <Toolbar className="no-print">
        <h2 style={{ margin: 0 }}>Daily Report History</h2>
        <ToolbarControls>
          <Link to="/daily-report" className="ae-btn ae-btn-secondary" style={{ textDecoration: "none" }}>
            Back to Daily Report
          </Link>
        </ToolbarControls>
      </Toolbar>
      <p style={{ fontSize: 13, color: colors.subtleInk, margin: "0 0 8px" }}>
        Previously generated Daily Reports.
      </p>
      <ReportHistoryTable type="Daily Report" />
    </div>
  );
}