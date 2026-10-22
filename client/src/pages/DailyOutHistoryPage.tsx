import { ReportHistoryPage } from "./ReportHistoryPage";

export function DailyOutHistoryPage() {
  return (
    <ReportHistoryPage
      type="Daily Out"
      title="Daily Out History"
      subtitle="Previously exported Daily Out reports."
      backTo="/daily-out"
      backLabel="Back to Daily Out"
    />
  );
}
