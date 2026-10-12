import type { GridColumn } from "../components/StockGrid";

export const MANUAL_COUNT_KEY = "manualCount";

/// Import-only column for the Online/Offline Entry pages: the file's MANUAL
/// COUNTING column is read the same way Manual Count's own import reads it
/// (see ManualCountPage) and saved as that date/shift/location's manual count,
/// which is what the next period's opening stock starts from.
export const manualCountColumn: GridColumn = {
  key: MANUAL_COUNT_KEY,
  label: "Manual Count",
  importable: true,
  aliases: ["Manual Counting"],
};
