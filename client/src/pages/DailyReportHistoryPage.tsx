import { Link } from "react-router-dom";
import { ReportHistoryTable } from "../components/ReportHistoryTable";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";

export function DailyReportHistoryPage() {
  return (
    <div>
      <PageHeader title="Daily Report History" subtitle="Previously generated Daily Reports.">
        <Toolbar className="no-print">
          <ToolbarControls>
            <Link to="/daily-report" className="ae-btn ae-btn-secondary" style={{ textDecoration: "none" }}>
              Back to Daily Report
            </Link>
          </ToolbarControls>
        </Toolbar>
      </PageHeader>
      <ReportHistoryTable type="Daily Report" />
    </div>
  );
}