import { ReportHistoryPage } from "../components/ReportHistoryPage";

export function VarianceReportHistoryPage() {
  return (
    <ReportHistoryPage
      type="Variance Report"
      title="Variance Report History"
      subtitle="Previously generated Variance Reports."
      backTo="/variance-report"
      backLabel="Back to Variance Report"
    />
  );
}
