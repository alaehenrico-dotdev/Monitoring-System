import { ReportHistoryPage } from "./ReportHistoryPage";

export function AuditHistoryPage() {
  return (
    <ReportHistoryPage
      type="Audit Report"
      title="Audit History"
      subtitle="Previously downloaded Manual Counting & Variance sheets."
      backTo="/manual-count"
      backLabel="Back to Audit"
    />
  );
}
