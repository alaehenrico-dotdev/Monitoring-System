import { http } from "./http";

/// Switches that change how the entry pages behave for everyone (Settings > Entry Rules).
export interface EntryRules {
  /// An entry page stays read-only while an earlier day with saved entries is
  /// unfinished. Off lets people fill in the present day first. Finish Day
  /// itself always goes in order.
  requireEarlierDaysFinished: boolean;
  /// Two shifts a day. Off, a day is one whole sheet (saved as the Night sheet
  /// of the calendar date) and 4pm does not cut the entry.
  useShifts: boolean;
}

/// Readable by every role - the entry pages, audit and reports change shape with it.
export const getShiftMode = () => http.get<{ useShifts: boolean }>("/app-settings/shift-mode");

export const getEntryRules = () => http.get<EntryRules>("/app-settings/entry-rules");
export const updateEntryRules = (patch: Partial<EntryRules>) => http.patch<EntryRules>("/app-settings/entry-rules", patch);

/// What the Daily Report PDF saved to Google Drive leaves out (Settings > Google Drive).
/// Both are off until an admin turns them on, so the report lists everything by default.
export interface ReportOptions {
  /// Leave out products whose every figure is zero that day.
  hideEmptyRows: boolean;
  /// Leave out columns that are zero for every product that day.
  hideEmptyColumns: boolean;
}

export const getReportOptions = () => http.get<ReportOptions>("/app-settings/report-options");
export const updateReportOptions = (patch: Partial<ReportOptions>) => http.patch<ReportOptions>("/app-settings/report-options", patch);
