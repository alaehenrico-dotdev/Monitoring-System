import { ReportHistoryPage } from "../components/ReportHistoryPage";

export function DailyReportHistoryPage() {
  return (
    <ReportHistoryPage
      type="Daily Report"
      title="Daily Report History"
      subtitle="Previously generated Daily Reports."
      backTo="/daily-report"
      backLabel="Back to Daily Report"
    />
  );
}
