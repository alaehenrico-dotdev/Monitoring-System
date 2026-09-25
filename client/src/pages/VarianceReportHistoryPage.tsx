import { Link } from "react-router-dom";
import { ReportHistoryTable } from "../components/ReportHistoryTable";
import { Toolbar, ToolbarControls } from "../components/Toolbar";
import { PageHeader } from "../components/PageHeader";

export function VarianceReportHistoryPage() {
  return (
    <div>
      <PageHeader title="Variance Report History" subtitle="Previously generated Variance Reports.">
        <Toolbar className="no-print">
          <ToolbarControls>
            <Link to="/variance-report" className="ae-btn ae-btn-secondary" style={{ textDecoration: "none" }}>
              Back to Variance Report
            </Link>
          </ToolbarControls>
        </Toolbar>
      </PageHeader>
      <ReportHistoryTable type="Variance Report" />
    </div>
  );
}