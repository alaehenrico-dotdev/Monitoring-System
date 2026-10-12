import { ReportHistoryPage } from "./ReportHistoryPage";

export function AuditHistoryPage() {
  return (
    <ReportHistoryPage
      type="Audit Report"
      title="Audit History"
      subtitle="Past Manual Count & Variance sheets."
      backTo="/manual-count"
      backLabel="Back to Audit"
    />
  );
}
