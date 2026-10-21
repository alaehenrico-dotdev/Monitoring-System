import { http } from "./http";

/// Switches that change how the entry pages behave for everyone (Settings > Entry Rules).
export interface EntryRules {
  /// An entry page stays read-only while an earlier day with saved entries is
  /// unfinished. Off lets people fill in the present day first. Finish Day
  /// itself always goes in order.
  requireEarlierDaysFinished: boolean;
}

export const getEntryRules = () => http.get<EntryRules>("/app-settings/entry-rules");
export const updateEntryRules = (patch: Partial<EntryRules>) => http.patch<EntryRules>("/app-settings/entry-rules", patch);
